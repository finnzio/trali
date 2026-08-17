# Acceptance 1-6 for Trali single-instance / close-to-tray.
# Process name is the tray-icon proxy: the bug was a second Trali.exe creating a second tray.
# Tray menu clicks are not automatable on windows-latest; case 5 reuses the second-launch
# restore path (same show_main_window), case 6 checks the single-instance lock releases
# after process exit (tray Quit is app.exit(0)).
#
# Usage (after silent NSIS install):
#   pwsh -File scripts/assert-single-instance.ps1
#   pwsh -File scripts/assert-single-instance.ps1 -ExePath "$env:LOCALAPPDATA\Trali\trali.exe"

param(
  [string]$ExePath,
  [int]$TimeoutSec = 60
)

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class TraliWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  public static IntPtr[] Find(string title) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => {
      var sb = new StringBuilder(256);
      GetWindowText(h, sb, 256);
      if (sb.ToString() == title) list.Add(h);
      return true;
    }, IntPtr.Zero);
    return list.ToArray();
  }
  public static bool Visible(IntPtr h) { return IsWindowVisible(h); }
  public static void Close(IntPtr h) { PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); }
}
"@

function Write-Step([int]$Id, [string]$Message) {
  Write-Host ""
  Write-Host "STEP $Id : $Message"
}

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "ASSERT FAIL: $Message" }
  Write-Host "  OK  $Message"
}

function Get-TraliProcesses {
  @(Get-Process -Name 'trali' -ErrorAction SilentlyContinue)
}

function Get-TraliWindows {
  @([TraliWin]::Find('Trali'))
}

function Get-VisibleTraliWindows {
  @(Get-TraliWindows | Where-Object { [TraliWin]::Visible($_) })
}

function Wait-Until([scriptblock]$Probe, [string]$What, [int]$Seconds = $TimeoutSec) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $value = & $Probe
    if ($value) { return $value }
    Start-Sleep -Milliseconds 400
  } while ((Get-Date) -lt $deadline)
  throw "TIMEOUT waiting for $What"
}

function Assert-SingleProcess([int]$ExpectedId, [string]$Label) {
  $deadline = (Get-Date).AddSeconds(8)
  do {
    $procs = Get-TraliProcesses
    if ($procs.Count -le 1) { break }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  $procs = Get-TraliProcesses
  Assert-True ($procs.Count -eq 1) "$Label : Trali.exe count == 1 (was $($procs.Count))"
  Assert-True ($procs[0].Id -eq $ExpectedId) "$Label : same PID $ExpectedId (got $($procs[0].Id))"
}

function Resolve-TraliExe {
  if ($ExePath) {
    if (-not (Test-Path $ExePath)) { throw "ExePath not found: $ExePath" }
    return (Resolve-Path $ExePath).Path
  }
  $candidates = @(
    "$env:LOCALAPPDATA\Trali\trali.exe",
    "$env:LOCALAPPDATA\Trali\Trali.exe",
    "$env:ProgramFiles\Trali\trali.exe",
    "$env:ProgramFiles\Trali\Trali.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }
  throw "Trali exe not found. Pass -ExePath. Looked: $($candidates -join ', ')"
}

Get-TraliProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

$exe = Resolve-TraliExe
Write-Host "EXE $exe"

Write-Step 1 "first launch -> 1 process, 1 visible window"
Start-Process -FilePath $exe
Wait-Until { (Get-TraliProcesses).Count -ge 1 } 'Trali process'
Wait-Until { (Get-VisibleTraliWindows).Count -ge 1 } 'visible Trali window'
Assert-True ((Get-TraliProcesses).Count -eq 1) '1: Trali.exe == 1'
Assert-True ((Get-VisibleTraliWindows).Count -eq 1) '1: visible window == 1'
$pid1 = (Get-TraliProcesses)[0].Id
Write-Host "  PID $pid1"

Write-Step 2 "WM_CLOSE (close-to-tray) -> window hidden, same process"
$hwnd = Get-VisibleTraliWindows | Select-Object -First 1
[TraliWin]::Close($hwnd)
Wait-Until { (Get-VisibleTraliWindows).Count -eq 0 } 'window hidden'
Assert-SingleProcess $pid1 '2'
Assert-True ((Get-VisibleTraliWindows).Count -eq 0) '2: visible window == 0'

Write-Step 3 "second launch while hidden -> still 1 process, window restored"
Start-Process -FilePath $exe
Assert-SingleProcess $pid1 '3'
Wait-Until { (Get-VisibleTraliWindows).Count -eq 1 } 'restored window'
Assert-True ((Get-VisibleTraliWindows).Count -eq 1) '3: visible window == 1'

Write-Step 4 "launch while visible -> no new process or window"
Start-Process -FilePath $exe
Assert-SingleProcess $pid1 '4'
Assert-True ((Get-VisibleTraliWindows).Count -eq 1) '4: visible window == 1'

Write-Step 5 "tray Show shares show_main_window with step 3; re-hide + second launch"
$hwnd = Get-VisibleTraliWindows | Select-Object -First 1
[TraliWin]::Close($hwnd)
Wait-Until { (Get-VisibleTraliWindows).Count -eq 0 } 'window hidden again'
Start-Process -FilePath $exe
Assert-SingleProcess $pid1 '5'
Wait-Until { (Get-VisibleTraliWindows).Count -eq 1 } 'tray-equivalent restore'
Assert-True ((Get-VisibleTraliWindows).Count -eq 1) '5: visible window == 1'

Write-Step 6 "process exit then relaunch -> new instance starts"
Get-TraliProcesses | Stop-Process -Force
Wait-Until { (Get-TraliProcesses).Count -eq 0 } 'process gone'
Start-Process -FilePath $exe
Wait-Until { (Get-TraliProcesses).Count -eq 1 } 'relaunch process'
Wait-Until { (Get-VisibleTraliWindows).Count -eq 1 } 'relaunch window'
Assert-True ((Get-TraliProcesses).Count -eq 1) '6: Trali.exe == 1'
$pid2 = (Get-TraliProcesses)[0].Id
Assert-True ($pid2 -ne $pid1) "6: new PID (old $pid1, new $pid2)"
Assert-True ((Get-VisibleTraliWindows).Count -eq 1) '6: visible window == 1'

Get-TraliProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "ALL 1-6 PASSED"
