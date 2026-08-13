# Third-party provenance

この文書は、ErabiFlowがソースツリーへ直接置く実行物・モデルと、配布時に取得または同梱する主要コンポーネントの出所を固定します。依存更新時は、コード、lockfile、SHA-256、ライセンス通知を同時に更新します。

## Gitで追跡するMediaPipeコンポーネント

| ファイル | 出所 | Bytes | SHA-256 | License |
| --- | --- | ---: | --- | --- |
| `public/mediapipe-wasm/vision_wasm_internal.js` | `@mediapipe/tasks-vision@0.10.35/wasm` | 322044 | `e7fd9858e8e8f221d9b96eddc11f8e077f263e0b7bbd79d3cbe882b134274f8c` | Apache-2.0 |
| `public/mediapipe-wasm/vision_wasm_internal.wasm` | `@mediapipe/tasks-vision@0.10.35/wasm` | 11153617 | `6a5c64584c2ab61c763b6e204afbdbc7ce1caf7f5216187322bca8df94f646bc` | Apache-2.0 |
| `public/mediapipe-wasm/vision_wasm_nosimd_internal.js` | `@mediapipe/tasks-vision@0.10.35/wasm` | 321847 | `438d1fe8ff7f4d946025bc211c291543c037d8a3785ed4eee60f1f521b236296` | Apache-2.0 |
| `public/mediapipe-wasm/vision_wasm_nosimd_internal.wasm` | `@mediapipe/tasks-vision@0.10.35/wasm` | 10481398 | `8a3092d34c79d3f57e6ba8592105e8a90f6b07c27891ffecd14cca428bfd3e31` | Apache-2.0 |
| `public/mediapipe-wasm/blaze_face_short_range.tflite` | [Google MediaPipe model storage](https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite) | 229746 | `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f` | Apache-2.0 |
| `public/mediapipe-wasm/magic_touch.tflite` | [Google MediaPipe model storage](https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite) | 6227884 | `e24338a717c1b7ad8d159666677ef400babb7f33b8ad60c4d96db4ecf694cd25` | Apache-2.0 |

