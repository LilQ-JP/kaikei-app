param(
  [string]$InstallRoot = "$env:ProgramFiles\LilQKaikei",
  [string]$DataRoot = "$env:ProgramData\LilQKaikei",
  [int]$Port = 4175,
  [string]$NodePath = "node.exe"
)

$ErrorActionPreference = "Stop"
$serviceName = "LilQKaikei"
$source = Split-Path -Parent $PSScriptRoot | Split-Path -Parent
$build = Join-Path $source "dist"

if (-not (Test-Path (Join-Path $build "index.js")) -or
    -not (Test-Path (Join-Path $build "public\index.html"))) {
  throw "Build output is missing. Run pnpm.cmd install and pnpm.cmd build before installing."
}

$existingTask = Get-ScheduledTask -TaskName $serviceName -ErrorAction SilentlyContinue
if ($existingTask -and $existingTask.State -eq "Running") {
  Stop-ScheduledTask -TaskName $serviceName
}

New-Item -ItemType Directory -Force -Path $InstallRoot, $DataRoot | Out-Null
# dist/index.js is bundled with its server dependencies.  Installing a task
# which points at Program Files without node_modules makes it fail after a
# reboot, so only the self-contained build output is deployed.
Copy-Item -Path $build -Destination $InstallRoot -Recurse -Force

$launcher = Join-Path $InstallRoot "launcher.mjs"
@(
  "Object.assign(process.env,{NODE_ENV:'production',KAIKEI_DATA_DIR:'$($DataRoot -replace '\\','/')',PORT:'$Port'});"
  "await import('./dist/index.js');"
) | Set-Content -Encoding UTF8 $launcher

# A plain PowerShell process cannot be registered as a Windows service because
# it does not speak the Windows service control protocol. Use Task Scheduler,
# which starts the Node process at boot under SYSTEM and survives logoff.
#
# Register-ScheduledTask is deliberately used instead of schtasks.exe here.
# schtasks.exe mis-parses a quoted launcher path under "Program Files", leaving
# a task that appears installed but cannot start.
$action = New-ScheduledTaskAction -Execute $NodePath -Argument ("`"{0}`"" -f $launcher)
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 0)
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
Register-ScheduledTask -TaskName $serviceName -InputObject $task -Force | Out-Null
Start-ScheduledTask -TaskName $serviceName

$healthy = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Milliseconds 500
  if ((Get-ScheduledTask -TaskName $serviceName).State -ne "Running") { continue }
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Where-Object { $_.LocalAddress -eq "127.0.0.1" }
    if ($response.ok -eq $true -and $response.storage -eq "sqlite" -and $listener) {
      $healthy = $true
      break
    }
  } catch { }
}
if (-not $healthy) {
  $lastResult = (Get-ScheduledTaskInfo -TaskName $serviceName).LastTaskResult
  throw "LilQKaikei did not start on 127.0.0.1:$Port (task result: $lastResult). Check the Node process and port before retrying."
}
Write-Host "Installed $serviceName boot task on http://127.0.0.1:$Port"
Write-Host "Next: configure Tailscale Serve to forward HTTPS to http://127.0.0.1:$Port"
