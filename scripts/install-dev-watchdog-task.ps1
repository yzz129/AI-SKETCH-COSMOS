param(
  [string]$ProjectRoot = 'D:\AI-SKETCH-COSMOS-main',
  [string]$TaskName = 'AI Sketch Cosmos Dev Watchdog'
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script from an elevated PowerShell window.'
}

$watchdogPath = Join-Path ([System.IO.Path]::GetFullPath($ProjectRoot)) 'scripts\quick-tunnel-watchdog.ps1'
if (-not (Test-Path -LiteralPath $watchdogPath -PathType Leaf)) {
  throw "Watchdog script not found: $watchdogPath"
}

$powerShellPath = Join-Path $PSHOME 'powershell.exe'
$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$watchdogPath`" -ProjectRoot `"$ProjectRoot`""
$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $arguments -WorkingDirectory $ProjectRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S'
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal `
  -Description 'Keeps the AI Sketch Cosmos Vite development server and FastAPI backend running.'
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Installed and started task: $TaskName"
Write-Host "Watchdog log: $(Join-Path $ProjectRoot '.runtime\dev-watchdog.log')"
