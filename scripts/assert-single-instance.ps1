# Acceptance 1-6 for Trali single-instance / close-to-tray.
# Process count is the tray-icon proxy: a second Trali.exe created a second tray.
# Tray menu clicks and tray icon count are not observable on windows-latest.
# Case 5 reuses the second-launch restore path (same show_main_window).
# Case 6 checks that the single-instance lock releases after process exit.
# Tray Quit is app.exit(0); this runner cannot click it, and the NSIS build
# has no CI quit backdoor.
#
# Usage (after silent NSIS install):
#   pwsh -File scripts/assert-single-instance.ps1
#   pwsh -File scripts/assert-single-instance.ps1 -ExePath "$env:LOCALAPPDATA\Trali\trali.exe"

param(
  [string]$ExePath,
  [int]$TimeoutSec = 60,
  [int]$ReadySec = 8
)

$ErrorActionPreference = 'Stop'
$script:Results = [System.Collections.Generic.List[object]]::new()

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class TraliWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

  public static List<IntPtr> FindOwned(string title, uint pid) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => {
      uint windowPid;
      GetWindowThreadProcessId(h, out windowPid);
      if (pid != 0 && windowPid != pid) return true;
      var sb = new StringBuilder(256);
      GetWindowText(h, sb, 256);
      var text = sb.ToString();
      if (text == title || text.StartsWith(title)) list.Add(h);
      return true;
    }, IntPtr.Zero);
    return list;
  }

  public static bool Visible(IntPtr h) { return IsWindowVisible(h) && !IsIconic(h); }
  public static void Close(IntPtr h) {
    PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
  }
}
"@

function Write-Step([int]$Id, [string]$Message) {
  Write-Host ""
  Write-Host "STEP $Id : $Message"
}

function Write-Skip([string]$Message) {
  Write-Host "SKIP: $Message"
}

function Record-Result([string]$Case, [string]$Status, [string]$Notes) {
  $script:Results.Add([pscustomobject]@{ Case = $Case; Status = $Status; Notes = $Notes })
  Write-Host ("CASE {0}: {1} — {2}" -f $Case, $Status, $Notes)
}

function Write-ResultTable {
  $markdown = @(
    "| Case | Result | Notes |",
    "|------|--------|-------|"
  )
  foreach ($row in $script:Results) {
    $notes = [string]$row.Notes
    $notes = $notes.Replace('|', '/')
    $markdown += "| $($row.Case) | $($row.Status) | $notes |"
  }
  $table = $markdown -join "`n"
  Write-Host ""
  Write-Host $table
  if ($env:GITHUB_STEP_SUMMARY) {
    @(
      "## Windows single-instance acceptance",
      "",
      $table,
      "",
      "Tray icon count is unobservable on this runner and was not treated as a pass.",
      "Tray Show cannot be clicked here; case 5 uses the shared second-launch restore path.",
      "Case 6 cannot click tray Quit (no product CI backdoor). It asserts lock release after process exit, then a clean relaunch."
    ) | Add-Content -Path $env:GITHUB_STEP_SUMMARY
  }
}

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "ASSERT FAIL: $Message" }
  Write-Host "  OK  $Message"
}

function Get-TraliProcesses {
  @(Get-Process -Name 'trali' -ErrorAction SilentlyContinue)
}

function Get-TraliPid {
  $procs = Get-TraliProcesses
  if (@($procs).Count -eq 0) { return [uint32]0 }
  return [uint32]$procs[0].Id
}

function Get-TraliWindows {
  $pid = Get-TraliPid
  if ($pid -eq 0) { return @() }
  @([TraliWin]::FindOwned('Trali', $pid).ToArray())
}

function Get-VisibleTraliWindows {
  @(Get-TraliWindows | Where-Object { [TraliWin]::Visible($_) })
}

function Get-WindowSnapshot {
  $procs = Get-TraliProcesses
  $windows = Get-TraliWindows
  $visible = Get-VisibleTraliWindows
  return "processes=$(@($procs).Count) pids=$(@($procs | ForEach-Object { $_.Id }) -join ',') windows=$(@($windows).Count) visible=$(@($visible).Count)"
}

function Wait-Until([scriptblock]$Probe, [string]$What, [int]$Seconds = $TimeoutSec) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $value = & $Probe
    if ($value) { return $value }
    Start-Sleep -Milliseconds 400
  } while ((Get-Date) -lt $deadline)
  throw "TIMEOUT waiting for $What. $(Get-WindowSnapshot)"
}

