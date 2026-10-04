// dsh-quiet 自检：把这次踩到的坑固化成回归断言。
// 用法：node dsh-quiet/tools/self-check.mjs
//
// 为什么需要：两个错误都是"看起来对、实际错"的类型，靠肉眼 review 抓不住：
//   ① 提问挂 waterfall —— 语法完全合法，但作用域不对，运行时静默收不到。
//      断言：源码里**不允许**出现 user-questions 的 waterfall 监听。
//   ② .ps1 无 BOM + 纯 LF —— 中文系统按 GBK 误解码，报假语法错误、丢行。
//      断言：脚本必须是 UTF-8 带 BOM + CRLF。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log('  PASS  ' + label); }
  else { fail += 1; console.log('  FAIL  ' + label + (extra ? '   ← ' + extra : '')); }
};

/* ---------- 0) 去注释工具 ----------
 * 教训：第一版断言直接扫原文，结果被**文件头注释里的取证记录**骗过 ——
 * 注释里写着「已证伪：ctx.on('user-questions/request', …)」和
 * 「session.append("approval/asked", …)」，断言就把这些当成了违规代码。
 * 扫源码做断言必须先剥注释，否则断言会被自己的文档骗过。
 */
function stripComments(s) {
  let out = '';
  let i = 0;
  const n = s.length;
  let quote = null;
  while (i < n) {
    const c = s[i];
    const d = s[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += (d || ''); i += 2; continue; }
      if (c === quote) quote = null;
      i += 1; continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i += 1; continue; }
    if (c === '/' && d === '/') { while (i < n && s[i] !== '\n') i += 1; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i += 1; i += 2; continue; }
    out += c; i += 1;
  }
  return out;
}

/* ---------- 1) index.js 结构与回归断言 ---------- */
console.log('\n[1] index.js');
const indexPath = path.join(ROOT, 'index.js');
const rawSrc = fs.readFileSync(indexPath, 'utf8');
const src = stripComments(rawSrc);   // 所有代码级断言只看剥掉注释后的真实代码

