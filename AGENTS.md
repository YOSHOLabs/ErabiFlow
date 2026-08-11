# AGENTS.md — TateClip リポジトリ作業指示

このファイルはリポジトリ全体に適用する。ここに書かれた事実は、ソースコード、設定、テスト、リリース文書を確認した時点のもの。コードと文書が食い違う場合は、実行されるコードとテストを優先し、食い違い自体も報告すること。確認できないことを推測で補わず、最終報告で「未確認」と明記する。

## 1. プロジェクト概要

TateClip は、横・縦を問わない長い動画をローカルで解析し、AIが提示した見どころ候補と根拠をもとに人がKEEP／没を判断する Windows 向けデスクトップアプリである。主なワークスペースは「見どころを見つける」「ラフカットを決める」「受け渡す」。完成映像の演出を行う動画編集ソフトではなく、元画角のラフカット動画とJSON／CSV／CMX 3600 EDL／SRTをPremiere ProやDaVinci Resolve等へ渡す橋渡し製品として扱う。

主要技術は次のとおり。

- UI: React 19、TypeScript、Vite、Tailwind CSS 4
- 状態管理: Zustand、Immer、zundo（undo/redo）
- デスクトップ境界: Tauri 2、Rust、Tokio
- 動画・音声: FFmpeg、ffprobe、whisper.cpp
- AI 解析サイドカー: Python、PyInstaller、JSON Lines IPC
- 顔検出: MediaPipe Tasks Vision
- テスト: Node.js test runner、Playwright、Rust unit tests、Python unittest

主要な処理の流れは以下。

1. `src/main.tsx` が `src/App.tsx` を起動し、`src/components/VideoProcessor.tsx` がワークフロー UI を構成する。
2. ユーザーが選択した動画パスを `useDocumentStore` に設定し、`src/hooks/useVideoInfo.ts` が Rust コマンド経由でメタデータと波形を取得する。
3. AI 解析は `src/features/analysis/` → `src/tauri/commands.ts` → `src-tauri/src/daemon.rs` → `python-sidecar/gemma_daemon.py` → `gemma_engine.py` / `pipeline/` の順に流れる。
4. 解析 artifact を正規化し、ユーザーが候補をタイムラインへ採用する。編集状態の正本は `src/stores/document.ts` と各 slice である。
5. プレビューは `src/preview/` の Canvas レンダラー、書き出しは `src/lib/renderSpec.ts` から RenderSpec v2 を作り、Rust が検証・正規化して FFmpeg を実行する。

## 2. リポジトリ構成

| パス | 役割 |
| --- | --- |
| `src/main.tsx`, `src/App.tsx` | React のエントリーポイント、起動時初期化、全体オーバーレイ |
| `src/components/VideoProcessor.tsx` | 3 ワークスペースを束ねる主要 UI |
| `src/components/`, `src/features/` | 汎用 UI と、解析・Creator・セットアップ等の機能 UI |
| `src/stores/document.ts`, `src/stores/slices/` | 永続化対象となる編集ドキュメントとその操作 |
| `src/stores/editor.ts` | 再生、選択、UI 表示などの一時的なエディター状態 |
| `src/stores/entitlement.ts` | Free / Creator 権限の UI 状態 |
| `src/lib/` | タイムライン、字幕、RenderSpec、書き出し引数、プロジェクト移行等の純粋ロジックと Node.js tests |
| `src/preview/` | Canvas プレビューのエンジンとレイヤー実装 |
| `src/tauri/commands.ts` | UI から Tauri invoke / event を呼ぶ型付き境界 |
| `src-tauri/src/lib.rs`, `main.rs` | Tauri アプリ登録と Rust エントリーポイント |
| `src-tauri/src/commands/` | 動画、音声、システム、アセットのコマンド実装 |
| `src-tauri/src/ffmpeg/` | FFmpeg filter graph、字幕 ASS、エンコーダー選択、子プロセス実行 |
| `src-tauri/src/daemon.rs` | Python daemon の起動、JSONL IPC、進捗、タイムアウト、キャンセル |
| `src-tauri/src/path_security.rs`, `media_protocol.rs` | ファイルスコープ、出力先検証、range 対応のメディア配信 |
| `src-tauri/src/recovery.rs`, `license.rs` | 復旧スナップショット、Creator ライセンス検証 |
| `src-tauri/src/ffmpeg_runtime.rs`, `model.rs` | FFmpeg / Whisper モデルの取得、ハッシュ検証、再開、キャンセル |
| `python-sidecar/` | AI daemon、解析エンジン、字幕・音声・ハイライト pipeline、Python tests |
| `e2e/`, `e2e-release/` | アプリのブラウザ demo とproduction frontendのPlaywright tests |
| `scripts/`, `release/`, `docs/` | セットアップ、監査、build補助、外部runtimeの固定情報、設計文書 |
| `assets/`, `public/`, `src-tauri/resources/` | SE、MediaPipe、画像、同梱物、ライセンス通知 |

