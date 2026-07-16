param(
  [string]$TaskName = 'AI Sketch Cosmos Dev Watchdog'
)

$ErrorActionPreference = 'Continue'

$task = $null
$taskInfo = $null
$taskReadDenied = $false
try {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
} catch [Microsoft.Management.Infrastructure.CimException] {
  if ($_.Exception.Message -match 'Access is denied|\u62d2\u7edd\u8bbf\u95ee') {
    $taskReadDenied = $true
  }
} catch {
  # A missing task is reported below. Endpoint checks still run either way.
}

if ($taskReadDenied) {
  Write-Host 'Task status requires an elevated PowerShell window.'
} elseif ($null -eq $task) {
  Write-Host "Task is not installed: $TaskName"
} else {
  [pscustomobject]@{
    TaskName = $TaskName
    State = $task.State
    LastRunTime = $taskInfo.LastRunTime
    LastTaskResult = $taskInfo.LastTaskResult
    NextRunTime = $taskInfo.NextRunTime
  } | Format-List
}

foreach ($port in 4173, 8000) {
  try {
    $connection = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | Select-Object -First 1
    Write-Host "Port $port is listening (PID $($connection.OwningProcess))."
  } catch {
    Write-Host "Port $port listener details are unavailable without elevation."
  }
}

try {
  $frontend = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4173/' -TimeoutSec 5
  Write-Host "Frontend health check: HTTP $($frontend.StatusCode)"
} catch {
  Write-Host 'Frontend health check failed.'
}

try {
  $backend = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 5
  Write-Host "Backend health check: HTTP $($backend.StatusCode) $($backend.Content)"
} catch {
  Write-Host 'Backend health check failed.'
}
