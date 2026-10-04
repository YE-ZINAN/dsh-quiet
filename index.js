/**
 * dsh-quiet —— 安静待命层（Host 半区）
 *
 * 存在的理由：等待 AI 的焦虑不是"AI 太慢"造成的，是"你不知道什么时候该回来"造成的。
 * 所以这个插件的全部工作就是：把"盯着"这件事从你身上拿走，只在**真的必须你出手**时叫你。
 *
 * 交互面：`/focus` 斜杠命令。**刻意不自建 Client UI** —— 命令的输出文本本身就是展示界面，
 * 零崩溃风险（qq2005 记录过 sidebar.panellist 能把整个客户端搞到起不来）。
 *
 * ── 三条不可违背的约束（理由见 DESIGN.md）──────────────────────────
 *
 *   ① 零静默失败。宁可误报，绝不漏报。
 *      漏叫一次，用户就退回盯屏幕，前面做的全部作废。
 *
 *   ② 只读观测，绝不改变任何现有语义。
 *      全部信号取自会话日志这一个来源。**不注册任何 waterfall** —— 那是决策接缝，
 *      观测者插进去有替换答案的风险，读取不需要这种权力。
 *
 *   ③ 绝不往会话日志 append 新的事件 type（会让会话打不开，practices.md 第 21 行）。
 *
 * ── 信号来源的取证经过（重要，别凭直觉改回去）─────────────────────────
 *
 * 最初设计是「审批读会话日志 + 提问挂 user-questions/request 的 pass-through waterfall」。
 * **实测证伪**：在根 ctx 上 `ctx.on('user-questions/request', …)` 收不到提问 —— 该
 * waterfall 由 `this.ctx.waterfall(scopeTarget(agent, agent), …)` 派发，作用域挂在 agent 上。
 *
 * 证据：插件激活后（epoch 1791042506715）发起的 ask_user_question（seq=412, +45.6s）
 * 没有被记录，而同一份会话日志里它**确实**以 tool/call 存在：
 *   {"type":"tool/call","data":{"name":"ask_user_question","arguments":"{\"questions\":[…]}"}}
 *
 * 于是改为：**提问也从会话日志读**。好处是单一来源、无作用域问题、覆盖所有会话
 * （含未渲染的），且彻底不碰决策接缝。
 *
 * ── 已取证的字段形状（别猜）───────────────────────────────────────
 *
 *   approval/asked   { id, toolName, callId?, reason? }
 *   approval/decided { id, outcome }            outcome 实测 'allowed-once'
 *   turn/end         { turn, reason:{kind} }    kind 实测 'completed' | 'aborted'
 *                    嵌套 {"kind":"aborted","reason":{"kind":"user"}}
 *   goal/change      { kind, version, operation, goal? }
 *                    operation 实测 'create' | 'pause' | 'clear'
 *                    ⚠️ goal 是 JSON 字符串，不是对象，必须 JSON.parse
 *   tool/call        { turn, step, callId, name, arguments }  arguments 也是字符串
 *   commands.register({ definitionId?, name, description, input?:{hint}, handler })
 *                    handler 收 invocation.{rawInput, agent, signal, commandId}
 *                    返回 { kind:'success'|'error', text }
 *                    ⚠️ CommandDefinitionId 运行时是恒等函数（return id），
 *                    且 normalizeDefinition 不校验 definitionId —— 可直接传字符串。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

/** Cordis 插件名，用于 loader 诊断。 */
export const name = 'dsh-quiet';

/**
 * 需要 `sessions` 就位才激活：观测面是会话日志（这是不可选的）。
 * 服务名取自 dsh-experimental-auto-review 的 inject 列表（本机已装的官方插件）。
 * `commands` 是可选的，用 ctx.inject 局部获取 —— 缺了它插件仍能观测，只是没有 /focus。
 */
export const inject = ['sessions'];

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const FLASH_SCRIPT = path.join(PLUGIN_DIR, 'tools', 'flash-dsh.ps1');
const FOCUS_FILE = path.join(PLUGIN_DIR, 'focus.json');

/** 触发提问的工具名。 */
const QUESTION_TOOL = 'ask_user_question';

