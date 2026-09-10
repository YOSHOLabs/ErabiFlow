# ErabiFlow Beta — Version 0.1.0 Windows配布要件

## ダウンロードの確認

[公式GitHub Releases](https://github.com/YOSHOLabs/ErabiFlow/releases)からMSIとSHA256SUMS.txtを同じリリースで取得します。MSIを保存したフォルダでPowerShellを開き、次を実行して表示されたHashを照合してください。

```powershell
Get-FileHash -LiteralPath './ErabiFlow-0.1.0-x64.msi' -Algorithm SHA256
```

一致しない場合は実行せず、公式Releaseから再取得してください。未署名のため警告が出る場合があります。セキュリティ保護の無効化は必要ありません。

この文書は一般ユーザー向けMSIに記載するインストール要件、初回通信、保存場所、更新・削除方法をまとめたものです。ソースから開発するための要件ではありません。

## 対応環境

- 公式対象: Windows 11 64-bit、x64（Intel 64 / AMD64）
- 対象外・未検証: Windows 10、Windows on ARM、32-bit Windows、Windows Server、仮想デスクトップ
- 必須: Microsoft Edge WebView2 Runtime。Windows 11では通常OSに含まれます。
- メモリ: 8GB以上、16GB以上を推奨
- 空き容量: 初回セットアップ前に5GB以上を推奨。これとは別に元動画、解析一時ファイル、書き出し動画の容量が必要です。
- GPU: 必須ではありません。一般配布版のWhisper文字起こしはCPU runtimeを使用します。動画書き出しはNVIDIA NVENCまたはAMD AMFを利用できる場合がありますが、利用できない場合はMedia Foundation、続いてソフトウェアencoderへフォールバックします。
- Vulkan / CUDA: 一般配布版の必須要件ではありません。Vulkan/CUDA版whisper.cppは同梱しません。

Windows 10で動作する可能性はありますが、2026年8月時点の一般配布候補ではサポート対象に含めません。ARM64向けinstallerも生成しません。

## Installer

- 形式: WiX MSI
- 製品名: ErabiFlow
- 発行元表示: YOSHOLabs
- production identifier: `com.yosholabs.erabiflow`
- development identifier: `com.yosholabs.erabiflow.dev`
- executable: `erabiflow.exe`
- version: `0.1.0`
- upgradeCode: `92a6d8f9-c8ab-459e-a6db-6f27376dc45b`（今後の更新でも変更しません）
- 公開用asset名: `ErabiFlow-0.1.0-x64.msi`
- install scope: 端末単位（per-machine）。標準のinstall先は`%ProgramFiles%\ErabiFlow`で、install / update / uninstall時にWindowsの管理者承認（UAC）が必要です。
- shortcut: DesktopとStart menuにErabiFlow shortcutを作成し、Start menuにuninstall shortcutを作成します。

初回公開版はAuthenticode署名を行いません。Windows Defender SmartScreenやUACで「不明な発行元」と表示される可能性があります。配布元が `https://github.com/YOSHOLabs/ErabiFlow/releases` であることと、releaseに掲載するSHA-256が一致することを確認してください。

## 初回セットアップと通信

MSIにはローカル解析daemon、Python runtime、whisper.cpp CPU runtime、Silero VAD、MediaPipe runtime/modelを含めます。次の依存物は必要時にHTTPSで取得します。

| 対象 | 配布元 | Download size | 検証 |
| --- | --- | ---: | --- |
| Microsoft Edge WebView2 Runtime | Microsoft / `go.microsoft.com` | Microsoft配布内容により変動（下記1.65GiBには含まない） | Runtime未導入時にMSIがbootstrapperを取得し、silent installが成功 |
| FFmpeg LGPL ZIP | GitHub / BtbN FFmpeg-Builds | 145,265,304 bytes（約138.5MiB） | ZIPと展開後EXEのsize・SHA-256 |
| Whisper large-v3-turbo model | Hugging Face / ggerganov/whisper.cpp | 1,624,555,275 bytes（約1.51GiB） | modelのsize・SHA-256 |

アプリ内downloadの合計は最大1,769,820,579 bytes（約1.65GiB）です。WebView2 Runtimeの取得量はMicrosoft配布内容により変わるため、この合計に含みません。FFmpegは動画を最初に扱う前、Whisper modelはAI字幕・解析を最初に使う前に取得します。`.part`へ保存し、HTTP Rangeが利用できる場合は再開します。取得後は動画、音声、字幕、AI候補の生成を端末内で行います。

WebView2未導入PCでProxyやfirewallが`go.microsoft.com`を遮断するとMSI installは完了しません。GitHubまたはHugging Faceを遮断するとアプリ内の初回セットアップは完了しません。WebView2、FFmpeg、Whisper modelが取得済みなら、更新確認を含む自動通信なしで編集・解析・書き出しを利用できます。初回公開版の自動updaterは無効です。WebView2未導入環境でのMSI installはclean PC実機で未確認です。

## 保存場所

identifierに基づくTauriの保存先と、解析daemonの保存先を使用します。

- roaming app data: `%APPDATA%\com.yosholabs.erabiflow`
- local app data、FFmpeg、Whisper model、ローカルfeedback: `%LOCALAPPDATA%\com.yosholabs.erabiflow`
- WebView2/localStorage: `%LOCALAPPDATA%\com.yosholabs.erabiflow`配下
- 解析cache: `%LOCALAPPDATA%\ErabiFlow\analysis-cache`
- media proxy / waveform cache: Tauriの`com.yosholabs.erabiflow` app cache配下
- production log: 常設のtelemetry/crash-report送信はなく、production buildは永続ログを既定で作りません。画面から取得する診断情報は直近のdaemon stderrをメモリ上で保持します。

ユーザーが選択した`.vfocus`、書き出し動画、JSON、CSV、EDL、SRTは選択した場所に保存します。動画・字幕本文・絶対パスを外部telemetryへ送信しません。

## 更新、アンインストール、データ削除

初回公開版は自動更新しません。新しいMSIをGitHub Releasesから取得して上書きinstallします。同じupgradeCodeを維持し、旧版からの更新をWindows Installerに処理させます。MSIは新しいversionから古いversionへのdowngradeを拒否します。

アンインストールはWindowsの「設定 > アプリ > インストールされているアプリ > ErabiFlow > アンインストール」から行います。ユーザーのproject、元動画、書き出し結果をinstallerが削除することはありません。設定、取得済みruntime/model、解析cacheも安全のため自動削除しません。

完全にローカルデータを削除する場合は、ErabiFlowを終了・アンインストールした後、必要な`.vfocus`や書き出し結果を退避してから、次の3フォルダだけを手動で削除します。

- `%APPDATA%\com.yosholabs.erabiflow`
- `%LOCALAPPDATA%\com.yosholabs.erabiflow`
- `%LOCALAPPDATA%\ErabiFlow\analysis-cache`

入力動画や上記以外のユーザーフォルダを削除対象に含めないでください。

## Supportと既知の制限

- 通常の不具合・要望: [GitHub Issues](https://github.com/YOSHOLabs/ErabiFlow/issues)
- 脆弱性や秘密情報を含む報告: [Security Policy](../SECURITY.md)
- 既知の制限: [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)
- Privacy: [PRIVACY.md](PRIVACY.md)
- 一般配布版利用条件: [EULA.md](EULA.md)
- 第三者component: [THIRD_PARTY_PROVENANCE.md](THIRD_PARTY_PROVENANCE.md) とアプリ同梱の`THIRD_PARTY_NOTICES.txt`
