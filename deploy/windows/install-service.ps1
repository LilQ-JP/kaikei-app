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

$startScript = Join-Path $InstallRoot "start-service.ps1"
@"
`$env:NODE_ENV = 'production'
`$env:KAIKEI_DATA_DIR = '$DataRoot'
`$env:PORT = '$Port'
Set-Location '$InstallRoot'
& '$NodePath' (Join-Path '$InstallRoot' 'dist\index.js')
"@ | Set-Content -Encoding UTF8 $startScript

if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
  Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
  sc.exe delete $serviceName | Out-Null
  Start-Sleep -Seconds 2
}

New-Service -Name $serviceName -DisplayName "LilQ 会計サーバー" -Description "個人事業主向け会計アプリ" -BinaryPathName "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$startScript`"" -StartupType Automatic
Start-Service -Name $serviceName
Write-Host "Installed $serviceName on http://127.0.0.1:$Port"
Write-Host "Next: configure Tailscale Serve to forward HTTPS to http://127.0.0.1:$Port"
