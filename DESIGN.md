# dsh-quiet 设计规划

> **一句话**：把"盯着 AI 干活"这件事外包出去——你只在**真的必须你出手**的时候被叫回来。
>
> 状态：**P0–P3 已实现，待重启验证**（实现记录见文末第十节起）。
> 依据分层：📖 = 有文献；🔬 = 本机源码取证；🤔 = 我的判断（可推翻）。
>
> **命名**：用户 2026-10-03 定为 `dsh-quiet`（安静）。此前暂名 `dsh-sentinel`。
> **用户 2026-10-03 拍板的四项**：① 名 `dsh-quiet`；② 专注块按番茄钟、默认 25 分钟，允许自填；③ L0 默认穿透；④ 只做任务栏闪烁。

---

## 一、问题诊断：等待焦虑不是一个问题，是三个

先把病看清楚，不然做出来的东西只会是"又一个通知器"。

| # | 机制 | 依据 | 在你身上的表现 |
|---|---|---|---|
| ① | **不确定性本身就是致焦虑源**，与结果好坏无关 | 📖 Grupe & Nitschke (2013), *Nat Rev Neurosci*：对不确定性的持续预期直接驱动焦虑；人宁愿要确定的坏结果，也不要不确定 | "它还要多久？是不是卡住了？是不是在等我？" —— 于是你反复回去看 |
| ② | **未完成目标占用工作记忆并产生侵入性思维** | 📖 Zeigarnik 效应；Masicampo & Baumeister (2011), *JPSP*：未完成目标损害后续任务表现；Leroy (2009), *OBHDP*：任务切换留下 **attention residue** | 你切去干别的，干不进去——那个跑着的任务一直占着内存 |
| ③ | **等待的主观时长被放大** | 📖 Maister (1984) 等待心理原则：无所事事的等待 > 有事可干的等待；焦虑使等待更长；**不确定的等待 > 已知有限的等待**；没说明理由的等待 > 说明了理由的 | 实际等了 3 分钟，感觉像 15 分钟，于是更焦虑 → 更盯 → 更焦虑 |

**关键推论（整个设计的立足点）**：这三条**没有一条是"AI 太慢"造成的**，全部是**"你不知道什么时候该回来"**造成的。

所以：
- **让 AI 更快治不了这个病。** 再快也还有等待，不确定性一点没减。
- 真正治它的是把**监控责任从人转移到系统**。

这事有个致命前提：**信任**。🤔 如果系统漏叫一次，你就会退回盯屏幕，前面全白做。所以本设计的第一公理不是"少打扰"，而是：

> **公理 0（最高优先级）：零静默失败。宁可误报，绝不漏报。**

这一条会压过后面所有关于"优雅""克制"的考虑。漏报摧毁信任，误报只是烦。

---

## 二、由诊断推出的设计公理

| # | 公理 | 依据 | 具体约束 |
|---|---|---|---|
| 1 | **提醒本身有害，必须极度吝啬** | 📖 Stothart, Mitchum & Yehnert (2015), *JEP:HPP* 41(4):893–897：**仅仅收到**一条通知（不回应）就足以损害注意力任务表现，程度与主动用手机相当。Kushlev, Proulx & Dunn (CHI 2016)：通知增加注意力涣散与多动症状 | 只在此人不在就**真的进行不下去**、或**整件事有了终态**时提醒 |
| 2 | **批量 > 实时** | 📖 Fitz, Kushlev, … & Ariely (2019), *Computers in Human Behavior*：把通知批处理到每天 3 次，改善了注意力、降低了压力与负性情绪 | 专注块机制；非阻塞事件一律攒 |
| 3 | **写下一个具体计划就能消除侵入性思维** | 📖 Masicampo & Baumeister (2011)：**制定计划**可消除未完成目标的认知代价 | 专注块开始时要求一句"托管声明"：*接下来 N 分钟我不管，卡住了就闪我*。**这不是仪式感，是有实证的阻断手段** |
| 4 | **不给假 ETA** | 🤔 推论。Maister 原则说"已知有限"的等待更好受，产品经理的直觉是给进度条/剩余时间。但 agent 任务的剩余时间**本质不可预测**；给错比不给更伤信任，直接违反公理 0 | 不显示倒计时、不显示"还剩 3 分钟"。改为给**有限性承诺**：不是"还要 3 分钟"，而是**"你不需要等"** |
| 5 | **回来时要有闭合感** | 📖 Leroy (2009)：没有闭合的任务切换会持续污染下一件事 | 专注块结束时的呈现必须给出**结论**，不是状态列表 |
| 6 | **插件自己不能变成新的焦虑源** | 🤔 反身性批判。一个带未读计数的面板 = 一个新的未完成任务 = 又一条 Zeigarnik | **默认不产生任何计数、角标、待清零列表。** 提醒瞬时、"看完即消" |

**公理 4 值得单独说一句**，因为它是本设计最反直觉的地方：

> Maister 那十条原则，全部是在**优化等待体验**。
> 而 agent 时代真正的解法是**消灭等待本身**——把等待从你的时间线上移除。
> 一个不可信的 ETA 只是在把等待包装得好看一点而已。

---

## 三、产品形态

### 不是
- 不是通知中心（那会变成第二个收件箱）
- 不是看板/仪表盘（把 agent 状态可视化 = 让你更想盯着看）
- 不是"AI 跑得快一点"（治不了病）

### 是
一个**三态**的安静层：

| 态 | 用户 | 系统 | 界面表现 |
|---|---|---|---|
| **待命** | 正常用 DSH | 只观察，不打扰 | 无存在感 |
| **专注块** | 去干别的（写论文/读文献/离开） | 按分级策略静音或穿透 | 极简计时 + 托管声明 |
| **归来** | 回来 | 一次性汇总已发生的事 | 一句话结论 + 待你决定项，看完即消 |

### 事件分级模型

你选的三个触发器，恰好构成一个自洽的分级（🤔 我的映射）：

