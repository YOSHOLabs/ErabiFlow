# ErabiFlow Beta 利用規約

対象: ErabiFlow Beta — Version 0.1.0

この文書はYOSHOLabsが無料で配布するErabiFlow Betaの利用条件です。GitHubで公開しているsource codeにはrootの`LICENSE`が別に適用され、このEULAによってsource codeの再利用・再配布権は付与されません。

## 1. 使用許諾

YOSHOLabsは、本契約に同意する利用者に対し、ErabiFlowをWindows PCへinstallし、個人または組織内部で動画解析、ラフカット判断、NLE向けdata生成に使用する、限定的、非独占的、譲渡不能、再許諾不能の権利を許諾します。

ErabiFlowで作成した動画・JSON・CSV・EDL・SRT等の成果物について、本契約は個人利用または商用利用を追加で制限しません。ただし、利用者は元動画、音声、画像、font、出演者の権利、privacy、契約、platform rule等を自ら確認し、必要な許諾を得る責任を負います。ErabiFlowまたは第三者componentそのものの再配布権は含みません。

## 2. 禁止事項

適用法が明示的に認める場合を除き、利用者は次を行えません。

- ErabiFlow本体、license mechanism、installer、update mechanismを第三者へ再配布、販売、貸与、再許諾すること
- security、license、権限、出力先検証を回避すること
- 不正access、権利侵害、malware配布その他の違法目的に使用すること
- ErabiFlowまたはYOSHOLabsとの提携・保証があるように誤認させること
- source code termsに反してreverse engineering、改変、派生物配布を行うこと

interoperability、security research、法令上の例外は、適用法で認められる範囲を妨げません。security問題は公開せず`SECURITY.md`の方法で報告してください。

## 3. Local dataと第三者software

ErabiFlowは動画・音声・字幕を端末内で処理します。初回のFFmpegおよびWhisper model取得等の外部通信、local data、削除方法は`PRIVACY.md`と`WINDOWS_DISTRIBUTION.md`に記載します。

FFmpeg、whisper.cpp、Whisper model、Silero VAD、MediaPipe、Python runtime、PyInstallerその他の第三者componentには各権利者のlicenseが適用されます。第三者ライセンスで認められる使用、改変、調査、再配布等の権利を本規約は制限しません。アプリ同梱の`THIRD_PARTY_NOTICES.txt`および`licenses`directoryを確認してください。

## 4. Data保全と無保証

利用者は元動画、project、書き出し結果のbackupを保持し、重要な成果物をNLE等で確認してください。AI候補、字幕、timestamp、codec対応、GPU処理、NLE import結果は素材と環境に依存し、正確性、完全性、特定目的適合性を保証しません。

ErabiFlowは適用法が許す最大限の範囲で「現状有姿」で提供されます。YOSHOLabsは、利用不能、data消失、事業中断、逸失利益、第三者claimその他の間接・特別・結果的損害について、法令上免責できない場合を除き責任を負いません。強行法規により責任を制限できない場合は、その法令が優先します。

## 5. Update、support、終了

初回公開版は自動updateを行いません。利用者はGitHub Releasesから新しいMSIを取得します。securityまたは互換性上必要な場合、YOSHOLabsは旧versionのsupportを終了できます。

利用者が本契約へ重大に違反した場合、使用許諾は終了します。終了後はErabiFlowをuninstallしてください。利用者が作成したprojectや成果物の権利・保存は、別途法的義務がある場合を除き終了の影響を受けません。

## 6. 適用法と問い合わせ

本規約は、利用者に適用される強行法規や消費者保護上の権利を制限しません。本規約では準拠法および専属的合意管轄を特に指定しません。

通常の問い合わせ窓口は[GitHub Issues](https://github.com/YOSHOLabs/ErabiFlow/issues)です。Issueは公開されるため、個人情報、動画内容、license key、秘密情報を投稿しないでください。
