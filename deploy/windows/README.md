# Lenovo本番配置

Lenovo上で管理者権限のPowerShellから実行します。

```powershell
Set-Location C:\path\to\kaikei-app
pnpm install --prod
pnpm build
.\deploy\windows\install-service.ps1
tailscale serve --https=443 http://127.0.0.1:4175
tailscale serve status
```

データ本体は `C:\ProgramData\LilQKaikei` に置き、Google Drive同期フォルダにはSQLite本体を置きません。暗号化バックアップをGoogle Driveへコピーする場合は、バックアップ先を別途同期対象として設定します。

外部AIを有効にする場合は、APIキーをソースコードやGitへ保存せず、Lenovoのサービス環境変数へ設定します。キー未設定時は、アプリ内のローカル仕訳候補（過去履歴・キーワード）のみを使い、仕訳を自動確定しません。

正式運用前に、`/api/v1/health`、再起動後のサービス、Tailscale外部遮断、バックアップ復元、過去申告書照合を必ず確認してください。