`node_modules/`, `dist/`, `src-tauri/target*/`, `python-sidecar/build/`, `python-sidecar/dist/` は生成物である。生成物やrelease artifactを扱う依頼でない限り、手編集せず、通常の検索・レビュー対象から外す。公開リポジトリには`website/`、private beta資産、MSI、テスト動画、外部バイナリ、モデルを追加しない。

## 3. アーキテクチャ上のルール

- 依存方向は原則 `UI → store / src/lib → src/tauri/commands.ts → Rust command → Python または外部プロセス` とする。下位層から React component を参照しない。
- 永続的な編集内容は `useDocumentStore` と適切な `src/stores/slices/*Slice.ts` に置く。再生位置、選択状態、パネル表示など保存不要の UI 状態は `src/stores/editor.ts` に置く。権限状態は `src/stores/entitlement.ts` から分離しない。
- 計算、正規化、変換、検証は可能な限り `src/lib/` の純粋関数に置き、同じ場所に `*.test.ts` を追加する。component や hook にドメインロジックを埋め込まない。
- Tauri 呼び出しは `src/tauri/commands.ts` に集約する。component から invoke 名や Rust 引数を直書きしない。TypeScript の camelCase 引数と Rust の serde / command signature を同時に確認する。
- OS、ファイル、ライセンス、外部コマンドに関する最終検証は Rust 側で行う。UI の非表示・無効化だけをセキュリティ境界にしない。Creator 操作は Rust 側の再検証を維持する。
- Python は JSONL daemon の背後に保つ。stdout は IPC 専用であり、診断ログは stderr に出す。プロトコルを変える場合は TypeScript、Rust、Python、進捗 event、エラー形式を一組として更新する。
- Canvas プレビューと FFmpeg 出力は同じ document / RenderSpec の意味を共有する。表示機能を追加するときは `src/preview/` と `src-tauri/src/ffmpeg/` の双方を調査し、意図的な差異なら文書化する。現状、LUT は書き出し側のみが正確で、生成パーティクルは Canvas と FFmpeg で完全一致しない。
- `RenderSpec` はフロントエンドと Rust の互換性境界である。TypeScript は現在 v2 を生成し、Rust は v1 と v2 を受理する。version、mirror field、既定値、検証を片側だけ変更しない。
- 新しい UI は既存の feature / panel に、新しい document 操作は slice に、新しい純粋変換は `src/lib/` に、新しいネイティブ機能は `src-tauri/src/commands/` と `src/tauri/commands.ts` に置く。既存の境界で表現できない場合だけ、新しい層を提案する。

## 4. コーディング規約

- TypeScript は `strict` を維持する。既存の `PascalCase`（component / type）、`camelCase`（関数・変数）、`useXxx`（hook）、`XxxSlice`（store slice）、Rust / Python の `snake_case` に合わせる。
- 外部入力、保存データ、daemon 応答、Tauri 境界では型を信用せず、既存の normalizer / validator を通す。`any` の拡大より既存 domain type の拡張を優先する。
- 例外を握り潰さない。UI には操作可能なエラーを返し、Rust は文脈付きの文字列エラー、Python は IPC の error 応答と stderr ログを使う。秘密、ライセンスキー、動画内容、字幕本文、ユーザーの絶対パスを新しい telemetry や公開ログへ送らない。
- コメントはコードから分からない制約、互換性理由、外部ツールの癖を説明するために使う。処理の逐語説明は増やさない。
- 非同期の長時間処理を React render や UI thread 上で同期実行しない。既存の Tauri async command、Tokio child、Python worker、progress event を利用する。
- cancel flag、job id、pending map を処理層の間で一貫させる。キャンセル完了を即時と仮定しない。`finally` / drop / kill-on-drop と既存 cleanup を維持し、子プロセス、event listener、temp file、Blob URL を解放する。
- ファイル更新は、既存実装と同様に temp file への書き込み、検証、atomic rename を優先する。失敗時に既存ファイルや復旧 backup を失わない。
- Windows の空白、非 ASCII、長いパスを想定し、shell 文字列連結ではなく argument 配列や `Path` / `PathBuf` を使う。出力パスの security rule を迂回しない。
- ブラウザ／WebView 専用ライブラリ（例: Tauri API）を Node で動的 import / execute して調査しない。`window` / `document` がないため、型定義やソースを静的に読む。
- 依頼に無関係な整形、命名変更、ファイル移動、依存更新、リファクタリングを混ぜない。変更範囲は要求を満たす最小限とし、既存のユーザー変更を上書きしない。

