# dsh-quiet

让 agent 在你离开时替你盯着，**只在真的需要你出手时**才叫你。

---

## 它解决什么

等 AI 干活的时候人不敢走开。原因不是它慢——再快也还是要等。真正让人坐立不安的是**你不知道它什么时候会停下来等你**。

于是你只好盯着。而盯着是有代价的：每一次"瞄一眼"都会把你从手头的事里拽出来，回来还要重新进入状态。

dsh-quiet 把"盯着"这件事接过去。你交代完就走，它只在两件事上叫你：

- **它卡住了**——要你审批、或者要你回答问题。它自己过不去，你不来它就一直停着。
- **有结果了**——目标达成、意外中断、或者回复被截断。

除此之外一律安静。中间某一步做完了这种事，它**不会**来烦你——那种提醒对你没有用，只是打断。

## 安装

```powershell
$env:DSH_HOME = "$env:USERPROFILE\.dsh"
dsh plugin --profile desktop add "link:<dsh-quiet 的绝对路径>" --registry=https://registry.npmmirror.com
```

装完当场就会激活。但**如果你之后改了插件代码，必须完全退出并重开客户端**才加载新代码——注意托盘，关窗口可能只是最小化。

> ⚠️ 不要在插件市场里「停用」这个插件。桌面端的停用意图会失败并每 60 秒重试，反复重写 `cordis.patch.yml`，实测会把该文件从 13 KB 刷成 661 B，agent preset 与模型设置全丢。

## 使用

只有一条命令：`/focus`。

| 你打 | 它做什么 |
|---|---|
| `/focus` | 开始专注块，默认 25 分钟 |
| `/focus 40` | 自定义时长 |
| `/focus 0` | 不定时，直到你说停 |
| `/focus off` | 提前结束，并列出这段时间攒下的事 |
| `/focus status` | 看当前状态和攒下的事 |
| `/focus digest` | 只看攒下的事 |

开始时会给你一句**托管声明**：

> 专注 25 分钟。
> 这段时间你不用管它：被卡住（要审批 / 要你回答）会闪任务栏叫你，其他进展一律攒着，不打扰。
> 到点我会闪一次 —— 那就是你的短休息，顺手把攒下的事过一遍就行。

这句话不是装饰。研究上，为一件没做完的事**写下一个具体计划**，就能消掉它带来的那种"心里悬着"的干扰。声明就是那个计划。

## 提醒的分级

| 级别 | 什么时候 | 专注块内 |
|---|---|---|
| **L0 卡住了** | 要你审批 / agent 问你问题 | **穿透**——会立刻闪你 |
| **L1 有结果了** | 目标达成 / 意外中断 / 回复被截断 | 攒着，结束时一起给 |
| **L2 中间进展** | 某一步做完、一次回复正常结束 | **永不提醒** |

L0 为什么穿透：审批是 fail-closed 的，你不应答它就永远不做。不穿透的代价不是"晚点知道"，而是"任务停摆"。

L2 为什么不可配：仅仅**收到**一条通知、不需要回应，就足以损害注意力任务的表现。而 L2 不阻塞任何事——提醒的收益是零，成本是一次实打实的打断。

## 提醒长什么样

**只闪任务栏按钮，不弹通知、不出声、不抢焦点。**

抢焦点会打断你手上的事，所以不做。系统通知和声音则是更大的打断——真需要这两种，说明这个插件的取舍不适合你。

注意一个反直觉但正常的点：**你人正在 DSH 窗口里的时候，闪烁看不出效果**——因为那个任务栏按钮本来就亮着。闪烁只在 DSH 不在前台时才有意义，而那时候正是你走开了。两个区间不重叠，所以这里不需要额外补偿。

## 为什么这样设计

下面每一条都不是"感觉应该这样"，而是有研究支持、或者有明确的推论链。

### 等待 AI 为什么让人焦虑

这不是一个毛病，是三个独立机制叠出来的：