/* ------------------------------------------------------------------ *
 * 事件分级
 *
 * L0 阻塞   —— agent 无法继续，除非你介入。你不来，它永久停摆。
 * L1 终局   —— 一件委托的事有终态（目标达成 / 非用户原因中断）。
 * L2 过程   —— 中间进展，不阻塞任何事。
 *
 * L2 刻意不做成可配置项。Stothart, Mitchum & Yehnert (2015) 证明：仅仅**收到**
 * 一条通知、不需要回应，就足以损害注意力任务表现，程度与主动用手机相当。
 * 而 L2 事件不阻塞任何事 —— 提醒的收益是零，成本是一次实打实的打断。
 * ------------------------------------------------------------------ */
const L0 = 'L0';
const L1 = 'L1';
const L2 = 'L2';

/** 从 tool/call 的 arguments 字符串里抠出人话，供提醒文案用。 */
function summarizeQuestion(rawArguments) {
  try {
    const args = typeof rawArguments === 'string' ? JSON.parse(rawArguments) : rawArguments;
    const qs = args && Array.isArray(args.questions) ? args.questions : [];
    return qs
      .map((q) => String((q && q.question) || '').trim())
      .filter(Boolean)
      .join(' ｜ ')
      .slice(0, 200);
  } catch (err) {
    return '';
  }
}

/**
 * 会话事件 → 分级提醒意图。
 * @returns {{level:string, kind:string, title:string, detail:string}|null} null = 不关心
 */
