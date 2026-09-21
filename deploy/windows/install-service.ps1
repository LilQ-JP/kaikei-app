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
Copy-Item -Path (Join-Path $source "dist"), (Join-Path $source "package.json"), (Join-Path $source "pnpm-lock.yaml") -Destination $InstallRoot -Recurse -Force

$launcher = Join-Path $InstallRoot "launcher.mjs"
@(
  "Object.assign(process.env,{NODE_ENV:'production',KAIKEI_DATA_DIR:'$($DataRoot -replace '\\','/')',PORT:'$Port'});"
  "await import('./dist/index.js');"
) | Set-Content -Encoding UTF8 $launcher

# A plain PowerShell process cannot be registered as a Windows service because
# it does not speak the Windows service control protocol. Use Task Scheduler,
# which starts the Node process at boot under SYSTEM and survives logoff.
if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
  Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
  sc.exe delete $serviceName | Out-Null
  Start-Sleep -Seconds 2
}
$taskAction = "`"$NodePath`" `"$launcher`""
schtasks.exe /Create /TN $serviceName /SC ONSTART /RU SYSTEM /TR $taskAction /F | Out-Null
schtasks.exe /Run /TN $serviceName | Out-Null
Write-Host "Installed $serviceName boot task on http://127.0.0.1:$Port"
Write-Host "Next: configure Tailscale Serve to forward HTTPS to http://127.0.0.1:$Port"