| 机制 | 研究 | 在你身上的表现 |
|---|---|---|
| **不确定性本身就是致焦虑源**，跟结果好坏无关 | Grupe & Nitschke (2013)：对不确定性的持续预期直接驱动焦虑；人宁愿要一个确定的坏结果，也不要不确定 | "它还要多久？是不是卡住了？是不是在等我？"——于是反复回去看 |
| **没做完的事会一直占着脑子** | Zeigarnik 效应；Masicampo & Baumeister (2011)：未完成目标会损害后续任务的表现；Leroy (2009)：任务切换会留下"注意力残留" | 你切去干别的，却干不进去——那个跑着的任务一直占着内存 |
| **等待的主观时长被放大** | Maister (1984) 等待心理原则：无所事事的等待 > 有事可干的等待；焦虑使等待更长；**不确定的等待 > 已知有限的等待** | 实际等了 3 分钟，感觉像 15 分钟，于是更焦虑、更盯 |

另外，被打断的工作虽然做得更快，但压力、挫败感、时间压力和努力程度都更高（Mark, Gudith & Klocke, CHI '08）。所以"我再瞄一眼"不是免费的。

**关键推论**：这三条没有一条是"AI 太慢"造成的，全部是"**你不知道什么时候该回来**"造成的。

所以让 AI 更快治不了这个病——再快也还是有等待，不确定性一点没减。真正能治的是把**监控责任从人转移到系统**。

而这件事有个前提：**信任**。系统只要漏叫一次，你就会退回盯屏幕，前面全白做。所以这个插件的第一条规矩不是"少打扰"，而是「**宁可多闪一次，不可漏闪一次**」。

### 由此定下的规矩

| 规矩 | 依据 | 具体做法 |
|---|---|---|
| **提醒必须极度吝啬** | Stothart, Mitchum & Yehnert (2015)：仅仅**收到**一条通知、不需要回应，就足以损害注意力任务的表现，程度与主动用手机相当。Kushlev, Proulx & Dunn (2016)：通知增加注意力涣散 | 只在此人不在就**真的进行不下去**、或整件事有了终态时才提醒 |
| **批量优于实时** | Fitz, Kushlev, … & Ariely (2019)：把通知批处理到每天 3 次，改善了注意力、降低了压力与负性情绪 | 专注块：非阻塞事件一律攒着，结束时一起给 |
| **不给"预计剩余时间"** | 推论。Maister 说"已知有限"的等待更好受，产品直觉于是是给进度条——但 agent 的剩余时间本质不可预测，**给错比不给更伤信任** | 不显示倒计时。改为给有限性承诺：不是"还要 3 分钟"，而是"**你不需要等**" |
| **专注开始时给一句托管声明** | Masicampo & Baumeister (2011)：为未完成的目标**制定一个具体计划**，就能消除它带来的侵入性思维 | 那句"接下来 25 分钟我不管它"就是那个计划，不是仪式感 |
| **不产生未读计数、不产生待清空的列表** | 反身性推论：一个带角标的面板 = 一个新的未完成任务 = 又一条 Zeigarnik | 提醒是瞬时的，闪完即止；没有"未读 3 条"这种东西 |
| **回来时给结论，不给状态列表** | Leroy (2009)：没有闭合感的任务切换会持续污染下一件事 | `/focus off` 给的是"攒下了这些事"，不是一堆日志 |

更完整的设计推导与源码取证记录见 `DESIGN.md`。

### 文献

**注意力与打断**

- Mark, G., Gudith, D., & Klocke, U. (2008). *The cost of interrupted work: More speed and stress.* CHI '08. https://dl.acm.org/doi/10.1145/1357054.1357072
- Stothart, C., Mitchum, A., & Yehnert, C. (2015). *The attentional cost of receiving a cell phone notification.* JEP:HPP, 41(4), 893–897. https://pubmed.ncbi.nlm.nih.gov/26121498/
- Kushlev, K., Proulx, J., & Dunn, E. W. (2016). *"Silence Your Phones": Smartphone notifications increase inattention and hyperactivity symptoms.* CHI '16. https://dl.acm.org/doi/abs/10.1145/2858036.2858359
- Fitz, N., Kushlev, K., Jagannathan, R., Lewis, T., Paliwal, D., & Ariely, D. (2019). *Batching smartphone notifications can improve well-being.* Computers in Human Behavior. https://www.sciencedirect.com/science/article/abs/pii/S0747563219302596

