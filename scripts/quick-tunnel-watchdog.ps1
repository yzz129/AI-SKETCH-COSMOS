param(
  [string]$ProjectRoot = 'D:\AI-SKETCH-COSMOS-main',
  [string]$NpmPath = 'C:\nvm4w\nodejs\npm.cmd',
  [string]$PythonPath = 'D:\AI-SKETCH-COSMOS-main\backend\.venv\Scripts\python.exe',
  [int]$FrontendPort = 4173,
  [int]$BackendPort = 8000,
  [int]$CheckIntervalSeconds = 15,
  [int]$StartupGraceSeconds = 75,
  [string]$CloudflaredServiceName = 'Cloudflared',
  [string]$TunnelPublicUrl = 'https://cosmos.yzzwnw.asia/',
  [int]$TunnelFailureThreshold = 4,
  [int]$TunnelRestartCooldownSeconds = 180,
  [int]$TunnelRecoveryTimeoutSeconds = 45,
  [switch]$DisableTunnelRecovery,
  [switch]$RunOnce,
  [int]$MaxLogSizeMB = 25
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$logDirectory = Join-Path $ProjectRoot '.runtime'
$watchdogLog = Join-Path $logDirectory 'dev-watchdog.log'
$frontendBuildOutLog = Join-Path $logDirectory 'frontend-build.out.log'
$frontendBuildErrorLog = Join-Path $logDirectory 'frontend-build.err.log'
$frontendOutLog = Join-Path $logDirectory 'vite-4173.out.log'
$frontendErrorLog = Join-Path $logDirectory 'vite-4173.err.log'
$backendOutLog = Join-Path $logDirectory 'backend-8000.out.log'
$backendErrorLog = Join-Path $logDirectory 'backend-8000.err.log'
$script:frontendLastStarted = [datetime]::MinValue
$script:backendLastStarted = [datetime]::MinValue
$script:tunnelLastRestarted = [datetime]::MinValue
$script:tunnelConsecutiveFailures = 0
$script:tunnelHealthState = 'unknown'

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

function Test-InternetAvailable {
  try {
    $response = Invoke-WebRequest `
      -UseBasicParsing `
      -Uri 'https://www.cloudflare.com/cdn-cgi/trace' `
      -TimeoutSec 8
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
  } catch {
    return $false
  }
}

function Get-CloudflaredHealth {
  $escapedServiceName = $CloudflaredServiceName.Replace("'", "''")
  $service = Get-CimInstance Win32_Service `
    -Filter "Name='$escapedServiceName'" `
    -ErrorAction SilentlyContinue

  if ($null -eq $service) {
    return [pscustomobject]@{
      Managed = $false
      Healthy = $true
      Reason = "Service '$CloudflaredServiceName' is not installed."
      Connections = $null
    }
  }

  if ($service.State -ne 'Running' -or $service.ProcessId -le 0) {
    return [pscustomobject]@{
      Managed = $true
      Healthy = $false
      Reason = "Service state is $($service.State)."
      Connections = 0
    }
  }

  $listeners = @(
    Get-NetTCPConnection `
      -OwningProcess $service.ProcessId `
      -State Listen `
      -ErrorAction SilentlyContinue |
      Where-Object { $_.LocalAddress -in @('127.0.0.1', '::1') } |
      Sort-Object LocalPort -Unique
  )

  foreach ($listener in $listeners) {
    try {
      $metrics = Invoke-WebRequest `
        -UseBasicParsing `
        -Uri "http://127.0.0.1:$($listener.LocalPort)/metrics" `
        -TimeoutSec 3
      $match = [regex]::Match(
        $metrics.Content,
        '(?m)^cloudflared_tunnel_ha_connections\s+([0-9]+(?:\.[0-9]+)?)\s*$'
      )
      if ($match.Success) {
        $connections = [int][double]$match.Groups[1].Value
        return [pscustomobject]@{
          Managed = $true
          Healthy = $connections -gt 0
          Reason = "Metrics report $connections healthy connection(s)."
          Connections = $connections
        }
      }
    } catch {
      # Non-metrics listeners are expected; try the next loopback port.
    }
  }

  if (Test-Endpoint $TunnelPublicUrl) {
    return [pscustomobject]@{
      Managed = $true
      Healthy = $true
      Reason = 'Metrics unavailable, but the public tunnel endpoint is healthy.'
      Connections = $null
    }
  }

  return [pscustomobject]@{
    Managed = $true
    Healthy = $false
    Reason = 'No tunnel metrics connection and the public endpoint is unavailable.'
    Connections = $null
  }
}

function Restart-CloudflaredSafely([string]$Reason) {
  $secondsSinceLastRestart = ((Get-Date) - $script:tunnelLastRestarted).TotalSeconds
  if ($secondsSinceLastRestart -lt $TunnelRestartCooldownSeconds) {
    if ($script:tunnelHealthState -ne 'cooldown') {
      Write-WatchdogLog "Tunnel remains unhealthy, but restart cooldown is active ($([int]$secondsSinceLastRestart)s/$TunnelRestartCooldownSeconds s)."
      $script:tunnelHealthState = 'cooldown'
    }
    return
  }

  if (-not (Test-InternetAvailable)) {
    if ($script:tunnelHealthState -ne 'offline') {
      Write-WatchdogLog 'Tunnel restart postponed because general internet connectivity is unavailable.'
      $script:tunnelHealthState = 'offline'
    }
    return
  }

  try {
    $script:tunnelLastRestarted = Get-Date
    $service = Get-Service -Name $CloudflaredServiceName -ErrorAction Stop
    Write-WatchdogLog "Tunnel unhealthy after $script:tunnelConsecutiveFailures checks; recovering Cloudflared. Reason: $Reason"
    if ($service.Status -eq 'Running') {
      Restart-Service -Name $CloudflaredServiceName -Force -ErrorAction Stop
    } else {
      Start-Service -Name $CloudflaredServiceName -ErrorAction Stop
    }

    $script:tunnelConsecutiveFailures = 0
    $script:tunnelHealthState = 'recovering'

    $deadline = (Get-Date).AddSeconds($TunnelRecoveryTimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 3
      $health = Get-CloudflaredHealth
      if ($health.Healthy) {
        Write-WatchdogLog "Cloudflared recovery succeeded. $($health.Reason)"
        $script:tunnelHealthState = 'healthy'
        return
      }
    }

    Write-WatchdogLog "Cloudflared restarted but did not become healthy within $TunnelRecoveryTimeoutSeconds seconds."
  } catch {
    Write-WatchdogLog "Cloudflared recovery failed: $($_.Exception.Message)"
  }
}

function Update-TunnelHealth {
  if ($DisableTunnelRecovery) { return }

  $health = Get-CloudflaredHealth
  if (-not $health.Managed) {
    if ($script:tunnelHealthState -ne 'unmanaged') {
      Write-WatchdogLog $health.Reason
      $script:tunnelHealthState = 'unmanaged'
    }
    return
  }

  if ($health.Healthy) {
    if ($script:tunnelConsecutiveFailures -gt 0 -or $script:tunnelHealthState -ne 'healthy') {
      Write-WatchdogLog "Tunnel healthy. $($health.Reason)"
    }
    $script:tunnelConsecutiveFailures = 0
    $script:tunnelHealthState = 'healthy'
    return
  }

  $script:tunnelConsecutiveFailures++
  if ($script:tunnelConsecutiveFailures -eq 1) {
    Write-WatchdogLog "Tunnel health check failed; waiting for confirmation before recovery. $($health.Reason)"
  }

  if ($script:tunnelConsecutiveFailures -ge $TunnelFailureThreshold) {
    Restart-CloudflaredSafely $health.Reason
  }
}

function Start-Frontend {
  if (Test-InStartupGrace $script:frontendLastStarted) { return }
  $script:frontendLastStarted = Get-Date

  Rotate-Log $frontendBuildOutLog
  Rotate-Log $frontendBuildErrorLog
  Rotate-Log $frontendOutLog
  Rotate-Log $frontendErrorLog
  Write-WatchdogLog "Frontend unavailable; building the public bundle."
  try {
    $buildProcess = Start-Process -FilePath $NpmPath `
      -ArgumentList @('run', 'build') `
      -WorkingDirectory $ProjectRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $frontendBuildOutLog `
      -RedirectStandardError $frontendBuildErrorLog `
      -Wait `
      -PassThru
    if ($buildProcess.ExitCode -ne 0) {
      Write-WatchdogLog "Frontend build failed with exit code $($buildProcess.ExitCode); preview was not started."
      return
    }

    Write-WatchdogLog "Frontend bundle ready; starting Vite preview on 127.0.0.1:$FrontendPort."
    $process = Start-Process -FilePath $NpmPath `
      -ArgumentList @('run', 'preview', '--', '--port', "$FrontendPort", '--strictPort') `
      -WorkingDirectory $ProjectRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $frontendOutLog `
      -RedirectStandardError $frontendErrorLog `
      -PassThru
    Write-WatchdogLog "Frontend preview process started (PID $($process.Id))."
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

$ES_CONTINUOUS = [uint32]2147483648
$ES_SYSTEM_REQUIRED = [uint32]1
$ES_AWAYMODE_REQUIRED = [uint32]64

Write-WatchdogLog "Watchdog started (project: $ProjectRoot; tunnel threshold: $TunnelFailureThreshold checks; restart cooldown: $TunnelRestartCooldownSeconds seconds)."
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $DisableTunnelRecovery -and -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-WatchdogLog 'Warning: watchdog is not elevated. Tunnel health is monitored, but restarting the Cloudflared service may be denied. Install the scheduled task as Administrator for unattended recovery.'
}
[AwakeState]::SetThreadExecutionState([uint32]($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED -bor $ES_AWAYMODE_REQUIRED)) | Out-Null

try {
  while ($true) {
    if (-not (Test-Endpoint "http://127.0.0.1:$BackendPort/health")) {
      Start-Backend
    }
    if (-not (Test-Endpoint "http://127.0.0.1:$FrontendPort/")) {
      Start-Frontend
    }
    Update-TunnelHealth
    if ($RunOnce) { break }
    Start-Sleep -Seconds $CheckIntervalSeconds
  }
} catch {
  Write-WatchdogLog "Watchdog stopped by an unhandled error: $($_.Exception.Message)"
  throw
} finally {
  [AwakeState]::SetThreadExecutionState([uint32]$ES_CONTINUOUS) | Out-Null
  Write-WatchdogLog 'Watchdog stopped.'
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