| 级别 | 定义 | 事件 | 默认策略 | 提醒语义 |
|---|---|---|---|---|
| **L0 阻塞** | agent 无法继续，必须你出手 | `approval/asked`（审批）<br>`user-questions/request`（提问） | **穿透**专注块 | "卡住了，在等你" |
| **L1 终局** | 一件委托的事有了终态 | `goal/changed` → `operation: complete`<br>turn 异常终止 / 会话报错 | 攒到休息 | "你交代的事完了" |
| **L2 过程** | 中间进展，不阻塞任何事 | turn 正常结束<br>工具调用完成、todo 更新 | **永不提醒** | —— |

**关于你排除"任务完成"这件事**：单选结果里你只勾了审批、提问、goal 完成，**没勾"任务完成"**。这个选择在科学上是对的——L2 事件不阻塞任何事，提醒的收益是零（满足好奇心），成本是实打实的一次打断（公理 1）。**建议把这个判断固化为设计原则，而不是留成一个开关。**

L0 为什么默认穿透：源码已确认 fail-closed——`ask` 策略下没有应答者时，waterfall 兜底返回 `unavailable`，工具不执行。**你不来，它就永久停摆**。不穿透的代价不是"晚点知道"，是"任务死了"。

---

## 四、架构

### 4.1 传感器（Host 半区）—— 已取证，非推测

🔬 三个接缝都真实存在且可注入：

| 服务名 | 包 | 关键事件 | 本机现成范例 |
|---|---|---|---|
| `approval` | `dsh-user-approval` | `approval/asked`、`approval/decided` | `dsh-experimental-auto-review`（**你已安装**）inject `["approval","llm","permissionPresets","sessions","tools"]` |
| `userQuestions` | `dsh-user-questions` | `user-questions/request` | `dsh-tool-ask-user` inject `["tools","userQuestions"]` |
| `goals`（**复数**） | `dsh-goal` | `goal/changed`、`goal/activation-changed` | `dsh-goal-round-driver` inject `["agents","goals","sessions"]` |

🔬 **审批的真实源码行为**（`dsh-user-approval`）：

```
request(req):
  session.append("approval/asked", {id, toolName, callId, reason})   ← 审计事件
  decide(req, session)  →  ctx.waterfall("approval/request", …)      ← 决策点
  session.append("approval/decided", {id, outcome})                  ← 审计事件
```

**由此定下一个重要架构决策**：🤔

- ✅ **只读订阅会话事件流**（`approval/asked` / `approval/decided` / `goal/change` / `turn/end`）。
  事件溯源、durable、覆盖所有会话（**包括没渲染在屏幕上的**），且**零侵入**——不碰决策语义。
- ❌ **不要**去注册 `approval/request` waterfall 处理器。那是**决策接缝**（auto-review 用它来*取代*人类审批）。观测者插进去有替换答案的风险。读取不需要这种权力。

> ⚠️ **本节关于"提问挂 waterfall"的设想已被实测推翻，见第十二节。** 最终方案是提问也从会话日志读（`tool/call` + `name === 'ask_user_question'`），全部信号单一来源、不碰任何 waterfall。本节其余结论（只读、不碰决策接缝）仍然成立。

这一条同时解决了 qq2005 踩过的坑：DOM 信号 `[data-chat-running]` 挂在会话容器上，切会话会卸载 → 误判成"跑完了"。**走宿主事件流根本不存在这个问题。**

### 4.2 执行器 —— 唯一的可行通道

🔬 取证结果：

- `flashFrame` / `Tray` 都在 `app.asar/lib/main.js`（479 KB，`import … from "electron"`）——**Electron 主进程**。
- DSH 宿主与主进程之间是 `process.send` 的**白名单校验协议**：`ready` / `debug` / `fatal` / `update-tasks` / `quit-inspection` / `shutdown-complete` / `version` / `platform-session` / `toolchain`。未知类型直接丢弃。
- **结论：插件无法调用 `flashFrame()`。**

但"任务栏闪烁"的效果是 Win32 `FlashWindowEx`，**任何进程都能对目标窗口调用**，不需要 Electron 配合。

🔬 目标窗口已确认存在：

```
Title: DSH桌面版长期记忆插件推荐 — DeepSeek Harness
Class: Chrome_WidgetWin_1
```

实现：Host 侧 Node 枚举顶层窗口 → 按标题后缀 / PID 归属定位 DSH 窗口 → PowerShell `Add-Type` P/Invoke 调用 `FlashWindowEx`。

- `FLASHW_TRAY`：只闪任务栏按钮，**不抢焦点**（关键——抢焦点会打断你正在做的事）
- `FLASHW_TIMERNOFG`：持续闪到窗口置前（适合 L0，必须处理）
- ⚠️ 沙箱约束：子进程必须用 `stdio: 'ignore'`。受限模式下 piped stdio 会 EPERM。

### 4.3 界面（Client 半区）

- 专注块控制 + 分级配置
- 归来时的轻量呈现
- ⚠️ 用 `dsh.client` 清单；**避开 `sidebar.panellist`**（qq2005 记录过它导致整个客户端插件激活失败、应用起不来）
- ⚠️ 🔬 桌面端 UI 注入表只在宿主启动时采集一次，**装完必须完全退出重开**（注意托盘：关窗口可能只是最小化）

---

## 五、风险清单（诚实版）

| # | 风险 | 严重度 | 处置 |
|---|---|---|---|
| 1 | **插件自己变成焦虑源**——加个未读计数就成了新的待办 | 高 | 公理 6：默认零计数、零常驻列表 |
| 2 | **静默失败**：插件挂了/客户端崩了，你以为有人看着 | 高 | 公理 0：心跳自检 + 覆盖审计（每个 open turn 必须有终态，超时无终态升级为 L1"可能卡住了"）+ 降级可见 |
| 3 | **窗口在托盘时任务栏无按钮**，闪烁无效 | 中 | 回落：窗口恢复焦点时补一次轻量提示；**不累计**。🤔 这也说明"仅任务栏闪烁"在你离开电脑时是盲的——但这是你选的，先按此实现，通道做成可插拔，将来加手机推送（你有 `dsh-lan-gate`）不用改架构 |
| 4 | DSH 关闭期间任务状态丢失 | 中 | 重启后读会话日志补报，而非依赖内存状态 |
| 5 | waterfall 观测侵入决策语义 | 中 | 已规避：只读事件流（§4.1） |
| 6 | 误报（qq2005 的切会话/审批面板坑） | 中 | 走宿主事件流从根上避免；加最小运行时长与冷却守卫 |
| 7 | 桌面端插件生态已知坑（dshmarket 不能停用插件、UI 注入表只采一次） | 中 | 装完完全重启；**绝不在 dshmarket 里停用插件**（会活锁并刷坏 `cordis.patch.yml`） |