## 5. プロジェクト固有の注意事項

### プロジェクトデータと状態

- `.vfocus` の実装上の `CURRENT_SCHEMA_VERSION` は `src/lib/project.ts` の **15**。unversioned v1 と v2 以降の段階的 migration、`DOCUMENT_KEYS` allowlist、processing の保存 subset を壊さない。
- `src/lib/project.test.ts` の旧version fixtureと回帰テストを維持する。project schema、whitelist、migration を変更する場合は、対象versionのfixtureを追加してから変更する。
- 再生状態、波形、解析 artifact / job、実行中 processing、entitlement は保存対象外。load 後は undo history を clear する。新規 field では「保存対象か」「旧データの既定値」「migration」「undo 対象」を決める。
- 入力動画を変える `projectSlice` の処理は解析結果、タイムライン等を意図的にリセットする。個別の field だけを残して古い動画の状態を混ぜない。
- 自動復旧は Tauri かつ非 demo で 1500 ms debounce、Rust 側で最大 20 MiB、temp → backup → rename。20 MiB を超える project は手動保存が必要。手動保存成功時の recovery clear を維持する。
- settings は localStorage schema v2、500 ms debounce。legacy auto-reframe は無効化される。開発用 plan override は development 限定のままにする。

### 動画、字幕、タイムライン、レンダリング

- 時刻は秒単位の浮動小数を基本にする。clip の source 範囲、timeline 範囲、transition、subtitle cue を変更するときは 0、同一時刻、動画末尾、重なり、空配列、極短 clip をテストする。
- 字幕は解析結果、SRT、学習補正、style、ASS 書き出しをまたぐ。Unicode、日本語、改行、ASS escaping、強調、cue の単調性を確認する。
- `buildRenderSpec` → export params → Rust deserialization / validation → FFmpeg builder の全段を確認する。UI preview の見た目だけ、または FFmpeg filter だけを直して完了にしない。
- 書き出し後は video stream と first frame を probe し、不正・途中生成の output を削除する既存挙動を維持する。encoder fallback は選択 GPU → Windows `h264_mf` → `libopenh264` だが、filter graph 自体の失敗は encoder retry では救済されない。
- custom `vfocus` media protocol は allowlist、HTTP range、1 chunk 最大 8 MiB により seek と 2 GiB 超ファイルを扱う。この仕組みを通常の全読み込みに戻さない。

### GPU、外部プロセス、長時間処理

- FFmpeg と Whisper model は URL、サイズ、SHA-256、marker が固定され、`.part` から再開し、検証後に rename する。`ffmpeg_runtime.rs` / `model.rs`、release metadata、smoke script の定数を片側だけ変えない。
- GPU 検出は Windows / PowerShell と実機依存。whisper.cpp は同梱 variant の有無により Vulkan / CUDA / standard 実行が変わる。CPU fallback を残し、特定 GPU の存在を前提にしない。
- FFmpeg runner は stdout の progress と stderr drain を並行する。片方を待って pipe を詰まらせない。Rust child の kill-on-drop を外さない。
- export の即時キャンセル UI は確認できていない。Creator batch の停止は「現在の item 完了後」。存在しない即時 cancel を仕様として書かない。
- `get_waveform_data` は managed FFmpeg を使う一方、track 数確認では PATH 上の `ffprobe` を呼ぶ。`<input>.waveform.wav` の temp 名、同時実行、書込権限、cleanup は壊れやすいので変更時に実メディアで確認する。