function classify(event) {
  if (!event || typeof event.type !== 'string') return null;
  const data = (event.data && typeof event.data === 'object') ? event.data : {};

  switch (event.type) {
    /* ---- L0：审批 ---- */
    // 源码：session.append("approval/asked", {id, toolName, callId?, reason?})，
    // 随后 decide() 跑 approval/request waterfall；ask 策略下无应答者时兜底
    // 返回 "unavailable"，工具不执行 —— 这就是"你不在就卡死"的源码证据。
    case 'approval/asked':
      return {
        level: L0,
        kind: 'approval',
        title: '有操作卡在等你审批',
        detail: [
          data.toolName ? '工具 ' + String(data.toolName) : '',
          data.reason ? String(data.reason) : '',
        ].filter(Boolean).join(' · ').slice(0, 240),
      };

    /* ---- L0：agent 提问 ---- */
    // 走会话日志而非 waterfall，理由见文件头"取证经过"。
    case 'tool/call':
      if (data.name !== QUESTION_TOOL) return null;
      return {
        level: L0,
        kind: 'question',
        title: 'agent 在问你问题',
        detail: summarizeQuestion(data.arguments),
      };

    /* ---- L1：目标达成 ---- */
    case 'goal/change': {
      if (data.operation !== 'complete') return null;
      let objective = '';
      try {
        const g = typeof data.goal === 'string' ? JSON.parse(data.goal) : data.goal;
        objective = (g && g.objective) ? String(g.objective).slice(0, 160) : '';
      } catch (err) { /* 解析失败不影响提醒 */ }
      return { level: L1, kind: 'goal-complete', title: '你交代的目标已达成', detail: objective };
    }

    /* ---- turn 终态 ---- */
    // 实测见过的 reason.kind：'completed' | 'aborted' | 'max-tokens'。
    //
    // ⚠️ 判定原则：**只有明确"正常收尾"和"用户自己按停"才算 L2，其余一律 L1。**
    // 第一版是枚举法（只认 aborted 为异常），结果 max-tokens（被输出上限截断）
    // 落进了默认的 L2 —— 走开时任务被截断却收不到提醒，正好违反公理 0。
    // 改成默认倒向提醒：将来出现没见过的 kind，宁可多报一次，不可沉默。
    // 用户自己按停的不提醒（他知道自己按了）。
    case 'turn/end': {
      const reason = data.reason;
      const kind = (reason && typeof reason === 'object') ? reason.kind : String(reason || '');
      const by = (reason && reason.reason && typeof reason.reason === 'object') ? reason.reason.kind : '';

      if (kind === 'completed') {
        return { level: L2, kind: 'turn-end', title: '一轮结束', detail: kind };
      }
      if (kind === 'aborted' && by === 'user') {
        return { level: L2, kind: 'turn-aborted-by-user', title: '你中断了这一轮', detail: '' };
      }
      if (kind === 'aborted') {
        return { level: L1, kind: 'turn-aborted', title: '这一轮意外中断了', detail: String(by || '') };
      }
      return { level: L1, kind: 'turn-incomplete', title: '这一轮没有正常收尾', detail: kind };
    }

    /* ---- 只记录，不提醒 ---- */
    case 'approval/decided':
      // 已经解决了。提醒一件已经结束的事没有信息价值。
      return { level: L2, kind: 'approval-decided', title: '审批已处理', detail: String(data.outcome || '') };

    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * 观测日志（JSONL）
 * ------------------------------------------------------------------ */
function makeLogger(cfg, ctx) {
  const file = cfg.logPath && String(cfg.logPath).trim()
    ? String(cfg.logPath).trim()
    : path.join(PLUGIN_DIR, 'events.jsonl');

  return function record(obj, opts) {
    const line = JSON.stringify({ iso: new Date().toISOString(), ...obj });
    try {
      fs.appendFileSync(file, line + '\n', 'utf8');
    } catch (err) {
      // 日志写不进去不能让插件死掉 —— 但也不能静默：吱一声。
      try { ctx.logger.warn('[dsh-quiet] 写观测日志失败: ' + String(err)); } catch (e) { /* 无 logger 就放弃 */ }
    }
    if (opts && opts.silent) return;   // 高频调试事件只落文件，不刷宿主日志
    try { ctx.logger.info('[dsh-quiet] ' + line); } catch (err) { /* 同上 */ }
  };
}

/* ------------------------------------------------------------------ *
 * 提醒执行器：Win32 FlashWindowEx（默认只闪任务栏，不抢焦点）
 *
 * Electron 的 flashFrame 在 app.asar/lib/main.js（主进程），宿主与主进程之间是
 * process.send 的白名单协议，未知消息类型直接丢弃 —— 插件够不到。
 * 但 FlashWindowEx 是 Win32 API，任何进程都能对目标窗口调用。
 *
 * 已实测：FLASHW_TRAY 闪任务栏、focusStolen=false（前台全程不变）、单次约 7ms。
 * ⚠️ 它的返回值是"调用前窗口是否处于活动状态"，不是成功/失败。
 * ------------------------------------------------------------------ */
function fireFlash(cfg, ctx, record, payload) {
  if (!cfg.flash) return { flashed: false, skipped: 'config.flash=false' };
  if (process.platform !== 'win32') return { flashed: false, skipped: 'non-win32' };

  const args = [
    '-NoProfile',
    // ⚠️ 必须显式 Bypass：本机执行策略 RemoteSigned，未签名脚本会被直接拒绝。
    '-ExecutionPolicy', 'Bypass',
    '-File', FLASH_SCRIPT,
    '-Mode', payload.mode || 'tray',
    '-Count', String(payload.count || 10),
  ];
  if (payload.untilFocused) args.push('-UntilFocused');

  try {
    // ⚠️ stdio 用 'ignore'：受限模式下 piped stdio 会 EPERM。
    const child = spawn('powershell.exe', args, { stdio: 'ignore', windowsHide: true });
    child.on('error', (err) => { record({ kind: 'flash-error', error: String(err) }, { silent: true }); });
    return { flashed: true, pid: child.pid, flashMode: payload.mode || 'tray', flashCount: payload.count || 10 };
  } catch (err) {
    record({ kind: 'flash-error', error: String(err) }, { silent: true });
    return { flashed: false, skipped: String(err) };
  }
}

/** 按级别决定提醒的物理形态。默认不抢焦点——抢焦点会打断你手上的事。 */
function flashPlanFor(cfg, level) {
  if (level === L0) {
    return { mode: cfg.l0FlashMode || 'tray', count: Number(cfg.l0FlashCount || 15), untilFocused: !!cfg.l0UntilFocused };
  }
  return { mode: cfg.l1FlashMode || 'tray', count: Number(cfg.l1FlashCount || 8), untilFocused: false };
}

/* ------------------------------------------------------------------ *
 * 专注块
 *
 * 依据 Fitz, Kushlev, … & Ariely (2019)：把通知批处理到每天 3 次，改善了注意力、
 * 降低了压力与负性情绪。所以专注期间**非阻塞事件一律攒着**，结束时一次性给出。
 *
 * 开始时的"托管声明"不是仪式感：Masicampo & Baumeister (2011) 证明，为未完成目标
 * 制定一个具体计划，就能消除它带来的侵入性思维与认知代价。声明 = 外化的承诺。
 * ------------------------------------------------------------------ */
function loadFocusState() {
  try {
    const s = JSON.parse(fs.readFileSync(FOCUS_FILE, 'utf8'));
    if (s && typeof s === 'object') {
      return {
        active: !!s.active,
        until: Number(s.until) || 0,
        startedAt: Number(s.startedAt) || 0,
        minutes: Number(s.minutes) || 0,
        accumulated: Array.isArray(s.accumulated) ? s.accumulated : [],
      };
    }
  } catch (err) { /* 首次运行没有文件 */ }
  return { active: false, until: 0, startedAt: 0, minutes: 0, accumulated: [] };
}

function createFocus(cfg, ctx, record, fire) {
  const state = loadFocusState();
  let timer = null;

  const save = () => {
    try { fs.writeFileSync(FOCUS_FILE, JSON.stringify(state, null, 2), 'utf8'); }
    catch (err) { record({ kind: 'focus-save-error', error: String(err) }, { silent: true }); }
  };

  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

  const isActive = () => {
    if (!state.active) return false;
    if (state.until > 0 && Date.now() >= state.until) { end('expired'); return false; }
    return true;
  };

  const renderDigest = () => {
    if (state.accumulated.length === 0) return '专注期间没有任何事需要你出手。';
    const lines = state.accumulated.map((a, i) =>
      `${i + 1}. ${a.title}${a.detail ? ' —— ' + a.detail : ''}`);
    return `专注期间攒下 ${state.accumulated.length} 件事：\n` + lines.join('\n');
  };

  function end(why) {
    const had = state.accumulated.length;
    state.active = false;
    state.until = 0;
    clearTimer();
    save();
    record({ kind: 'focus-end', why, accumulated: had, digest: state.accumulated });
    // 批量投递：结束时一次性提示（Fitz et al. 2019）
    if (had > 0) fire({ mode: cfg.l1FlashMode || 'tray', count: cfg.l1FlashCount || 8 });
  }

  function start(minutes) {
    state.active = true;
    state.startedAt = Date.now();
    state.minutes = minutes;
    state.until = minutes > 0 ? Date.now() + minutes * 60000 : 0;
    state.accumulated = [];
    clearTimer();
    if (state.until > 0) {
      timer = setTimeout(() => end('expired'), Math.max(0, state.until - Date.now()));
      if (timer && typeof timer.unref === 'function') timer.unref();
    }
    save();
    record({ kind: 'focus-start', minutes, until: state.until });
  }

  const note = (intent) => {
    state.accumulated.push({
      at: Date.now(), level: intent.level, kind: intent.kind,
      title: intent.title, detail: intent.detail,
    });
    save();
  };

  // 启动时若发现持久化的专注块已过期，立即收尾（跨重启不静默丢失）
  if (state.active && state.until > 0 && Date.now() >= state.until) end('expired-after-restart');
  else if (state.active && state.until > 0) {
    timer = setTimeout(() => end('expired'), Math.max(0, state.until - Date.now()));
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  return { state, isActive, start, end, note, renderDigest, clearTimer, save };
}

/** /focus 的用法说明。 */
function FOCUS_USAGE(cfg) {
  return [
    `用法（默认 ${cfg.focusMinutes} 分钟，番茄钟）：`,
    '  /focus           开始一个专注块',
    '  /focus <分钟>    自定时长（0 = 不定时，直到你说停）',
    '  /focus off       提前结束，并列出攒下的事',
    '  /focus status    看当前状态与攒下的事',
    '  /focus digest    只看攒下的事',
  ].join('\n');
}

/** 专注开始的"托管声明"。 */
function declaration(minutes) {
  const span = minutes > 0 ? `${minutes} 分钟` : '（不定时，直到你说停）';
  return [
    `专注 ${span}。`,
    '',
    '这段时间你不用管它：被卡住（要审批 / 要你回答）会闪任务栏叫你，',
    '其他进展一律攒着，不打扰。',
    minutes > 0 ? '到点我会闪一次 —— 那就是你的短休息，顺手把攒下的事过一遍就行。' : '',
  ].filter(Boolean).join('\n');
}

/* ------------------------------------------------------------------ *
 * 插件主体
 * ------------------------------------------------------------------ */
export function apply(ctx, rawConfig) {
  const cfg = {
    flash: false,
    channel: 'windows-taskbar',
    alertLevels: [L0, L1],
    focusMinutes: 25,
    focusL0Penetrates: true,
    l0FlashMode: 'tray',
    l0FlashCount: 15,
    l0UntilFocused: false,
    l1FlashMode: 'tray',
    l1FlashCount: 8,
    logPath: '',
    // 调试开关：记录收到的所有会话事件类型 + 每条事件由哪条注册路径送达。
    // P1 验收时靠它证明了订阅确实到货（详见 DESIGN.md 第十七节），现已验收，默认关。
    // 以后排查"提醒为什么没响"第一件事就是打开它：
    // 日志里若连 delivery 记录都没有 → 订阅根本没到货，别去查分级逻辑。
    debugAllEvents: false,
    ...(rawConfig && typeof rawConfig === 'object' ? rawConfig : {}),
  };

  const record = makeLogger(cfg, ctx);

  record({
    kind: 'plugin-activated',
    name,
    platform: process.platform,
    config: cfg,
    flashScriptExists: fs.existsSync(FLASH_SCRIPT),
  });

  const focus = createFocus(cfg, ctx, record, (plan) => fireFlash(cfg, ctx, record, plan));

  // 进程退出时清掉定时器，避免悬挂
  ctx.effect(() => () => focus.clearTimer(), 'dsh-quiet focus timer');

  /** 这个级别此刻是否允许提醒。 */
  function shouldAlert(level) {
    if (!Array.isArray(cfg.alertLevels) || !cfg.alertLevels.includes(level)) return false;
    if (!focus.isActive()) return true;
    // 专注块内：L0 按配置决定是否穿透；其余一律攒着
    if (level === L0) return !!cfg.focusL0Penetrates;
    return false;
  }

  /* ---- 传感器：会话日志（只读边沿订阅）----
   *
   * 签名 (session, event) 取自官方包 dsh-agent-preset-registry 的真实用法。
   * dsh-session 约定：seed 事件不 publish，所以 fork/resume 回放不会误报。
   *
   * ⚠️ 为什么在这里注册**三条路径**：
   * `session/event` 也是带 carrier 派发的 —— 源码是
   *   collectSessionCallbacks(entry.emitCtx, [entry.carrier, "session/event", ...])
   * 和刚刚被证伪的 user-questions/request 是同一套作用域机制。如果它同样到不了
   * 插件 ctx，整个设计就塌了，而这件事只有重启后才能观察到。
   *
   * 重启代价太高，所以不做赌注：三条路径并存，按 (sessionId, seq) 去重，
   * 并记录每条事件是**哪条路径**送达的。这样一次重启就能确定性地知道哪条有效，
   * 之后把多余的删掉。去重让"多注册"变成无副作用的保险，而不是重复提醒的隐患。
   *
   *   1. 插件自己的 ctx   —— 惯用法，官方包就这么写
   *   2. ctx.root         —— 最宽的祖先作用域
   *   3. agent.ctx        —— 在 agent/created 里注册，覆盖 agent 作用域
   */
  const seenDelivery = new Set();
  const seenQueue = [];

  /** 返回 true 表示这是第一次见到 (sessionId, seq)。 */
  function firstSight(sessionId, seq) {
    const key = sessionId + '#' + seq;
    if (seenDelivery.has(key)) return false;
    seenDelivery.add(key);
    seenQueue.push(key);
    // 有界：只保留最近 4000 条，避免长会话下无限增长
    while (seenQueue.length > 4000) seenDelivery.delete(seenQueue.shift());
    return true;
  }

  function handleSessionEvent(via, session, event) {
    const sessionId = session && session.id ? String(session.id) : '';
    const seq = event && typeof event.seq === 'number' ? event.seq : -1;

    try {
      // 诊断：每一次送达都记一条（含路径），动作只做一次。
      if (cfg.debugAllEvents) {
        record({
          level: L2,
          kind: 'delivery',
          via,
          eventType: event && event.type,
          sessionId,
          seq,
          duplicate: seenDelivery.has(sessionId + '#' + seq),
        }, { silent: true });
      }

      if (!firstSight(sessionId, seq)) return;   // 已由其它路径处理过

      const intent = classify(event);
      if (!intent) return;

      const allowed = shouldAlert(intent.level);
      let flashResult = { flashed: false, skipped: 'not-alerting' };

      if (allowed) {
        flashResult = fireFlash(cfg, ctx, record, flashPlanFor(cfg, intent.level));
      } else if (intent.level !== L2 && focus.isActive()) {
        // 专注期间攒着，专注结束时一次性给出（Fitz et al. 2019）
        focus.note(intent);
      }

      record({
        level: intent.level,
        kind: intent.kind,
        title: intent.title,
        detail: intent.detail,
        via,
        sessionId,
        seq,
        eventType: event.type,
        alerting: allowed,
        focusActive: focus.isActive(),
        ...flashResult,
      });
    } catch (err) {
      // 绝不让观测逻辑把宿主搞崩。
      record({ kind: 'sensor-error', surface: 'session/event', via, error: String(err) }, { silent: true });
    }
  }

  /* ---- 注册：只留一条路径 ----
   *
   * 2026-10-04 实测结论（见 DESIGN.md 第十七节）：
   *   激活后 plugin-ctx 首次到货（duplicate:false），
   *   root-ctx 全部 duplicate:true —— 说明它冗余，徒增一半处理量。
   *   agent-ctx 一次都没出现（当前 agent 在插件激活前就已创建，
   *   而 plugin-ctx 已经能收到其它会话的事件，所以这条也不需要）。
   *
   * 于是只保留 plugin-ctx。**去重按 (sessionId, seq) 保留下来**：它这次
   * 证明了"多注册"是安全的，也防止将来重复注册导致重复提醒 —— 代价只是一个
   * 有界 Set（最多 4000 条）。
   */
  ctx.on('session/event', (session, event) => handleSessionEvent('plugin-ctx', session, event));

  /* ---- /focus 命令（Host 侧的交互面，替代自建 Client UI）----
   * `commands` 走 ctx.inject 局部获取：缺失时插件仍能观测，只是没有命令。
   * 已取证：CommandDefinitionId 运行时是恒等函数，normalizeDefinition 不校验它，
   * 所以直接传字符串即可，无需（也无法从工作区）import asar 内的品牌模块。
   */
  ctx.inject(['commands'], (child) => {
    const handler = (invocation) => {
      const raw = String((invocation && invocation.rawInput) || '').trim();
      const arg = raw.toLowerCase();

      const statusText = () => {
        if (!focus.isActive()) return '当前不在专注。';
        const left = focus.state.until > 0
          ? `还剩约 ${Math.max(1, Math.ceil((focus.state.until - Date.now()) / 60000))} 分钟`
          : '不定时';
        return `专注中（${left}）。卡住会闪你；其他攒着。\n\n${focus.renderDigest()}`;
      };

      try {
        // 裸 /focus 直接开始一个番茄钟（用户 2026-10-03：按番茄时钟规划，但可自填时长）
        if (raw === '') {
          if (focus.isActive()) return { kind: 'success', text: statusText() };
          focus.start(Number(cfg.focusMinutes) || 25);
          return { kind: 'success', text: declaration(Number(cfg.focusMinutes) || 25) };
        }

        if (arg === 'status') return { kind: 'success', text: statusText() };

        if (arg === 'off' || arg === 'end' || arg === 'stop') {
          if (!focus.isActive()) return { kind: 'error', text: '当前不在专注。' };
          focus.end('manual');
          return {
            kind: 'success',
            text: `专注结束。\n\n${focus.renderDigest()}\n\n接下来 5 分钟别马上切回工作 —— 那正是这份清单该被读掉的时候。`,
          };
        }

        if (arg === 'digest') return { kind: 'success', text: focus.renderDigest() };

        if (arg === 'help' || arg === '-h' || arg === '--help') {
          return { kind: 'success', text: FOCUS_USAGE(cfg) };
        }

        const minutes = Number(arg);
        if (!Number.isFinite(minutes) || minutes < 0) {
          return { kind: 'error', text: FOCUS_USAGE(cfg) };
        }
        if (focus.isActive()) focus.end('restart');
        focus.start(minutes);
        return { kind: 'success', text: declaration(minutes) };
      } catch (err) {
        record({ kind: 'command-error', error: String(err) }, { silent: true });
        return { kind: 'error', text: '/focus 执行出错：' + String(err) };
      }
    };

    // commands.register 的返回值就是"精确注销该定义的 effect disposer"
    // （dsh-commands 源码注释原文），所以直接交给 ctx.effect 托管即可。
    child.effect(() => {
      const dispose = child.commands.register({
        definitionId: 'dsh-quiet/focus',
        name: 'focus',
        description: '开始/结束专注块：期间只在被卡住时提醒，其余攒着',
        input: { hint: '<分钟> | off | digest' },
        handler,
      });
      record({ kind: 'command-registered', command: 'focus' });
      return typeof dispose === 'function' ? dispose : undefined;
    }, 'dsh-quiet focus command');
  });
}