---

## 六、怎么知道它真的有用（n-of-1 测量）

🤔 这是我最想加的一节。一个"感觉更专注了"的工具没法验证，也没法迭代。你受过实证训练，可以真做：

**可测指标（全部可自动采集）**

| 指标 | 采集方式 | 预期方向 |
|---|---|---|
| 离席时长 | 有任务在跑时，DSH 窗口非前台且无输入的累计时长 | ↑ |
| **主动切回窗口次数** | 每小时 `focus` 事件次数（核心指标：直接测量"盯"的行为） | ↓ |
| 专注块完成率 | 未提前结束的专注块占比 | ↑ |
| 等待焦虑自评 | 每日一次 1–5 分，手动 | ↓ |

**设计**：基线 1 周（不开）→ 1 周（开）→ 可做 A-B-A-B 增强内部效度。
**混淆控制**：任务类型与时长会同时影响指标，记录每次任务的时长与类型作协变量。

这条路线的好处：即使结果不显著（很可能——个体差异大、样本小），你也会得到**关于自己注意力模式的真实数据**，而不是产品宣传。

---

## 七、实施路线

| 阶段 | 内容 | 出口标准 |
|---|---|---|
| **P0 技术验证**（先做，30 分钟） | 单独跑通 `FlashWindowEx` 打到 DSH 窗口 | 任务栏真的闪了一下，不抢焦点 |
| **P1 传感器** | Host 插件 `inject: ['approval','userQuestions','goals','sessions']`，只读订阅事件流，打印到日志 | 手动触发审批/提问/goal 完成，日志各打一条，无误报 |
| **P2 执行器** | 接上闪烁；L0/L1/L2 分级 | 三类事件各自闪烁，L2 不闪 |
| **P3 专注块** | 状态 + 托管声明 + 静默/穿透策略 + 归来汇总 | 专注块内 L1 静默、L0 穿透；块结束汇总出现一次 |
| **P4 UI** | Client 半区配置与呈现 | 装完重启后界面可用，无崩溃 |
| **P5 测量** | 埋点 + 基线 | 能导出指标 CSV |

**本周最小动作**：只做 P0 + P1。不写界面、不碰 UI 注入（那是坑最多的一段）。P0 验证不了就别往下走——所有设计都挂在"能闪"这一件事上。

---

## 八、待你拍板

1. **插件名**：`dsh-quiet`（哨兵——替你站岗，你不必自己盯）／`dsh-quiet`／`dsh-standby`／你定
2. **专注块默认时长**：25 分钟 / 50 分钟 / 不定时（手动结束）
3. **L0 是否默认穿透**：建议默认穿透（源码已确认不穿透=任务永久停摆），但可关
4. **通道可插拔确认**：先只做任务栏闪烁（你的选择），但架构上留插槽，将来要加手机推送不用重写
5. **P0 是否现在就跑**：会闪一下你的任务栏，无副作用

---

## 九、参考文献

**注意力与打断**
- Mark, G., Gudith, D., & Klocke, U. (2008). *The cost of interrupted work: More speed and stress.* CHI '08. https://dl.acm.org/doi/10.1145/1357054.1357072
  （注："约 23 分钟才能回到原任务"是 Mark 团队被广泛引用的数字，量级参考；CHI'08 本文的实证结论是**被打断的工作做更快但压力、挫败、时间压力、努力程度都更高**。我按量级引用，不当精确结论。）
- Stothart, C., Mitchum, A., & Yehnert, C. (2015). *The attentional cost of receiving a cell phone notification.* JEP:HPP, 41(4), 893–897. https://pubmed.ncbi.nlm.nih.gov/26121498/
- Kushlev, K., Proulx, J., & Dunn, E. W. (2016). *"Silence Your Phones": Smartphone notifications increase inattention and hyperactivity symptoms.* CHI '16. https://dl.acm.org/doi/abs/10.1145/2858036.2858359
- Fitz, N., Kushlev, K., Jagannathan, R., Lewis, T., Paliwal, D., & Ariely, D. (2019). *Batching smartphone notifications can improve well-being.* Computers in Human Behavior. https://www.sciencedirect.com/science/article/abs/pii/S0747563219302596

**未完成目标、侵入性思维、注意力残留**
- Masicampo, E. J., & Baumeister, R. F. (2011). *Consider it done! Plan making can eliminate the cognitive effects of unfulfilled goals.* JPSP. https://pubmed.ncbi.nlm.nih.gov/21688924/
- Masicampo, E. J., & Baumeister, R. F. (2011). *Unfulfilled goals interfere with tasks that require executive functions.* JESP. https://www.sciencedirect.com/science/article/abs/pii/S0022103110002283
- Leroy, S. (2009). *Why is it so hard to do my work? The challenge of attention residue when switching between work tasks.* OBHDP. https://www.sciencedirect.com/science/article/abs/pii/S0749597809000399

**不确定性与焦虑**
- Grupe, D. W., & Nitschke, J. B. (2013). *Uncertainty and anticipation in anxiety: An integrated neurobiological and psychological perspective.* Nature Reviews Neuroscience. https://pubmed.ncbi.nlm.nih.gov/23783199/

