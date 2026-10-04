# flash-dsh.ps1 —— 对 DSH 桌面端窗口做 Win32 任务栏闪烁
#
# 用途：dsh-quiet 的提醒执行器（Host 侧 Node 会 spawn 这个脚本）。
#
# 为什么需要它：Electron 的 win.flashFrame() 是主进程能力，插件够不到
# （app.asar/lib/main.js 独占，宿主↔主进程是 process.send 白名单协议）。
# 但 FlashWindowEx 是 Win32 API，任何进程都能对目标窗口调用，不需要 Electron 配合。
#
# 关键性质：FLASHW_TRAY 只闪任务栏按钮，**不抢焦点**——不打断用户正在做的事。
# 这正是"最小侵入提醒"的物理实现。
#
# 用法：
#   pwsh -NoProfile -File flash-dsh.ps1                        # 闪 8 次，只闪任务栏
#   pwsh -NoProfile -File flash-dsh.ps1 -Mode all              # 任务栏+标题栏
#   pwsh -NoProfile -File flash-dsh.ps1 -UntilFocused          # 持续闪到窗口置前（L0 用）
#   pwsh -NoProfile -File flash-dsh.ps1 -WaitForBackground 45  # 等焦点切走再闪（自测用）
#
# 输出：一行 JSON（便于 Node 侧解析；用 stdio 继承或重定向，不要 piped）

param(
  [ValidateSet('tray', 'all', 'caption')] [string]$Mode = 'tray',
  [int]$Count = 8,
  [switch]$UntilFocused,
  [int]$WaitForBackground = 0,
  [switch]$ListOnly
)

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class DshFlash {
  [StructLayout(LayoutKind.Sequential)]
  public struct FLASHWINFO {
    public uint   cbSize;
    public IntPtr hwnd;
    public uint   dwFlags;
    public uint   uCount;
    public uint   dwTimeout;
  }

  [DllImport("user32.dll")]
  public static extern bool FlashWindowEx(ref FLASHWINFO pwfi);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  public delegate bool EnumProc(IntPtr h, IntPtr p);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr h);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr h, out uint procId);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr h);

  // 任务栏闪烁标志位
  public const uint FLASHW_STOP       = 0;
  public const uint FLASHW_CAPTION    = 1;
  public const uint FLASHW_TRAY       = 2;
  public const uint FLASHW_ALL        = 3;
  public const uint FLASHW_TIMERNOFG  = 12;

  public static bool Flash(IntPtr hwnd, uint flags, uint count, uint timeout) {
    FLASHWINFO f = new FLASHWINFO();
    f.cbSize   = (uint)Marshal.SizeOf(typeof(FLASHWINFO));
    f.hwnd     = hwnd;
    f.dwFlags  = flags;
    f.uCount   = count;
    f.dwTimeout = timeout;
    return FlashWindowEx(ref f);
  }
}
"@

# ---------- 1) 枚举可见顶层窗口 ----------
$wins = New-Object System.Collections.ArrayList
$cb = [DshFlash+EnumProc] {
  param($h, $l)
  if ([DshFlash]::IsWindowVisible($h)) {
    $tb = New-Object System.Text.StringBuilder 512
    [void][DshFlash]::GetWindowTextW($h, $tb, 512)
    $cb2 = New-Object System.Text.StringBuilder 256
    [void][DshFlash]::GetClassNameW($h, $cb2, 256)
    $procId = [uint32]0
    [void][DshFlash]::GetWindowThreadProcessId($h, [ref]$procId)
    [void]$wins.Add([pscustomobject]@{
      Hwnd  = [int64]$h
      Title = $tb.ToString()
      Class = $cb2.ToString()
      Pid   = $procId
    })
  }
  return $true
}
[void][DshFlash]::EnumWindows($cb, [IntPtr]::Zero)