ok(/^export const name\b/m.test(src), '导出 name');
ok(/^export const inject\b/m.test(src), '导出 inject');
ok(/^export function apply\b/m.test(src), '导出 apply（函数形式）');
ok(src.includes("ctx.on('session/event'"), '订阅 session/event');
// 2026-10-04 实测后收敛为单路径：root-ctx 冗余（全部 duplicate），agent-ctx 未到货。
ok(!src.includes("ctx.root.on('session/event'"), '不重复注册 root-ctx（实测冗余，徒增一半处理量）');
ok(!/agentDisposers/.test(src), '不注册 agent-ctx（实测未到货，plugin-ctx 已覆盖其它会话）');
ok(/function firstSight\b/.test(src), '按 (sessionId, seq) 去重（防重复注册导致重复提醒）');
ok(src.includes('via') && /kind:\s*'delivery'/.test(src), '记录每条事件由哪条注册路径送达');
ok(/kind:\s*'command-registered'/.test(src), '命令注册后留记录（否则"命令没生效"无法定位）');
ok(/debugAllEvents:\s*false/.test(src), '调试记录默认关闭');
ok(/ctx\.inject\(\s*\[\s*'commands'\s*\]/.test(src), '用 ctx.inject 局部获取 commands（可缺省）');

// ⭐ 回归断言①：绝不能挂 user-questions 的 waterfall
const waterfallOnQuestions = /ctx\.on\(\s*['"]user-questions/.test(src);
ok(!waterfallOnQuestions, '不挂 user-questions waterfall（作用域不匹配，实测收不到）',
  '出现了 user-questions 监听 —— 请改回从会话日志读 tool/call');

// 断言：提问必须从日志读
ok(src.includes("data.name !== QUESTION_TOOL"), '提问从会话日志的 tool/call 判定');
ok(/const QUESTION_TOOL = 'ask_user_question'/.test(src), 'QUESTION_TOOL 常量正确');

// 断言：不能往会话日志写新事件 type
ok(!/\.append\(\s*['"]/.test(src), '不调用 session.append（写新事件 type 会让会话打不开）');

// 断言：turn/end 的 reason 必须按对象处理（第一版写成 String() 会得到 [object Object]）
ok(/reason\.kind/.test(src), 'turn/end 的 reason 按结构化对象处理');
// ⭐ 回归断言②：turn/end 必须"默认倒向提醒"。
// 第一版用枚举法（只认 aborted 为异常），实测漏掉了 max-tokens（输出被截断）
// → 走开时任务被截断却收不到提醒。断言：必须存在 turn-incomplete 这条 L1 兜底分支。
ok(/level:\s*L1,\s*kind:\s*'turn-incomplete'/.test(src),
  'turn/end 未知 kind 倒向 L1（曾漏报 max-tokens）',
  '缺少 L1 兜底分支 —— 未知 reason.kind 会静默变成 L2');
ok(/if \(kind === 'completed'\)/.test(src), "只有 'completed' 明确算 L2");

// 断言：子进程 stdio 必须 ignore（受限模式下 piped 会 EPERM）
ok(/stdio:\s*'ignore'/.test(src), "spawn 用 stdio:'ignore'");
// 断言：执行策略必须 Bypass（本机 RemoteSigned 会拒绝未签名脚本）
ok(src.includes("'-ExecutionPolicy', 'Bypass'"), '调用 ps1 时显式 -ExecutionPolicy Bypass');

// 用户 2026-10-03 拍板的默认值
ok(/focusMinutes:\s*25/.test(src), '专注块默认 25 分钟（番茄钟）');
ok(/l0FlashMode:\s*'tray'/.test(src), "L0 默认只闪任务栏（用户决定：任务栏闪烁）");
ok(/focusL0Penetrates:\s*true/.test(src), 'L0 默认穿透专注块（用户决定）');
ok(/function FOCUS_USAGE/.test(src), '/focus 有用法说明');
ok(/if \(raw === ''\) \{[\s\S]{0,160}focus\.start\(/.test(src), '裸 /focus 直接开始番茄钟（而非只查状态）');

/* ---------- 2) flash-dsh.ps1 编码断言 ---------- */
console.log('\n[2] tools/flash-dsh.ps1');
const ps1Path = path.join(ROOT, 'tools', 'flash-dsh.ps1');
const raw = fs.readFileSync(ps1Path);
const hasBom = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
ok(hasBom, 'UTF-8 带 BOM（否则中文系统按 GBK 误解码，丢行并报假语法错误）');

const text = raw.toString('utf8').replace(/^\uFEFF/, '');
const lfOnly = (text.match(/(?<!\r)\n/g) || []).length;
ok(lfOnly === 0, '无裸 LF（必须 CRLF）', '裸 LF 行数 = ' + lfOnly);
ok(text.includes('FlashWindowEx'), '含 FlashWindowEx 调用');
ok(text.includes('FLASHW_TRAY'), '含 FLASHW_TRAY（只闪任务栏，不抢焦点）');
ok(!/\bapiOk\b/.test(text), '未把 FlashWindowEx 返回值当成功标志（它是"调用前是否活动"）');

/* ---------- 3) cordis.patch.yml ---------- */
console.log('\n[3] cordis.patch.yml');
const patchPath = path.join(ROOT, 'cordis.patch.yml');
const patchText = fs.readFileSync(patchPath, 'utf8');
// 找宿主自带的 yaml 解析器（工作区自己没有）。
// 不写死路径：从 DSH_HOME（或 ~/.dsh）推导各 profile 下的 node_modules，
// 再退回常规模块解析 —— 这样别人 clone 下来也能跑。
const require_ = createRequire(import.meta.url);
const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const yamlCandidates = [
  'yaml',
  'js-yaml',
  ...['desktop', 'default'].flatMap((prof) => [
    path.join(dshHome, 'profiles', prof, 'node_modules', 'yaml'),
    path.join(dshHome, 'profiles', prof, 'node_modules', 'js-yaml'),
  ]),
];
let yaml = null;
for (const p of yamlCandidates) {
  try { yaml = require_(p); break; } catch (err) { /* 试下一个 */ }
}
if (yaml) {
  try {
    const doc = yaml.parse ? yaml.parse(patchText) : yaml.load(patchText);
    ok(Array.isArray(doc) && doc.length === 1, 'YAML 可解析且顶层是单元素列表');
    const row = doc[0].insert[0];
    ok(row.name === 'dsh-quiet', "insert 行 name === 'dsh-quiet'");
    const keys = Object.keys(row.config || {});
    for (const k of ['flash', 'alertLevels', 'focusMinutes', 'focusL0Penetrates', 'l0FlashMode', 'l1FlashMode']) {
      ok(keys.includes(k), 'config 含 ' + k);
    }
    ok(Array.isArray(row.config.alertLevels) && !row.config.alertLevels.includes('L2'),
      'alertLevels 不含 L2（L2 刻意不给开关）');
    ok(row.config.focusMinutes === 25, 'patch: focusMinutes === 25（番茄钟）');
    ok(row.config.l0FlashMode === 'tray', 'patch: l0FlashMode === tray（只闪任务栏）');
    ok(row.config.focusL0Penetrates === true, 'patch: focusL0Penetrates === true（默认穿透）');
    ok(row.config.flash === true, 'patch: flash === true（P1 已验收，提醒打开）');
    ok(row.config.debugAllEvents === false, 'patch: debugAllEvents === false（关掉高频调试）');
  } catch (err) {
    ok(false, 'YAML 解析', String(err));
  }
} else {
  console.log('  SKIP  找不到 yaml 解析器');
}

/* ---------- 4) package.json ---------- */
console.log('\n[4] package.json');
const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
ok(pj.name === 'dsh-quiet', "name === 'dsh-quiet'");
ok(pj.dsh && pj.dsh.bundle && pj.dsh.bundle.patch === './cordis.patch.yml', 'dsh.bundle.patch 指向 patch 文件');
ok(pj.exports && pj.exports['.'] === './index.js', 'exports["."] === ./index.js');

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(52));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