**等待心理学**
- Maister, D. (1984) 等待心理原则；后由 Davis & Heineke (1994)、Jones & Peppiatt (1996) 各补一条。中文转录（10 条）：https://xlzx.whu.edu.cn/info/1024/1589.htm
  本设计用到第 1（无所事事）、第 3（焦虑放大）、**第 4（不确定 > 已知有限）**、第 5（无理由 > 有理由）条。

**AI 交互体验**
- Guo, Y. et al. (2025/2026). *QoNext: Towards Next-generation QoE for Foundation Models.* arXiv:2509.21889. https://arxiv.org/abs/2509.21889
  （把 QoE 框架用于人机交互，指出生成速度与延迟模式是体验的决定因素之一——支持"等待体验"必须被当作一等设计对象。）

**本机源码取证**
- `<DSH 安装目录>\resources\app.asar\lib\main.js`（Electron 主进程：`flashFrame`、`Tray`、IPC 白名单）
- `app.asar\dsh\node_modules\@deepseek-ai\dsh-user-approval\lib\index.js`（审批审计对与 fail-closed 兜底）
- `app.asar\dsh\node_modules\@deepseek-ai\dsh-user-questions\lib\index.js`
- `app.asar\dsh\node_modules\@deepseek-ai\dsh-goal\lib\index.js`
- 取证脚本：`probe-desktop-notify.mjs`、`probe-flashframe-path.mjs`、`probe-host-seams.mjs`、`probe-approval-hook.mjs`（均在本工作区，可复跑）

---

## 附：一个需要警惕的引用事故

规划过程中搜索到一条看起来非常贴题的片段——"用户对 AI 延迟有两种代价高昂的反应：要么干等，要么切去做别的"。追到源头（arXiv:2609.24616）发现那是一篇**代码渲染的眼动研究**，跟 AI 延迟毫无关系，是搜索引擎的错误拼接。

**记在这里**是因为它正好说明：这个设计里所有看起来"显然成立"的心理学断言，都必须回到原始文献核对一遍再用。

---

# 实施记录（2026-10-03）

> 本节记录动手之后的**实测结果**，包含两处推翻原设计的负结果。
> 所有读数都来自工具回执或持久化日志，不是推断。

## 十、P0 技术验证：通过

**结论：任务栏闪烁可用，且不抢焦点。**

| 项 | 实测值 |
|---|---|
| 目标窗口 | `hwnd=0x950D62`，class `Chrome_WidgetWin_1`，标题 `… — DeepSeek Harness` |
| `focusStolen` | **false**（连续 4 次调用，前台全程停在别的窗口） |
| `isIconic` | false（没缩到托盘，任务栏有按钮可闪） |
| 单次调用耗时 | 约 7 ms |
| 后台 3 轮（每轮 10 下、间隔 14s） | 全部 `focusStolen=false` |

### 10.1 两个必须记住的坑

**① `FlashWindowEx` 的返回值不是成功/失败。**
文档原文是「调用前窗口是否处于活动状态」。闪一个**非活动**窗口——正是我们的用例——返回 0 是**正常的**。我第一版把它当 `ok` 输出，两次都 `ok:false`，差点误判成失败。已改为 `wasActiveBefore`，并把 `ok` 定义为"调用未抛异常"。

**② 视觉确认没拿到。** 程序化证据齐全，但用户反馈"没注意/错过了"。所以 `flash` 仍是 false，等重启后再做一次更显眼的验证（L0 用 `-Mode all -Count 15`，任务栏+标题栏一起闪）。

## 十一、环境硬约束（踩过一次就别踩第二次）

| # | 约束 | 症状 | 处置 |
|---|---|---|---|
| 1 | **`.ps1` 必须 UTF-8 带 BOM + CRLF** | 本机 ANSI 代码页 936；无 BOM 的 UTF-8 中文脚本被按 GBK 解码，多字节字符吞掉换行 —— 190 行的文件 `Get-Content` 只数出 179 行，报出 `Missing closing '}'` 这种**假语法错误** | `tools/normalize-ps1.mjs`（纯 Node 写，避开鸡生蛋），已定为项目硬约定 |
| 2 | **执行策略是 RemoteSigned** | 直接 `& script.ps1` 被拒：`未对文件进行数字签名` | 一律 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File …` |
| 3 | **`pwsh` 不在 PATH** | `pwsh` 报 CommandNotFound | 用 `powershell.exe`（5.1.26100 / Desktop 版） |
| 4 | **HMR 不重载已装 host 插件的代码** | 改完 `index.js`，`plugin-activated` 记录里仍是旧 config，计数仍为 1 | **必须完全退出并重开客户端**。这是本项目的开发循环瓶颈 —— 代码要一次写够，别指望边改边看 |

> 第 4 条直接改变了工作方式：host 半区每改一次代码都要重启一次客户端。相比之下 **Client 半区的改动刷新页面即生效**（参照 qq2005 的 junction 模式）。这个不对称值得在设计上利用——把需要快速迭代的逻辑尽量放到 Client。

## 十二、传感器架构被推翻并重建

### 12.1 负结果 A：审批"没被记录" —— 是时间不巧，不是坏了

插件激活于 `2026-10-03T15:48:26.715Z`（epoch `1791042506715`）。会话日志里那次提权审批是：

```json
{"type":"approval/asked","seq":369,"time":1791042498200,
 "data":{"id":"e3be4aa1-…","toolName":"pwsh","callId":"call_00_uFx7tEP5d9IlghTc7fsu2640",
         "reason":"escalate sandbox to danger-full-access: 安装插件必须写入工作区之外的桌面端 profile 目录…"}}
```

`1791042498200` 比激活时刻**早 8.5 秒**。

**教训**：差点把"激活前发生的事"当成"传感器坏的证据"。`events.jsonl` 里没有记录 ≠ 订阅不通 —— 必须先确认**激活之后确实发生过该类事件**，再下结论。

### 12.2 负结果 B：提问的 waterfall 路走不通（真失败）

原设计：提问挂 `ctx.on('user-questions/request', (req, next) => { 观测; return next() })` 的 pass-through 监听。

**实测证伪。** 激活后 +45.6s 我发起了一次 `ask_user_question`（seq=412, time `1791042552288`），插件**没有记录**。

同一份日志里它确实存在，但形态是 `tool/call`：

```json
{"type":"tool/call","seq":412,"time":1791042552288,
 "data":{"turn":3,"step":35,"callId":"call_00_WvRnnDm6zf0PA5ZwXXAg5434",
         "name":"ask_user_question","arguments":"{\"questions\":[…]}"}}