# ---------- 2) 定位 DSH 主窗口 ----------
# 主判据：标题以 "DeepSeek Harness" 结尾（应用会把会话标题拼在前面）
# 备选：Electron 窗口类 Chrome_WidgetWin_1 且标题含 DeepSeek/Harness
$targets = @($wins | Where-Object { $_.Title -match 'DeepSeek\s+Harness\s*$' })
if ($targets.Count -eq 0) {
  $targets = @($wins | Where-Object { $_.Class -eq 'Chrome_WidgetWin_1' -and $_.Title -match 'DeepSeek|Harness' })
}
if ($targets.Count -eq 0) {
  # 最后一招：按进程名找（进程叫 "DeepSeek Harness"）
  $pids = @(Get-Process -ErrorAction SilentlyContinue |
            Where-Object { $_.ProcessName -like '*DeepSeek*' } |
            Select-Object -ExpandProperty Id)
  $targets = @($wins | Where-Object { $pids -contains $_.Pid })
}

if ($targets.Count -eq 0) {
  [pscustomobject]@{ ok = $false; error = 'NO_TARGET_WINDOW'; candidates = @() } | ConvertTo-Json -Compress
  exit 2
}

if ($ListOnly) {
  [pscustomobject]@{
    ok = $true; mode = 'list'
    targets = @($targets | ForEach-Object { [pscustomobject]@{ hwnd = ('0x{0:X}' -f $_.Hwnd); title = $_.Title; pid = $_.Pid } })
  } | ConvertTo-Json -Compress -Depth 5
  exit 0
}

$target = $targets[0]

function Get-ForegroundInfo {
  $fh = [DshFlash]::GetForegroundWindow()
  $t = ''
  foreach ($w in $wins) { if ($w.Hwnd -eq [int64]$fh) { $t = $w.Title; break } }
  [pscustomobject]@{ Hwnd = [int64]$fh; Title = $t }
}

# ---------- 3) 可选：等焦点离开目标窗口 ----------
# 目标窗口在前台时 FlashWindowEx 没有可见效果，自测需要先切走焦点
$waited = 0
if ($WaitForBackground -gt 0) {
  while ($waited -lt $WaitForBackground) {
    $fg = Get-ForegroundInfo
    if ($fg.Hwnd -ne $target.Hwnd) { break }
    Start-Sleep -Milliseconds 500
    $waited += 0.5
  }
}

$fgBefore = Get-ForegroundInfo

# ---------- 4) 闪烁 ----------
$flags = 0
switch ($Mode) {
  'tray'    { $flags = [DshFlash]::FLASHW_TRAY }
  'caption' { $flags = [DshFlash]::FLASHW_CAPTION }
  'all'     { $flags = [DshFlash]::FLASHW_ALL }
}
$count = $Count
if ($UntilFocused) { $flags = $flags -bor [DshFlash]::FLASHW_TIMERNOFG; $count = 0 }

$sw = [System.Diagnostics.Stopwatch]::StartNew()
# ⚠️ 语义坑：FlashWindowEx 的返回值是**调用前窗口是否处于活动状态**，不是成功/失败。
# 闪一个非活动窗口（正是我们的用例）返回 0 是正常的，绝不能当成失败。
$prevActive = [DshFlash]::Flash([IntPtr]$target.Hwnd, $flags, [uint32]$count, 0)
$sw.Stop()

$fgAfter = Get-ForegroundInfo
$focusStolen = ($fgAfter.Hwnd -ne $fgBefore.Hwnd) -and ($fgAfter.Hwnd -eq $target.Hwnd)

[pscustomobject]@{
  ok               = $true
  wasActiveBefore  = $prevActive
  isIconic         = [DshFlash]::IsIconic([IntPtr]$target.Hwnd)
  mode             = $Mode
  untilFocused     = [bool]$UntilFocused
  count            = $count
  hwnd             = ('0x{0:X}' -f $target.Hwnd)
  targetTitle      = $target.Title
  targetPid        = $target.Pid
  wasForeground    = ($fgBefore.Hwnd -eq $target.Hwnd)
  foregroundBefore = $fgBefore.Title
  foregroundAfter  = $fgAfter.Title
  focusStolen      = $focusStolen
  waitedSec        = $waited
  apiMillis        = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
} | ConvertTo-Json -Compress
