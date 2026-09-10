# ErabiFlow Beta — Version 0.1.0

長尺動画の見どころ候補を整理し、人が必要な区間を選んでラフカットし、動画編集ソフトへ渡すWindows向けツールです。AIが候補と根拠を提示し、KEEP／没、IN／OUT、分割、順番は人が決めます。

このBetaは公開準備中です。公開後は以下の公式Releaseから取得できます。

## Download

- **対象: Windows 11 64-bit / x64**
- **[公式GitHub Releases](https://github.com/YOSHOLabs/ErabiFlow/releases)**
- MSI: **ErabiFlow-0.1.0-x64.msi**
- SHA-256: 同じReleaseの **SHA256SUMS.txt** を参照してください。最終ビルドがMSIと同時に生成します。

保存先でPowerShellを開き、表示されたHashとSHA256SUMS.txtの値を比較してください。

```powershell
Get-FileHash -LiteralPath './ErabiFlow-0.1.0-x64.msi' -Algorithm SHA256
```

未署名のため、SmartScreen警告や「不明な発行元」の表示が出る場合があります。公式配布元とSHA-256が一致しないファイルは実行せず、再取得してください。

## インストールと初回準備

MSIを実行して管理者承認（UAC）後、案内に従ってインストールします。標準の保存先はProgram Files内のErabiFlowです。Start Menuとデスクトップから起動できます。

**初回はアプリ内で最大約1.65GiBのダウンロードが発生します。**

- 動画エンジンFFmpeg: 約138.5MiB、GitHubから取得。
- AI字幕モデルWhisper large-v3-turbo: 約1.51GiB、Hugging Faceから取得。

取得対象・容量・進捗を画面で確認できます。中断したデータを保持し、再開対応の配布元では続きから取得します。エラーの場合は通信と空き容量を確認して再試行してください。サイズとSHA-256が一致したものだけ使用します。

WebView2未導入の場合は、MSIがMicrosoftから取得します。この容量は上記に含みません。初回準備前に5GB以上の空き容量を確保し、元動画と書き出し用に追加の容量も用意してください。

## 使い方

1. 動画を追加し、ローカル解析を実行します。
2. 見どころ候補と根拠を確認してKEEP／没を決めます。
3. IN／OUTを調整し、必要に応じて分割・並べ替えます。
4. ラフカットを再生して確認し、「受け渡す」へ進みます。
5. 元画角のMP4 / MOVと、必要なJSON / CSV / CMX 3600 EDL / SRTを出力します。
6. 編集ソフトで映像・音声・区間・字幕を確認して仕上げます。

動画・音声・字幕の解析は端末内で行います。アカウント登録は不要です。

## Betaの制限

AI候補と字幕には人による確認が必要です。文字起こしはCPUで実行し、長尺動画では時間がかかります。解析キャンセルの停止まで待ち時間が生じる場合があります。

ラフカットは元画角を維持します。字幕の焼き込み、カラーや演出の仕上げは次の編集ソフトで行ってください。EDLは単一ソースのストレートカット向けで、複雑なエフェクトやドロップフレームを表現しません。JSON/CSVは汎用データで、NLEへの直接importを保証しません。

Windows 10、ARM64、NVIDIA、Premiere Pro、別PC・第三者試用は未検証です。Resolveへの実importも手動確認が必要です。[既知の制限](https://github.com/YOSHOLabs/ErabiFlow/blob/main/docs/KNOWN_LIMITATIONS.md)をご覧ください。

## 更新・アンインストール

自動更新はありません。新しい版は公式Releasesから手動で取得します。アンインストールはWindowsの「設定 > アプリ > インストールされているアプリ」から行います。

元動画、project、出力動画、JSON/CSV/EDL/SRT、設定、取得済みモデル・runtime・cacheは自動削除しません。[完全削除と保存場所](https://github.com/YOSHOLabs/ErabiFlow/blob/main/docs/WINDOWS_DISTRIBUTION.md)を確認してください。

## Feedback

不具合や感想は[GitHub Issues](https://github.com/YOSHOLabs/ErabiFlow/issues/new/choose)へお願いします。ErabiFlowとWindowsのバージョン、操作内容、エラー、再現手順を書いてください。個人情報、字幕本文、動画、絶対パスは貼り付けないでください。

セキュリティ問題は[非公開の脆弱性報告](https://github.com/YOSHOLabs/ErabiFlow/security/advisories/new)を利用してください。

[Privacy](https://github.com/YOSHOLabs/ErabiFlow/blob/main/docs/PRIVACY.md) · [利用規約](https://github.com/YOSHOLabs/ErabiFlow/blob/main/docs/EULA.md) · [第三者ライセンス](https://github.com/YOSHOLabs/ErabiFlow/blob/main/docs/THIRD_PARTY_PROVENANCE.md)