```

**根因**：源码是 `this.ctx.waterfall(scopeTarget(agent, agent), "user-questions/request", {…request, agent}, noAnswerer)` —— 事件派发时带了一个**作用域载体**，作用域挂在 agent 上。根 ctx 上的插件监听者收不到。
（`scopeTarget` 的 filter 里确实有 `if (tag === undefined) return true`，但实测表明在本插件的装载位置下不足以让它收到。理论推断到此为止，以实测为准。）

### 12.3 修正后的架构：**单一来源，全部走会话日志**

| 触发 | 事件 | 判据 |
|---|---|---|
| L0 审批 | `approval/asked` | 事件类型本身 |
| L0 提问 | `tool/call` | `data.name === 'ask_user_question'` |
| L1 目标达成 | `goal/change` | `data.operation === 'complete'` |
| L1 意外中断 | `turn/end` | `data.reason.kind === 'aborted'` 且嵌套的 `reason.kind !== 'user'` |
| L2 正常结束 | `turn/end` | `data.reason.kind === 'completed'`（只记录） |

好处：**一个只读订阅覆盖全部触发器**，不碰 waterfall、不碰作用域、不碰决策接缝，且覆盖所有会话（含未渲染的）。比原设计更简单也更安全。

## 十三、会话事件实测地图

从当前会话（`session-d0cca844…`，491 事件，295 个 zstd 帧）解出的真实分布：

```
 80  tool/call                      ← 提问从这里读
 79  tool/result
 67  session-log-deepseek/delivery-accepted
 66  step/start        66  assistant/message        65  step/end
 18  web/deepseek-search-llm-request
  8  agent/inbox/spliced            8  user/message
  3  turn/start                     3  goal/change
  2  turn/end                       2  workspace/changes
  1  approval/asked                 1  approval/decided
  1  approval/policy  session/title  permission/preset  sandbox/mode  request/header …