WASM 4ファイルは、同じlockfileから導入した`node_modules/@mediapipe/tasks-vision/wasm`とbyte-for-byteで一致することを確認します。MediaPipe本体とモデルの利用条件は[公式リポジトリ](https://github.com/google-ai-edge/mediapipe)を参照し、Apache-2.0全文を`src-tauri/resources/licenses/Apache-2.0.txt`へ同梱します。

MediaPipe公式は一般のTasks APIについて利用状況metricsを送る場合があると案内しています。ErabiFlowはWASMとモデルをローカル配布し、本番WebViewの`connect-src`をTauri IPCとローカルprotocolだけに制限しているため、現在の統合からGoogle等の第三者endpointへ通信できません。MediaPipe更新またはCSP変更時は、入力データだけでなくmetrics通信も再監査します。

## Gitで追跡しない配布ランタイム

| Component | 固定記録 | 配布方針 |
| --- | --- | --- |
| FFmpeg | `release/ffmpeg-source.json` | 軽量application buildは固定したBtbN LGPL buildを初回取得し、archiveとexeをSHA-256検証する。Gitでは追跡しない。 |
| whisper.cpp CPU runtime | `release/whisper-runtime.json` | 軽量application buildと開発bootstrapは公式v1.8.3 Windows x64 archiveを取得し、SHA-256検証する。Gitでは追跡しない。 |
| Silero VAD 6.2.0 | `release/whisper-runtime.json` | whisper.cpp公式tag内の変換済みモデルを取得し、885098 bytesとSHA-256を検証する。MIT。 |
| Whisper large-v3-turbo | `src-tauri/src/model.rs` | Gitへ置かず、初回利用時にHugging Face上のwhisper.cpp公式配布から取得。1624555275 bytes、SHA-256 `1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69`。MIT。 |
| Python runtime / PyInstaller bootloader | `python-sidecar/requirements.txt`, build environment | build時に使用したPython `LICENSE.txt` とPyInstaller `COPYING.txt`をdaemon bundleへコピーする。 |

Vulkan／CUDA版whisper.cppはCPU fallbackと別の任意最適化です。再現可能性を守るため、出所、commit、build flags、ハッシュが記録されていないローカルGPU buildを配布物へ混入させません。

## ErabiFlow固有アセット

- `branding/erabiflow-icon-master.png`はOpenAI Media Serviceで生成した画像をYOSHOLabsがErabiFlowのブランドmasterとして採用したものです。ファイル内にOpenAI Media ServiceのC2PA Content Credentialsを保持しています。OpenAIとの関係では生成outputの権利は利用者側に帰属するとされますが、outputの非一意性、第三者権利の確認、適用法上の保護可能性は別問題です。利用条件は[OpenAI Services Agreement](https://openai.com/policies/services-agreement/)を確認します。SHA-256は`ee7cf29711da8116ed618c336b03b21ad92a8b359642bac8cf05a7fd769afa89`です。
- `src-tauri/icons/`と`public/brand/`は上記masterから作ったErabiFlow用派生iconです。これらのErabiFlow名・ロゴとしての使用には、ソースコードの権利条件とは別に`TRADEMARKS.md`を適用します。
- `public/se-icons/*`はGoogle Generative AIで生成した8画像です。各ファイルのC2PA manifestは`c2pa.created`のdigital source typeを`trainedAlgorithmicMedia`とし、SynthID watermark処理も記録しています。Googleは生成contentの所有権を主張しないとしていますが、利用者が適法性と第三者権利を確認する責任は残ります。利用条件は[Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)を確認します。ファイル名は既存互換のため`.png`ですが、payloadはJPEG/JFIFです。C2PA manifestを除去・改変せず、置換時は生成元、取得日、hashを更新します。
- `assets/se/*.wav` は44.1kHz mono、1秒、全サンプル値0の無音placeholderです。第三者の録音物は含みません。
- テスト動画、ユーザー動画、`.vfocus`、`.vflicense`、配布MSI、モデル、FFmpeg、Python build outputはGit管理対象外です。

| 生成SE icon | SHA-256 |
| --- | --- |
| `public/se-icons/comedy.png` | `bd11cabc0515f1c993e9df13086d1f99fa5f7b973cfb32a77e156589b7aef583` |
| `public/se-icons/emphasis.png` | `1430af9279a28b4bc3a55094f4842d5a8d6bd81b254c9bb62b2411b2292aead9` |
| `public/se-icons/explosion.png` | `fbe297e34e824ad89251df70e1555b1df2bc244674bc98b6470ca072ff350049` |
| `public/se-icons/surprise.png` | `a003edc07f0d2bcd871ecd5a20519b4a3f7cdad72259bb4730060ba1784850c0` |
| `public/se-icons/tension.png` | `ad5959165dbfff60b4b4ff77376607e0f83f32757aff5005dc9cb79be7aac7fa` |
| `public/se-icons/transition.png` | `7c2abf55cb758694001b13eb3afe99508aa38157d302fe1a8b7293021eedfc9a` |
| `public/se-icons/victory.png` | `f64c09c063382cd4af32f15a2c808734903799e6755006a226f51f854e81dd57` |
| `public/se-icons/warning.png` | `9325b540d70ec6f693277eba306a146c7721c68fef81dee339e9e8ad0dacbac4` |

## 依存物更新・配布時の確認

1. `npm ci` 後、MediaPipe WASMと追跡ファイルのSHA-256一致を確認する。
2. `npm run audit:dependencies` と `npm run audit:licenses` を実行し、npm、Python、Rustの既知脆弱性、欠落・未審査ライセンス、依存定義のハッシュを確認する。ライセンス条件の法的判断は本書、同梱NOTICE、各依存manifestも合わせて行う。
3. `scripts/ffmpeg_official_download_smoke.ps1` でFFmpegの固定archiveを実取得して照合する。
4. 軽量buildにlarge Whisper model、FFmpeg、任意GPU runtimeが混入していないことを`npm run check:light`で確認する。
5. 展開MSIに`THIRD_PARTY_NOTICES.txt`、`licenses/Apache-2.0.txt`、`licenses/DEPENDENCY_LICENSES.generated.txt`、daemon runtime licenseが含まれることを確認する。

依存license監査ではMPL-2.0（例: RustのCSS selector系crate）、CC-BY-4.0（ブラウザ互換データ）、PyInstallerのBootloader Exceptionを明示的に許可しています。新しいlicense識別子、license未申告package、または依存定義hashの不一致は監査を失敗させます。MPL対象依存を改変して配布する場合は、対象ファイルのソース提供条件を改めて確認してください。