### Python daemon、並列処理、キャッシュ

- Rust daemon は配布 exe を優先し、development では Python script に fallback する。boot handshake は 10 秒、pending request は 10 分 timeout、stderr は直近 100 行を保持する。
- Python は request ごとに daemon thread を作り得る。`LocalAnalysisEngine` は singleton であり、無制限並列を追加しない。chunk 内の game / voice 音声解析は `ThreadPoolExecutor(max_workers=2)`、Whisper track は逐次処理である。
- cancel は job id に対応する `threading.Event` を Whisper 実行中や段階間で確認し、外部 `Popen` を kill する。cancel latency と race をテストし、完了 event と cancel event の順序を決め打ちしない。
- 解析 cache は version 14。key は絶対パス、file stat、解析 parameter、subtitle correction digest を含み、結果は temp から atomic replace する。cache 読み書き失敗は解析全体を失敗させない。既定 root は `%LOCALAPPDATA%/TateClip/analysis-cache`。
- Python の一時ファイルは PID + UUID で衝突回避し、`finally` で削除する。`VFOCUS_FFMPEG_PATH` / `VFOCUS_FFPROBE_PATH` 未設定時は PATH の command に fallback する。

### セキュリティ、Windows、配布

- 選択したファイルだけを asset scope に登録する。出力は絶対パス、入力と同じ directory、許可 extension、`<入力stem>_tateclip...` の条件を Rust が検証する。検証を UI だけへ移さない。
- 外部 URL opener は TikTok、Instagram、YouTube の allowlist。任意 URL や外部 content を privileged WebView に入れない。
- Creator では広告を表示しない。広告失敗で export を失敗させない。動画、パス、字幕を monetization 計測へ追加しない。
- release build / smoke script は PowerShell、MSI、Windows updater signing に依存する。署名鍵は環境変数または `%USERPROFILE%\.tateclip\updater-keys` から読み込み、リポジトリへ置かない。
- `release/metadata.json`の販売状態は既定で無効、未設定URLは空または`example.invalid`とする。ソースリポジトリの公開判定と、将来の一般ユーザー向けMSI配布判定を混同しない。

## 6. 変更時の基本ルール

機能追加・バグ修正は必ず次の順で行う。

1. 関連する component、store、pure logic、Tauri command、Rust、Python、既存 test、文書を調査する。
2. 既存の責務境界と互換性を保つ変更方針を決める。
3. 呼び出し元、保存 schema、RenderSpec、preview / export、daemon protocol、配布物への影響を確認する。
4. 必要最小限の変更を実装する。
5. 再現 test と regression test を関連 test suite に追加または更新する。
6. 変更に対応する build と test を実行する。
7. 実装差分だけを対象に、下記 2 観点で独立レビューする。
8. 指摘をコードと照合し、正しく要求範囲内のものだけ修正する。
9. 修正後に関連 test と build を再実行する。
10. 変更、試験結果、レビュー対応、未確認事項、残存リスクをユーザーへ報告する。

要求が曖昧な場合は、コードから安全に確定できる範囲だけ進める。当初依頼を超える仕様変更、大規模設計変更、schema / protocol の破壊的変更、配布設定変更が必要なら勝手に範囲を広げず、根拠と選択肢を示してユーザーに確認する。

## 7. テスト方針

### 通常の検証

リポジトリ root で、変更箇所に対応するものを実行する。アプリ横断変更では原則すべて実行する。

```powershell
npm test
npm run build
npm run test:e2e
```

