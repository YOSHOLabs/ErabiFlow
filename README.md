# TateClip

TateClipは、長時間動画を解析し、見どころ・盛り上がり・不要部分の判断を支援するWindows向けの動画解析・編集支援ツールです。横動画と縦動画の両方を扱い、編集者自身が必要な区間を選択して、任意尺のラフカットを次の動画編集ソフトへ渡せます。

TateClipは動画編集ソフトでも、AIが完成動画を完全自動編集するアプリでもありません。AIは候補と判断根拠を提示し、人がKEEP／没、IN／OUT、順番を決めます。演出、カラー、合成、最終仕上げはPremiere ProやDaVinci Resolveなどへ任せます。

## 主なワークフロー

1. **見どころを見つける**: ローカル解析で候補と根拠を作り、KEEP／没を判断する
2. **ラフカットを決める**: KEEP区間の開始・終了、分割、順番を人が調整する
3. **受け渡す**: 元画角のラフカット動画とJSON／CSV／CMX 3600 EDL／SRTを出力する

現在の主な機能:

- 横・縦・正方形の動画と任意の完成尺
- 音声、字幕、反応、イベント等を使った見どころ候補と判断根拠
- 候補のKEEP／没と判断状態のプロジェクト保存
- 区間の開始・終了調整、分割、並べ替え
- 元画角を維持したラフカット動画
- NLE向けCMX 3600 EDL、汎用JSON／CSV、ラフカット時間軸のSRT
- 端末内での動画・音声・字幕処理

設計判断は[製品戦略](docs/PRODUCT_STRATEGY_2026.md)、[アーキテクチャ](docs/ARCHITECTURE_V2.md)、[既知の制限](docs/KNOWN_LIMITATIONS.md)を参照してください。

## 技術構成

- UI: React 19、TypeScript、Vite、Tailwind CSS 4
- Desktop: Tauri 2、Rust、Tokio
- State: Zustand、Immer、zundo
- Media: FFmpeg、ffprobe、whisper.cpp
- Local analysis sidecar: Python、PyInstaller、JSON Lines IPC
- Vision: MediaPipe Tasks Vision
- Tests: Node.js test runner、Playwright、Rust unit tests、Python unittest

## 開発環境

対象はWindowsです。基準環境は次のとおりです。

- Windows 11 / PowerShell 7
- Node.js 24.13.x / npm 11.x（`.nvmrc`、`package.json`）
- Rust 1.93.0（`rust-toolchain.toml`）
- Python 3.13.x
- Visual Studio 2022 Build Tools「C++によるデスクトップ開発」とWindows SDK
- Microsoft Edge WebView2 Runtime

```powershell
git clone https://github.com/YOSHOLabs/TateClip.git
cd TateClip
npm run setup:dev
npm run tauri dev
```

`setup:dev`はnpm依存、ハッシュ固定済みPython依存、分離した監査環境、固定版whisper.cpp CPUランタイム、Silero VADモデルを準備します。取得物と生成物はGit管理対象外です。

手動セットアップ:

```powershell
npm ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --require-hashes -r python-sidecar\requirements.txt
pwsh -NoProfile -File scripts\bootstrap_dev.ps1 -SkipNpm -SkipPython
```

開発起動ではFFmpegをリポジトリへ同梱しません。初回利用時に`release/ffmpeg-source.json`で固定した配布元から取得し、サイズとSHA-256を検証します。Whisperモデルも必要時に取得します。動画、音声、字幕を解析のために外部サービスへ送信しません。

フロントエンドだけを確認する場合:

```powershell
npm run dev
```

`http://127.0.0.1:1420/?demo=1`はサンプル編集状態、`?demo=review`は候補レビュー状態です。ブラウザdemoはTauri IPC、実FFmpeg、Python sidecarの動作確認にはなりません。

## 検証

```powershell
npm test
npm run build
npm run test:e2e
npm run test:e2e:release
npm run audit:dependencies
npm run audit:licenses
cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri\Cargo.toml
.\.venv\Scripts\python.exe -m unittest discover -s python-sidecar\tests -p "test_*.py"
npm run check:repo -- -AllowDirty
```

Python sidecarの配布用生成まで確認する場合は`npm run build:sidecar`を実行します。軽量Windowsビルドのソースは`build_release_lite.bat`にありますが、更新署名鍵とパスワードはリポジトリ外の入力です。生成されるEXE／MSIはGitへ追加しません。

実動画、GPU別経路、署名済みMSI、clean Windows PCでのinstall/uninstallは環境依存の手動確認です。ソースのGitHub公開判定と一般ユーザー向けバイナリ配布判定は分離します。

## 主なディレクトリ

```text
src/                    React UI、状態管理、純粋ロジック、Canvas preview
src-tauri/              Rust/Tauri、FFmpeg、path security、runtime取得
python-sidecar/         ローカル解析daemonとpipeline
e2e/                    アプリのブラウザdemo E2E
e2e-release/            production frontend表示のE2E
scripts/                setup、監査、desktop build補助
release/                外部runtimeの固定URL・size・SHA-256等の公開情報
docs/                   アーキテクチャ、製品方針、provenance
```

公開リポジトリにはWebサイト、private beta資産、インストーラー、テスト／ユーザー動画、FFmpeg、Whisperモデル、Python／Node／Rustの生成物、鍵、証明書、recovery／feedbackデータを含めません。

## 第三者コンポーネント

第三者ライブラリ、WASM、モデル、外部runtimeはそれぞれのライセンスに従います。直接追跡するMediaPipe資産と取得時runtimeの出所・hashは[THIRD_PARTY_PROVENANCE](docs/THIRD_PARTY_PROVENANCE.md)、通知本文は[src-tauri/resources/THIRD_PARTY_NOTICES.txt](src-tauri/resources/THIRD_PARTY_NOTICES.txt)を参照してください。

依存license一覧は正確なlockfileとインストール環境から`npm run licenses:bundle`で生成し、配布ビルドへ含めます。生成ファイル自体はGit管理しません。

## ソースコードの権利

Copyright © 2026 YOSHOLabs. All Rights Reserved.

このPublic repositoryはポートフォリオ、技術確認、セキュリティレビュー、評価のためにソースを閲覧可能にするものです。TateClip本体はOSSではなく、MIT／GPL／Apache等では提供していません。限定されたローカル評価権と禁止事項は[LICENSE](LICENSE)を確認してください。第三者コンポーネントには各元ライセンスが別に適用されます。

将来一般配布するTateClipアプリの利用条件やEULAは、GitHub上のソースコードの権利条件とは分離して整備します。

## セキュリティとコントリビューション

- 脆弱性報告: [SECURITY.md](SECURITY.md)
- 開発とPull Request: [CONTRIBUTING.md](CONTRIBUTING.md)
- ブランド資産: [TRADEMARKS.md](TRADEMARKS.md)
- Public公開手順: [docs/PUBLIC_REPOSITORY_RELEASE.md](docs/PUBLIC_REPOSITORY_RELEASE.md)