function Assert-SingleProcess([int]$ExpectedId, [string]$Label) {
  $deadline = (Get-Date).AddSeconds(8)
  do {
    $procs = Get-TraliProcesses
    if (@($procs).Count -le 1) { break }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  $procs = Get-TraliProcesses
  Assert-True (@($procs).Count -eq 1) "$Label : Trali.exe count == 1 (was $(@($procs).Count)). $(Get-WindowSnapshot)"
  Assert-True ($procs[0].Id -eq $ExpectedId) "$Label : same PID $ExpectedId (got $($procs[0].Id))"
}

function Wait-ForReadyInstance {
  Wait-Until { @((Get-TraliProcesses)).Count -ge 1 } 'Trali process'
  Wait-Until { @((Get-VisibleTraliWindows)).Count -ge 1 } 'visible Trali window'
  Write-Host "  waiting ${ReadySec}s for setup / close-to-tray handler"
  Start-Sleep -Seconds $ReadySec
  Assert-True (@((Get-TraliProcesses)).Count -eq 1) "ready: Trali.exe == 1. $(Get-WindowSnapshot)"
  Assert-True (@((Get-VisibleTraliWindows)).Count -ge 1) "ready: visible window. $(Get-WindowSnapshot)"
}

function Close-MainWindowToTray {
  $hwnd = Get-VisibleTraliWindows | Select-Object -First 1
  if (-not $hwnd) { throw "no visible Trali window to close. $(Get-WindowSnapshot)" }
  $pidBefore = Get-TraliPid
  Write-Host "  WM_CLOSE hwnd=$hwnd pid=$pidBefore"
  [TraliWin]::Close($hwnd)
  Wait-Until {
    @((Get-TraliProcesses)).Count -eq 1 -and @((Get-VisibleTraliWindows)).Count -eq 0
  } 'window hidden while process still running'
}

function Resolve-LaunchTarget {
  if ($ExePath) {
    if (-not (Test-Path $ExePath)) { throw "ExePath not found: $ExePath" }
    return (Resolve-Path $ExePath).Path
  }
  $candidates = @(
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Trali.lnk",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Trali\Trali.lnk",
    "$env:LOCALAPPDATA\Trali\trali.exe",
    "$env:LOCALAPPDATA\Trali\Trali.exe",
    "$env:ProgramFiles\Trali\trali.exe",
    "$env:ProgramFiles\Trali\Trali.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }
  throw "Trali shortcut/exe not found. Pass -ExePath. Looked: $($candidates -join ', ')"
}

Write-Skip "Tray icon count cannot be observed in this GitHub Actions session; not treated as a pass."
Write-Skip "Tray Show / Quit clicks cannot be automated on this runner."

Get-TraliProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

$target = Resolve-LaunchTarget
Write-Host "LAUNCH $target"

try {
  Write-Step 1 "first launch -> 1 process, 1 visible window"
  Start-Process -FilePath $target
  Wait-ForReadyInstance
  Assert-True (@((Get-TraliProcesses)).Count -eq 1) '1: Trali.exe == 1'
  Assert-True (@((Get-VisibleTraliWindows)).Count -eq 1) '1: visible window == 1'
  $pid1 = (Get-TraliProcesses)[0].Id
  Write-Host "  PID $pid1"
  Record-Result '1' 'PASS' "1 process, main window visible (PID $pid1)"

  Write-Step 2 "WM_CLOSE (close-to-tray) -> window hidden, same process"
  Close-MainWindowToTray
  Assert-SingleProcess $pid1 '2'
  Assert-True (@((Get-VisibleTraliWindows)).Count -eq 0) '2: visible window == 0'
  Record-Result '2' 'PASS' 'WM_CLOSE hid the window; still exactly 1 process'

  Write-Step 3 "second launch while hidden -> still 1 process, window restored"
  Start-Process -FilePath $target
  Assert-SingleProcess $pid1 '3'
  Wait-Until { @((Get-VisibleTraliWindows)).Count -eq 1 } 'restored window'
  Assert-True (@((Get-VisibleTraliWindows)).Count -eq 1) '3: visible window == 1'
  Record-Result '3' 'PASS' 'second launch restored the original window; still 1 process'

  Write-Step 4 "launch while visible -> no new process or window"
  Start-Process -FilePath $target
  Assert-SingleProcess $pid1 '4'
  Assert-True (@((Get-VisibleTraliWindows)).Count -eq 1) '4: visible window == 1'
  Record-Result '4' 'PASS' 'launch while visible created no new process or window'

  Write-Step 5 "shared restore path: re-hide + second launch (tray Show is the same show_main_window)"
  Close-MainWindowToTray
  Start-Process -FilePath $target
  Assert-SingleProcess $pid1 '5'
  Wait-Until { @((Get-VisibleTraliWindows)).Count -eq 1 } 'tray-equivalent restore'
  Assert-True (@((Get-VisibleTraliWindows)).Count -eq 1) '5: visible window == 1'
  Record-Result '5' 'PASS' 'second-instance callback restored a visible window via shared show_main_window. Tray Show click skipped. Tray icon count skipped.'

  Write-Step 6 "process exit then relaunch -> new instance starts"
  Get-TraliProcesses | Stop-Process -Force
  Wait-Until { @((Get-TraliProcesses)).Count -eq 0 } 'process gone'
  Start-Process -FilePath $target
  Wait-ForReadyInstance
  Assert-True (@((Get-TraliProcesses)).Count -eq 1) '6: Trali.exe == 1'
  $pid2 = (Get-TraliProcesses)[0].Id
  Assert-True ($pid2 -ne $pid1) "6: new PID (old $pid1, new $pid2)"
  Assert-True (@((Get-VisibleTraliWindows)).Count -eq 1) '6: visible window == 1'
  Record-Result '6' 'PASS' "lock released after process exit; fresh launch PID $pid2, window visible. Tray Quit click skipped (no CI backdoor)."
} catch {
  $message = $_.Exception.Message
  Write-Host "ACCEPTANCE ERROR: $message"
  foreach ($case in @('1', '2', '3', '4', '5', '6')) {
    if (-not ($script:Results | Where-Object { $_.Case -eq $case })) {
      Record-Result $case 'FAIL' $message
    }
  }
  Write-ResultTable
  throw
} finally {
  Get-TraliProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
}

Write-ResultTable
Write-Host ""
Write-Host "ALL 1-6 PASSED"
