# ErabiFlow Privacy Policy

最終更新日: 2026年8月20日

この方針はYOSHOLabsが一般配布するErabiFlowデスクトップアプリ v0.1.0に適用します。GitHub、Hugging Faceその他の第三者サイトには、それぞれのprivacy policyが適用されます。

## 端末内で処理するデータ

ErabiFlowは、ユーザーが選択した動画、音声、字幕、編集区間、project、書き出し結果をWindows PC上で処理します。AI候補、文字起こし、波形、thumbnail、proxy、cache、任意で有効にした見どころfeedbackもローカルに保存します。

動画、音声、字幕本文、AI候補、project、ユーザーの絶対pathを、解析目的でYOSHOLabsまたは外部AI APIへ送信しません。account login、クラウド同期、広告計測、product analytics、telemetry、遠隔crash reportは実装していません。見どころfeedbackは既定で無効で、有効にしても端末内のJSONLへ記録するだけです。

## 外部通信

MSI installerとアプリが自動で行い得る外部通信は、次の初回依存物取得です。

- Microsoft Edge WebView2 Runtime bootstrapper: `go.microsoft.com`（Runtime未導入時のinstall中のみ。MicrosoftのbootstrapperがRuntimeを取得・導入します）
- FFmpeg ZIP: `github.com/BtbN/FFmpeg-Builds`
- Whisper model: `huggingface.co/ggerganov/whisper.cpp`

通信先には通常のHTTPS通信に伴うIP address、時刻、User-Agent等が見える場合があります。WebView2の取得と導入はMicrosoftのbootstrapperが行い、Microsoftのprivacy条件が適用されます。ErabiFlow自身はFFmpegとWhisperのdownload fileについてsizeとSHA-256を検証します。whisper.cpp CPU runtime、Silero VAD、MediaPipe runtime/modelは一般配布MSIに含めるため、通常の初回起動でこれらを追加downloadしません。

初回公開版の自動updaterは無効です。アプリはupdate manifestを定期取得しません。ユーザーがGitHub Releases、support link、TikTok、Instagram、YouTube等を明示的に開いた場合は、移動先serviceへ通常のbrowser通信が発生します。

## 保存期間と削除

local dataはユーザーが削除するまで端末に残ります。保存場所と安全な削除方法は[Windows配布要件](WINDOWS_DISTRIBUTION.md)に記載しています。アンインストールだけでは、project、設定、download済みmodel、cacheを自動削除しません。ユーザーが選択した元動画や書き出しfileをErabiFlowのuninstallerが削除することはありません。

## 診断情報と問い合わせ

production buildは永続telemetryを送信せず、既定で常設log fileを作りません。画面からcopyできる診断情報にはruntime状態、GPU種別、直近の処理状態が含まれる場合があります。問い合わせ前に動画内容、字幕本文、license key、秘密鍵、access token、個人の絶対pathを削除してください。

通常の問い合わせは[GitHub Issues](https://github.com/YOSHOLabs/ErabiFlow/issues)を利用できます。Issueは公開情報です。security問題や秘密情報を伴う報告は公開Issueへ書かず、[Security Policy](../SECURITY.md)のprivate vulnerability reportingを利用してください。

## 子どものprivacy、法的請求、変更

ErabiFlowは子ども向けserviceとして設計しておらず、YOSHOLabsがアプリ経由で個人情報を収集するaccount systemもありません。適用法に基づく請求や、本方針の法的表現・連絡手段については、一般公開前に専門家レビューを受けることを推奨します。

本方針を変更する場合はrepositoryとrelease案内で更新日と変更内容を示します。自動updaterを将来有効にする場合や、telemetry、crash report、cloud機能を導入する場合は、その通信内容、目的、保存期間、選択方法を導入前に追記します。
