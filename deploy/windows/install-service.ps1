param(
  [string]$InstallRoot = "$env:ProgramFiles\LilQKaikei",
  [string]$DataRoot = "$env:ProgramData\LilQKaikei",
  [int]$Port = 4175,
  [string]$NodePath = "node.exe"
)

$ErrorActionPreference = "Stop"
$serviceName = "LilQKaikei"
$source = Split-Path -Parent $PSScriptRoot | Split-Path -Parent

New-Item -ItemType Directory -Force -Path $InstallRoot, $DataRoot | Out-Null
# dist/index.js is bundled with its server dependencies.  Installing a task
# which points at Program Files without node_modules makes it fail after a
# reboot, so only the self-contained build output is deployed.
Copy-Item -Path (Join-Path $source "dist") -Destination $InstallRoot -Recurse -Force

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
Write-Host "Installed $serviceName boot task on http://127.0.0.1:$Port"
Write-Host "Next: configure Tailscale Serve to forward HTTPS to http://127.0.0.1:$Port"