**未完成目标、侵入性思维、注意力残留**

- Masicampo, E. J., & Baumeister, R. F. (2011). *Consider it done! Plan making can eliminate the cognitive effects of unfulfilled goals.* JPSP. https://pubmed.ncbi.nlm.nih.gov/21688924/
- Leroy, S. (2009). *Why is it so hard to do my work? The challenge of attention residue when switching between work tasks.* OBHDP. https://www.sciencedirect.com/science/article/abs/pii/S0749597809000399

**不确定性与焦虑**

- Grupe, D. W., & Nitschke, J. B. (2013). *Uncertainty and anticipation in anxiety: An integrated neurobiological and psychological perspective.* Nature Reviews Neuroscience. https://pubmed.ncbi.nlm.nih.gov/23783199/

**等待心理学**

- Maister, D. (1984) 等待心理原则（后由 Davis & Heineke 1994、Jones & Peppiatt 1996 各补一条）。中文转录：https://xlzx.whu.edu.cn/info/1024/1589.htm

**AI 交互体验**

- Guo, Y. et al. (2025/2026). *QoNext: Towards Next-generation QoE for Foundation Models.* arXiv:2509.21889. https://arxiv.org/abs/2509.21889

> 以上每条都回过原始文献。规划期间搜到过一条"用户对 AI 延迟要么干等、要么切去做别的"、看起来极贴题的结论，追到源头发现是一篇代码渲染的眼动研究——搜索引擎拼接错了。所以这里的断言不敢凭印象写，出处也都留了链接，你可以自己核。

## 配置

改 `cordis.patch.yml` 里的 `config`：

| 键 | 默认 | 说明 |
|---|---|---|
| `flash` | `true` | 总开关。关掉就只写日志、不闪 |
| `alertLevels` | `[L0, L1]` | 允许提醒的级别 |
| `focusMinutes` | `25` | `/focus` 不带参数时的默认时长 |
| `focusL0Penetrates` | `true` | 专注块内 L0 是否穿透 |
| `l0FlashMode` | `tray` | L0 的闪烁模式。`tray` 只闪任务栏，`all` 连标题栏一起闪 |
| `l0FlashCount` | `15` | L0 闪几下 |
| `l1FlashMode` / `l1FlashCount` | `tray` / `8` | L1 的对应设置 |
| `logPath` | `''` | 观测日志路径，留空用包内的 `events.jsonl` |

配置改动**不热重载**，改完要重启客户端。

## 已知限制

- **仅 Windows。** 提醒靠 Win32 `FlashWindowEx` 打任务栏。Electron 自己的 `flashFrame()` 是主进程能力，插件够不到。
- **窗口缩到托盘时闪不了**——托盘里没有任务栏按钮。这是"只做任务栏闪烁"这个选择的固有盲区。
- **人就在 DSH 窗口前时不闪**（见上），这是正常的，不是缺陷。
- 目前只在 DSH 桌面端验证过。

## 开发

```powershell
node dsh-quiet/tools/self-check.mjs      # 47 项断言，退出码即结果
```

改动 `.ps1` 之后**必须**跑一次编码规范化：

```powershell
node dsh-quiet/tools/normalize-ps1.mjs dsh-quiet/tools/flash-dsh.ps1
```

原因：本机是中文 Windows（ANSI 代码页 936）。无 BOM 的 UTF-8 脚本里含中文时，PowerShell 5.1 会按 GBK 解码，多字节字符吞掉换行，报出 `Missing closing '}'` 这种**假语法错误**（实测 190 行的文件只数出 179 行）。编辑器保存时还会把 BOM/CRLF 弄掉，所以每次改完都要重新规范化。

## 更多

- `DESIGN.md` —— 设计依据（心理学文献）、源码取证记录、踩过的坑、被推翻的设计。想改这个插件之前建议先看它。
- `tools/flash-dsh.ps1` —— 提醒执行器（Win32 任务栏闪烁，可单独跑：`-Mode tray|all|caption`、`-Count N`、`-UntilFocused`）。