```powershell
cd src-tauri
cargo test
cd ..
```

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s python-sidecar/tests -p "test_*.py"
```

- `npm test`: `src/lib/*.test.ts` の Node.js test runner。pure logic、store へ渡す変換、設定の変更で実行する。
- `npm run build`: `tsc && vite build`。TypeScript の型チェックと production build を兼ねる。
- `cargo test`: Rust command、path security、FFmpeg builder、protocol、recovery 等の変更で実行する。
- Python unittest: daemon engine、chunk、Whisper、glossary、scorer の変更で実行する。`.venv` がなければ使用した Python command と理由を報告する。
- `npm run test:e2e`: ブラウザ demo 上の主要 workflow。Tauri IPC、実 FFmpeg、実 AI daemon は通らないため、これだけで desktop 動作確認済みとはしない。

### 変更別の追加確認

- production frontend: `npm run test:e2e:release`。これはproduction modeの表示を確認するが、Tauri IPC、実FFmpeg、実AI daemonは通らない。
- lite desktop artifact: `npm run check:light`。artifactと署名入力を必要とするため、通常のソース変更testやGitHubソース公開判定と混同しない。
- Rust の `smoke_nle_clip_effects_with_real_video_when_configured` 等は、環境変数と実メディアがないと早期 return しても test runner 上は成功表示になる。実行条件を満たしたか明記する。
- 一般ユーザー向けバイナリ配布前は、clean Windows PCでinstall / uninstall、SmartScreen、初回FFmpeg / model download、cancel / resume / restart、Free / Creator、実動画の映像・音声・字幕・cropを手動確認する。この確認はPublic source repositoryの公開とは別管理にする。
- GPU / CPU encoder、Vulkan / CUDA / CPU Whisper、2 GiB 超動画、破損動画、権限不足、disk full、長時間 cancel / restart は実機・実データが必要。確認できなければ未確認と残存リスクを報告する。

`eslint.config.mjs` は存在するが、`package.json` に lint script はなく、参照する `eslint-config-next` も現在の依存一覧にない。lint を必須 command として捏造しない。Python の type checker も未設定。利用可能な test を実行できなかった場合は、成功と表現せず、未実施の command、理由、代替確認、影響する範囲を明記する。

設計経緯を確認する場合は利用可能なGit履歴と現在の実装・テストを照合する。履歴に根拠がない過去仕様を推測しない。

## 8. 実装完了後のレビュー手順

実装と初回 test 完了後、並列 agent / reviewer を利用できる場合は次の 2 レビューを独立した担当へ同時に依頼する。レビュー担当にはコードを変更させず、根拠となる file / line、発生条件、影響、推奨対応の指摘だけを返させる。並列機能を利用できない場合は、同じ 2 観点を混ぜずに順番に自己レビューする。

### バグ・安全性レビュー

実際に到達可能な経路を追い、例外、null / undefined、空データ、境界値、破損ファイル、キャンセル、同時実行、競合、デッドロック、listener / child / file のリーク、クラッシュ、性能劣化、既存機能破壊を確認する。特に Rust / Python の cleanup、pending request、atomic file 更新、path validation、RenderSpec mirror、timeline の重なりを確認する。

### 仕様・テストレビュー

元要求、要求漏れ、仕様と異なる動作、勝手に追加した挙動、UX、旧 `.vfocus` と設定の互換性、preview / export 差異、Free / Creator 差異、test 不足を確認する。test が実装と同じ誤解を固定していないか、失敗前にも通る test でないか、mock / browser demo だけでは見えない手動確認がないかを確認する。

## 9. レビュー結果の処理

実装担当は各指摘をコードと再現条件で検証し、次のいずれかに分類する。

- 修正が必要
- 一部だけ正しい
- 修正不要
- 判断には追加情報が必要

明確に正しく、元要求の範囲内に収まる指摘は修正し、該当 regression test を追加して再 test する。一部だけ正しい場合は有効部分だけを最小変更で直す。誤検知は根拠を記録して直さない。仕様変更、大規模な再設計、互換性破壊、release policy 変更になる指摘は勝手に修正せず、影響と選択肢をユーザーへ報告する。

## 10. 実装完了の定義

次が済むまで「完了」と報告しない。

- 要求された実装が行われている。
- 関連 test が追加または更新されている。追加不要なら理由を説明できる。
- 実行可能な test と build を実施し、結果を確認している。
- バグ・安全性レビューと仕様・テストレビューを完了している。
- 有効な指摘を修正し、修正後の test を再実行している。
- 未実施の実機確認、未確認事項、残存リスクを整理している。

## 11. 最終報告の形式

最終報告は簡潔に、次を事実ベースで記載する。

- 実装した内容
- 変更した主要 file
- 実行した test / build command と結果
- 2 レビューで発見し、修正した問題
- 実行できなかった確認と理由
- 残っているリスク
- ユーザーによる手動確認が必要な項目

test 未実施、条件付き test の早期 return、browser demo のみ、実メディアなし、GPU 未確認を「成功」「確認済み」に含めない。