```

**注意：整个日志里没有任何 `user-questions/*` 事件** —— 这是 12.2 的独立佐证。

### 实测字段形状（别猜）

```js
approval/asked    { id, toolName, callId?, reason? }
approval/decided  { id, outcome }              // 实测 outcome = 'allowed-once'
turn/start        { turn }
turn/end          { turn, reason: { kind } }   // kind 实测 'completed' | 'aborted'
                  // 嵌套：{"kind":"aborted","reason":{"kind":"user"}}
goal/change       { kind, version, operation, goal? }
                  // operation 实测 'create' | 'pause' | 'clear'
                  // ⚠️ goal 是 JSON 字符串，不是对象，必须 JSON.parse
tool/call         { turn, step, callId, name, arguments }   // arguments 也是字符串
```

> ⚠️ 我原来的代码写的是 `String(data.reason)`，对一个对象会得到 `[object Object]`。已修。

## 十四、开发过程中的两点自省

**① `session/event` 的边沿订阅是官方自己的用法。**
`practices.md` 第 26 行警告的是「用 `session/event` 建**派生状态**再重扫」，而官方包 `dsh-agent-preset-registry` 自己就是：

```js
ctx.on("session/event", (session, event) => {
  if (event.type === "agent-preset/selected") ctx.emit("agent-preset/selected", …)
})
```

「边沿 → 副作用」（发通知）与「订阅 → 建状态」是两件事，前者合规。这一点我一开始差点因为误读规范而放弃最合适的方案。

**② 未完成目标的机制真的启动过。** `goal/change` 序列是 `create`(seq=64) → `pause`(seq=77) → `clear`(seq=187)。`clear` 发生在用户打断我、说"先规划设计，不要马上开工"之后。`get_goal` 现在返回 `null`。**推断用户的意图是阻止我自动继续往下建，因此我没有重建 goal**（重建会重新开启自动续跑）。

## 十五、待重启后验证的清单

重启客户端（完全退出，注意托盘）后按序做，每步核对 `dsh-quiet/events.jsonl`：

1. **激活**：出现 `plugin-activated`，且 config 里带 `_patchProbe: "cordis.patch.yml-loaded"` → 证明包内 patch 文件确实被读取（此前无法区分它和代码默认值）。
2. **订阅通不通**：出现 `debug-event` 记录（`debugAllEvents: true`）→ 证明会话日志订阅到货。这是零成本的强证据。
3. **L0 审批**：触发一次提权 → 出现 `kind: "approval"`。
4. **L0 提问**：问一个 `ask_user_question` → 出现 `kind: "question"`。
5. **L1 turn 中断**：非用户原因的中断 → `kind: "turn-aborted"`。
6. **无误报**：正常回复结束时只应出现 `turn-end`(L2)，`alerting` 应为 false。
7. **改 `flash: true`** 再做一次 L0，确认任务栏+标题栏真的闪、且不抢焦点。

## 十六、P3 专注块：用 `/focus` 命令替代自建 UI

原计划 P3 要写 Client 半区的界面。**改掉了。** 理由：

1. **Client↔Host 那道缝的 API 面不清楚。** 官方要求「用 inspection 找到 Client 可调用的 Host 入口，例如 `ctx.remote.commands.execute()`」，而本会话没有 `cordis_inspect_query`。盲写一个跨半区调用，风险与收益不成比例。
2. **自建 UI 是本项目风险最高的一段。** qq2005 记录过 `sidebar.panellist` 上的注册会让整个客户端插件激活失败、应用起不来。
3. **命令本身就是界面的一个面。** `/focus` 的返回文本会显示在对话里 —— 展示"攒下的事"这件事，命令输出完全够用。

已取的 API（`dsh-command-feedback`、`dsh-command-compact` 的真实用法）：

```js
ctx.commands.register({
  definitionId: 'dsh-quiet/focus',   // 可选字段
  name: 'focus',                        // 必须匹配 COMMAND_NAME
  description: '…',                     // 非空字符串
  input: { hint: '<分钟> | off | digest' },
  handler: (invocation) => ({ kind: 'success'|'error', text: '…' }),
});
// invocation = { rawInput, agent, signal, commandId }
```

🔬 **关键取证**：`CommandDefinitionId(id) { return id; }` 是**纯恒等函数，不做任何校验**；`normalizeDefinition` 也**不校验 `definitionId`**。所以工作区插件可以直接传字符串，不需要（也无法）从工作区 import asar 内的品牌模块 —— 而 `profile/node_modules/@deepseek-ai/*` 那份是指向旧开发检出的 junction，版本可能是错的，不碰为妙。

`commands` 用 `ctx.inject(['commands'], …)` 局部获取：缺失时插件仍能观测，只是没有 `/focus`。

### 命令语义

| 命令 | 行为 |
|---|---|
| `/focus <分钟>` | 开始专注块（`0` = 不定时）。返回**托管声明** |
| `/focus off` | 提前结束，列出攒下的事 |
| `/focus` | 状态；已在专注时同时把攒下的事列出来 |
| `/focus digest` | 只看攒下的事 |

**托管声明**（Masicampo & Baumeister 2011 的直接应用 —— 为未完成目标制定具体计划可消除其侵入性思维）：

> 专注 50 分钟。
> 这段时间你不用管它：被卡住（要审批 / 要你回答）会闪任务栏叫你，其他进展一律攒着，不打扰。
> 到点我会闪一次，并把攒下的事列出来。

专注块状态持久化到 `focus.json`；跨重启若已过期会自动收尾，不静默丢失。

## 十七、传感器做成三路径 + 去重（一次确定性实验）

`session/event` 的派发是 `collectSessionCallbacks(entry.emitCtx, [entry.carrier, "session/event", …])` —— **和刚被证伪的提问 waterfall 是同一套 carrier 作用域机制**。它到底到不到得了插件 ctx，只有重启后才能观察到。

重启代价太高（见第十一节第 4 条），所以**不做赌注**：

| 路径 | 注册位置 | 理由 |
|---|---|---|
| 1 | `ctx.on('session/event', …)` | 惯用法，官方包就这么写 |
| 2 | `ctx.root.on('session/event', …)` | 最宽的祖先作用域 |
| 3 | `agent.ctx.on('session/event', …)`（在 `agent/created` 里） | 覆盖 agent 作用域 |

- **按 `(sessionId, seq)` 去重**：多注册从"重复提醒的隐患"变成"无副作用的保险"。
- **每条记录带 `via` 字段**：重启后直接看出哪条路径有效，然后把多余的删掉。
- 路径 2/3 的 disposer 都收进插件自己的 `ctx.effect`（practices.md 第 8 行：注册在别的 context 上就有两个 owner）。

## 十八、自检脚本：把踩过的坑固化成回归断言

`tools/self-check.mjs`，34 项断言，`node dsh-quiet/tools/self-check.mjs`，退出码即结果。

其中两条是**真正有价值的**，因为它们守的是"语法合法但运行时不工作"的错误：

- 断言源码里**不出现** `ctx.on('user-questions/…')` → 守住第 12.2 节那个坑。
- 断言 `.ps1` 是 **UTF-8 带 BOM + CRLF** → 守住第 11 节第 1 条。

**顺带踩到一个元层面的坑**：第一版断言直接扫原文，结果被**文件头注释里的取证记录**骗过 —— 注释里写着「已证伪：`ctx.on('user-questions/request', …)`」和「`session.append("approval/asked", …)`」，断言就把这些当成了违规代码，报了两个假失败。**扫源码做断言必须先剥注释**，否则断言会被自己的文档骗过。已在 `stripComments()` 里修掉。

## 十九、当前状态

- 插件已装进 desktop profile（`package.json` → `dsh.profile.bundles` 含 `dsh-quiet`），`node_modules/dsh-quiet` 是 **Junction** 指回工作区。
- profile 冷备份：`<DSH_HOME>\profile-backups\<时间戳>\`（5 文件），备份内 `cordis.patch.yml` 哈希与原文件一致。
- `node --check` 通过；自检 34/34 通过。
- **运行中的仍是旧代码**（激活时那份）。以下都已写进文件但**尚未加载**：三路径传感器、`/focus` 命令、`tool/call` 提问判定、`turn/end` 结构化 reason、`_patchProbe` 诊断键。
- **未做**：P5 度量埋点（n-of-1 方案里的指标采集）、把 `flash` 打开、把 `debugAllEvents` 关掉。

### 重启后的验证顺序

1. `plugin-activated` 里出现 `_patchProbe: "cordis.patch.yml-loaded"` → 证明包内 patch 文件确实被读（此前无法区分它和代码默认值）。
2. 出现 `kind: "delivery"` 记录 → 订阅到货。**看 `via` 字段，记下哪条路径有效。**
3. `/focus 1` → 出现 `focus-start`；回复托管声明。
4. 触发一次提问 → `kind: "question"` 且 `alerting` 为 true。
5. 触发一次提权 → `kind: "approval"`。
6. `/focus off` → 列出攒下的事；验证专注期间的 L1 被攒而不是被丢。
7. 无误报：正常回复结束时只有 `turn-end`(L2)，`alerting: false`。
8. 确认 2 之后，**删掉多余的注册路径**，把 `debugAllEvents` 改 false。
9. 最后才把 `flash` 改 true，验任务栏闪烁（L0 用 `-Mode all -Count 15`，上次用户没看见）。

---

# 第二轮（2026-10-04）：改名为 dsh-quiet + P1 验收通过

## 二十、安装即激活：新 bundle 走 HMR，不需要重启

这条推翻了我原来的判断（第十一节第 4 条）：**"已装插件的代码改动需要重启"只对已激活的 bundle 成立；把一个新 bundle 装进去，它当场就走 HMR 激活了。**

实测：`pnpm add` 建好 junction 后，`events.jsonl` 立刻出现新的 `plugin-activated` 记录。于是改名换目录这一步**没有付出重启代价**。

但**配置改动不热重载**：把 `flash: false` 改成 `true` 后等了 6 秒，没有新的 `plugin-activated`，运行中的实例仍是旧配置。所以 `flash` 开关仍要等重启才生效。

## 二十一、`_patchProbe` 命中了：包内 patch 文件确实被读取

激活记录里的 config：

```json
{"flash":false,"focusMinutes":25,"focusL0Penetrates":true,
 "l0FlashMode":"tray","l0FlashCount":15,"l1FlashMode":"tray","l1FlashCount":8,
 "logPath":"","debugAllEvents":true,"_patchProbe":"cordis.patch.yml-loaded"}
```

`_patchProbe` 只存在于 `cordis.patch.yml`，代码里没有。它出现在 config 里 → **`dsh.bundle.patch` 指向的包内 patch 文件确实被 loader 读取**。此前无法区分"配置来自 patch"还是"来自代码默认值"，因为两者数值完全一致 —— 这就是当初加诊断键的理由。

## 二十二、传感器验收：`plugin-ctx` 到货，另两条冗余

```
{"kind":"delivery","via":"plugin-ctx","eventType":"tool/result","seq":888,"duplicate":false}
{"kind":"delivery","via":"root-ctx",  "eventType":"tool/result","seq":888,"duplicate":true }
{"kind":"delivery","via":"plugin-ctx","eventType":"step/end",   "seq":889,"duplicate":false}
{"kind":"delivery","via":"root-ctx",  "eventType":"step/end",   "seq":889,"duplicate":true }
```

| 路径 | 结果 | 处置 |
|---|---|---|
| `plugin-ctx` | ✅ 首次到货（`duplicate:false`） | **保留** |
| `root-ctx` | 收到但全部 `duplicate:true` —— 冗余，白做一半功 | 删除 |
| `agent-ctx` | 一次都没出现（当前 agent 在插件激活前就已创建）；且 plugin-ctx 已能收到**其它会话**的事件 | 删除 |

**去重的价值被证实**：没有它，每条会话事件会被处理两遍。代码已收敛为单路径 + 保留有界去重 Set（防将来重复注册）。

### 顺带把 L0 审批链路验穿了

激活前的那份**旧代码**其实已经正确工作了，只是当时没有可分类的事件。旧日志里有：

```json
{"level":"L0","kind":"approval","title":"有操作卡在等你审批",
 "eventType":"approval/asked","seq":850,"alerting":true,
 "focusActive":false,"flashed":false,"skipped":"config.flash=false"}
```

判级、`alerting`、以及"因为 flash 关着所以没闪"的降级原因**全部正确**。另一条 `turn-end` 来自 session `36dfb814…`，说明**跨会话覆盖**也成立。

### 旧代码的一个 bug 被实证

```json
{"kind":"turn-end","detail":"[object Object]"}
```

第十二节里我改掉的 `String(data.reason)` 会得到 `[object Object]` —— 现在是实证而非推断。

## 二十三、又两个环境坑（踩了，都不轻）

| # | 坑 | 症状 | 处置 |
|---|---|---|---|
| 5 | **PowerShell `Get-Content` 按 GBK 读 UTF-8 文件** | 日志里的中文显示成 `涓€杞粨鏉`（"一轮结束"被按 GBK 解出的样子）。**文件本身是好的** —— 用 read 工具看是正确中文 | 在这台机器上查 UTF-8 文件**不能用 `Get-Content`**，用 read 工具或 Node |
| 6 | **`Set-Content -Encoding UTF8` 会写入 BOM** | 我用它回写 profile 的 `package.json`，`JSON.parse` 直接报 `Unexpected token '﻿'` | 用 Node 写文件（默认无 BOM）；脚本里也要先剥 `\uFEFF` |

## 二十四、改名事故记录（profile 被弄成非法 JSON）

`dsh plugin` **只是把参数原样转发给 pnpm**（源码注释原文：`forwarding the remaining arguments to pnpm in the profile directory`）。两个后果我没预料到：

**① `pnpm remove` 不认 `--registry`**（而 `pnpm add` 认）。于是 `remove dsh-sentinel` 直接失败：
```
[ERROR] Unknown option: 'registry'
```
旧的依赖项残留。

**② `dsh.profile.bundles` 不归 pnpm 管。** `add` 成功时会把新包**追加**进这个数组；`remove` 是裸转发，**不会**删。所以改名必须同时修这两处。

**③ 我用文本删行去掉 bundles 里的 `"dsh-sentinel"`，留下尾随逗号 → profile 的 `package.json` 变成非法 JSON。**

三个都修好了，方法是写了一个专门的修复脚本 `tools/repair-profile-package.mjs`：文本修复（剥 BOM、去尾随逗号、删残留依赖行）→ **JSON 解析校验，不通过就不写盘** → 原子写（临时文件 + 复读校验 + rename）。过程留了备份 `package.json.broken-20261004-091319`。

**教训**：改 profile 的这种文件，PowerShell 字符串操作太糙；应当用 Node 做解析式修改 + 写前校验。

修好后的最终状态已验证：JSON 合法、无 BOM、bundles 与依赖都只剩 `dsh-quiet`、旧 junction 用 `cmd /c rmdir` 清掉（`rmdir` 对 junction 只删链接不动目标）、`pnpm install` 报 "Already up to date"、`node_modules/dsh-quiet` junction 指向新目录。

## 二十五、当前状态与剩余验证

**已验证（不需要重启就拿到）**
- ✅ 插件被 loader 加载、`apply` 执行、配置来自包内 patch
- ✅ 会话日志订阅到货（`plugin-ctx`），去重生效
- ✅ L0 审批判级与 `alerting` 正确；`turn/end` 结构化 reason 已修
- ✅ 跨会话覆盖（收到了另一个 session 的事件）
- ✅ 自检 **45/45**（`node dsh-quiet/tools/self-check.mjs`）

**仍需重启才能验（配置不热重载）**
1. `flash: true` 是否真的生效 → 日志里 `flashed:true`
2. **任务栏是否真的闪**（上次用户没看见；现在 L0 用 `tray` 模式 15 次）
3. `/focus` 命令是否注册成功 → 日志里应有 `command-registered`
4. 番茄钟默认 25 分钟、`/focus 5` 自定义、`/focus off` 给出 digest
5. 专注块内 L1 是否被**攒下**而不是丢弃，块结束时一次给出

**未做**：P5 度量埋点（n-of-1 方案里的指标采集）。

### 重启后的最小验证清单

1. 看 `dsh-quiet/events.jsonl` 有没有新的 `plugin-activated`，且 `flash: true`
2. 有没有 `command-registered`
3. 发 `/focus 5` → 应回托管声明；日志有 `focus-start`
4. 让我做一件需要提权的事 → **任务栏应该闪**，日志 `kind:"approval"` + `flashed:true`
5. `/focus off` → 应列出攒下的事
6. 若第 4 步没看见闪，把 `l0FlashMode` 改成 `all` 再重启一次（仍在"只闪不抢焦点"的范围内）

---

# 第三轮（2026-10-04）：P2 验收通过 + 抓到一个真漏报

## 二十六、前两次"没看见"是测试条件错了，不是功能坏了

`FLASHW_TRAY` 打在**前台窗口**上是**物理上没有意义**的 —— 那个任务栏按钮本来就亮着，没什么可闪的。

复盘三次视觉测试：

| 次序 | 布置 | 当时前台 | 结果 |
|---|---|---|---|
| 第 1 次（P0） | 后台 3 轮、间隔 14s | 一直是别的窗口 | 用户"没注意"——窗口太窄 |
| 第 2 次 | 延时 20s 起闪两轮 | **第 1 轮时 DSH 自己在前台** | 第 1 轮作废；第 2 轮时用户已切到 Chrome，有效 |
| 第 3 次 | 延时 25s、6 轮、间隔 22s | **6 轮全部 DSH 在后台**（前台恒为 Chrome） | ✅ 条件全部合格 |

第 3 次的次数证据：6 轮 `wasForeground:false`、6 轮 `focusStolen:false`。

**用户结论：6 轮都注意到了，但分辨不出哪轮是 tray、哪轮是 all。**

→ 于是 **`l0FlashMode` 保持 `tray`**：单闪任务栏在真实场景下已经足够可察觉，加标题栏（`all`）没带来可辨的增益。保持最克制的设置更符合本插件的立意。

## 二十七、执行器端到端证据（插件自己闪的）

我提的两个问题各触发一次 L0，插件自己完成判定与闪烁：

```json
{"level":"L0","kind":"question","title":"agent 在问你问题",
 "via":"plugin-ctx","eventType":"tool/call","alerting":true,
 "flashed":true,"pid":36340,"flashMode":"tray","flashCount":15}
```

`flashed:true` + `pid` + 实际模式与次数 —— 传感器→分级→执行器整条链路闭环。

## 二十八、抓到一个真漏报：`max-tokens`

同一次日志读取里出现了没见过的 `reason.kind`：

```json
{"kind":"turn-end","detail":"max-tokens",
 "sessionId":"cdbccc16-be87-41a1-8d92-43f44e101a3f","alerting":false}
```

`max-tokens` = 被输出上限**截断**，不是正常结束。而第一版的判定是**枚举法**（只把 `aborted` 当异常，其余一律 L2），于是它落进默认分支、安静地不提醒。

**这正是公理 0 要防的那类失败**：你走开时任务被截断，回来还以为它在跑。

**修法：把枚举法换成"默认倒向提醒"。**

```
completed        → L2（正常收尾）
aborted + user   → L2（你自己按停的，你知道）
其它一律          → L1  ← 包括 max-tokens，以及将来任何没见过的 kind
```

原则是：**未知取值时必须倒向"多报一次"，而不是倒向"沉默"。** 已加回归断言：必须有 `turn-incomplete` 这条 L1 兜底分支。

（顺带又一次确认了跨会话覆盖：这条来自 session `cdbccc16…`。）

## 二十九、一个反直觉的物理事实，其实是设计优势

闪烁只在 DSH **不在前台**时才有意义 —— 而那正是"你已经走开了"的状态。你人在 DSH 面前时它本来就无需有效。**两个区间恰好不重叠**，所以架构是自洽的，不需要额外补偿逻辑。

由此定下一条**刻意不做**的优化：不加"检测到 DSH 在前台就跳过闪烁"。它看起来能省一次进程启动，但会引入一条静默失败路径 —— 前台检测一旦判错，该闪的不闪。按公理 0：**宁可白闪一次，不可漏闪一次。**

## 三十、当前状态

**已验收**
- ✅ 加载与配置：`plugin-activated` 里 `flash:true`、`focusMinutes:25`、`l0FlashMode:"tray"`、`_patchProbe` 命中
- ✅ 命令注册：`{"kind":"command-registered","command":"focus"}`
- ✅ 传感器：`plugin-ctx` 单路径到货，去重生效，跨会话覆盖
- ✅ 分级：`approval/asked`→L0、`tool/call(ask_user_question)`→L0、`turn/end`→按 kind 分流
- ✅ 执行器：`flashed:true` 端到端；实测任务栏闪烁可被察觉（6/6 轮）
- ✅ 自检 **47/47**（`node dsh-quiet/tools/self-check.mjs`）

**仍待验证**
- ⏳ `/focus 5` 的实际输出（托管声明文案、`focus-start` 落日志、`/focus off` 给出 digest）
- ⏳ 专注块内 L1 是否真的被**攒下**而不是丢弃 —— 需要一次专注期内发生 L1 事件才能验
- ⏳ `max-tokens` 那条 L1 修复要**下次重启**才加载（代码与配置都不热重载）

**未做**：P5 度量埋点（n-of-1 方案里的指标采集）。




