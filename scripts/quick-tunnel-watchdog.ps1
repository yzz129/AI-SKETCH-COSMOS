param(
  [string]$ProjectRoot = 'D:\AI-SKETCH-COSMOS-main',
  [string]$NpmPath = 'C:\nvm4w\nodejs\npm.cmd',
  [string]$PythonPath = 'D:\AI-SKETCH-COSMOS-main\backend\.venv\Scripts\python.exe',
  [int]$FrontendPort = 4173,
  [int]$BackendPort = 8000,
  [int]$CheckIntervalSeconds = 15,
  [int]$StartupGraceSeconds = 75,
  [int]$MaxLogSizeMB = 25
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$logDirectory = Join-Path $ProjectRoot '.runtime'
$watchdogLog = Join-Path $logDirectory 'dev-watchdog.log'
$frontendOutLog = Join-Path $logDirectory 'vite-4173.out.log'
$frontendErrorLog = Join-Path $logDirectory 'vite-4173.err.log'
$backendOutLog = Join-Path $logDirectory 'backend-8000.out.log'
$backendErrorLog = Join-Path $logDirectory 'backend-8000.err.log'
$script:frontendLastStarted = [datetime]::MinValue
$script:backendLastStarted = [datetime]::MinValue

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Rotate-Log([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $limit = $MaxLogSizeMB * 1MB
  if ((Get-Item -LiteralPath $Path).Length -lt $limit) { return }

  $archive = "$Path.1"
  Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $Path -Destination $archive -Force
}

function Write-WatchdogLog([string]$Message) {
  Rotate-Log $watchdogLog
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -LiteralPath $watchdogLog -Value "[$timestamp] $Message" -Encoding utf8
}

function Test-Endpoint([string]$Url) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 8
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
  } catch {
    return $false
  }
}

function Test-InStartupGrace([datetime]$LastStarted) {
  return ((Get-Date) - $LastStarted).TotalSeconds -lt $StartupGraceSeconds
}

function Start-Frontend {
  if (Test-InStartupGrace $script:frontendLastStarted) { return }
  $script:frontendLastStarted = Get-Date

  Rotate-Log $frontendOutLog
  Rotate-Log $frontendErrorLog
  Write-WatchdogLog "Frontend unavailable; starting Vite dev server on 127.0.0.1:$FrontendPort."
  try {
    $process = Start-Process -FilePath $NpmPath `
      -ArgumentList @('run', 'dev', '--', '--port', "$FrontendPort", '--strictPort') `
      -WorkingDirectory $ProjectRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $frontendOutLog `
      -RedirectStandardError $frontendErrorLog `
      -PassThru
    Write-WatchdogLog "Frontend process started (PID $($process.Id))."
  } catch {
    Write-WatchdogLog "Frontend start failed: $($_.Exception.Message)"
  }
}

function Start-Backend {
  if (Test-InStartupGrace $script:backendLastStarted) { return }
  $script:backendLastStarted = Get-Date

  Rotate-Log $backendOutLog
  Rotate-Log $backendErrorLog
  Write-WatchdogLog "Backend unavailable; starting Uvicorn on 127.0.0.1:$BackendPort."
  try {
    $previousPythonPath = $env:PYTHONPATH
    $env:PYTHONPATH = (Join-Path $ProjectRoot 'backend')
    try {
      $process = Start-Process -FilePath $PythonPath `
        -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$BackendPort") `
        -WorkingDirectory $ProjectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $backendOutLog `
        -RedirectStandardError $backendErrorLog `
        -PassThru
    } finally {
      $env:PYTHONPATH = $previousPythonPath
    }
    Write-WatchdogLog "Backend process started (PID $($process.Id))."
  } catch {
    Write-WatchdogLog "Backend start failed: $($_.Exception.Message)"
  }
}

$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, 'Global\AiSketchCosmosDevWatchdog', [ref]$createdNew)
if (-not $createdNew) {
  Write-WatchdogLog 'Another watchdog instance is already running; exiting.'
  $mutex.Dispose()
  exit 0
}

if (-not (Test-Path -LiteralPath $NpmPath -PathType Leaf)) {
  Write-WatchdogLog "Fatal: npm executable not found: $NpmPath"
  exit 2
}
if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) {
  Write-WatchdogLog "Fatal: Python executable not found: $PythonPath"
  exit 2
}

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AwakeState {
  [DllImport("kernel32.dll")]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
'@

$ES_CONTINUOUS = 0x80000000
$ES_SYSTEM_REQUIRED = 0x00000001
$ES_AWAYMODE_REQUIRED = 0x00000040

Write-WatchdogLog "Watchdog started (project: $ProjectRoot)."
[AwakeState]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED -bor $ES_AWAYMODE_REQUIRED) | Out-Null

try {
  while ($true) {
    if (-not (Test-Endpoint "http://127.0.0.1:$BackendPort/health")) {
      Start-Backend
    }
    if (-not (Test-Endpoint "http://127.0.0.1:$FrontendPort/")) {
      Start-Frontend
    }
    Start-Sleep -Seconds $CheckIntervalSeconds
  }
} catch {
  Write-WatchdogLog "Watchdog stopped by an unhandled error: $($_.Exception.Message)"
  throw
} finally {
  [AwakeState]::SetThreadExecutionState($ES_CONTINUOUS) | Out-Null
  Write-WatchdogLog 'Watchdog stopped.'
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
