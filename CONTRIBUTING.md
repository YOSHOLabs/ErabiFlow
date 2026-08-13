# ErabiFlowへのコントリビューション

ErabiFlowは、AIに完成動画を任せるのではなく、人が見どころと不要部分を判断し、既存の動画編集ソフトへ正確に渡すことを優先します。

## 開発環境

Windows 11、PowerShell 7、Visual Studio 2022 Build Toolsが必要です。基準版と初回セットアップはREADMEを参照してください。

```powershell
npm run setup:dev
npm run tauri dev
```

## 変更の進め方

1. Issueで不具合または変更目的を確認する。
2. 永続データはdocument store、一時UI状態はeditor storeへ置く。
3. 計算、正規化、検証は可能な限り`src/lib`の純粋関数にする。
4. Tauri境界を変える場合はTypeScriptとRustを同時に更新する。
5. Canvas previewとFFmpeg出力の意味を一致させる。
6. 再現テストまたは回帰テストを追加する。

## Pull Request前の確認

```powershell
npm ci
npm test
npm run build
npm run test:e2e
npm run test:e2e:release
npm run audit:dependencies
npm run audit:licenses
cargo test --manifest-path src-tauri\Cargo.toml
cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings
.\.venv\Scripts\python.exe -m unittest discover -s python-sidecar\tests -p "test_*.py"
npm run check:repo -- -AllowDirty
```

実動画、GPU、MSI、clean Windows PCが必要な確認は、実施項目と未確認項目をPull Requestへ明記してください。ブラウザdemoだけでTauri、FFmpeg、Python daemonの実動作を確認済みとは扱いません。

## セキュリティとプライバシー

- 動画、字幕、絶対パス、ライセンスキー、秘密鍵をIssueやログへ貼らないでください。
- `.vfocus`、`.vflicense`、MSI、モデル、FFmpeg、テスト動画、生成物をコミットしないでください。
- セキュリティ問題は公開Issueではなく`SECURITY.md`の方法で報告してください。

## 提出物の権利

ErabiFlow本体はOSSではありません。Pull Requestを提出する人は、その変更を提出する権利があることを表明し、採用された変更についてYOSHOLabsへ、使用、複製、変更、配布、サブライセンスおよび別条件での提供に必要な、永続的、世界的、非独占的、無償、取消不能な権利を許諾するものとします。

第三者のコード、画像、音声、モデルを含める場合は、出所、ライセンス、変更内容をPull Requestへ記載してください。提出前に[LICENSE](LICENSE)も確認してください。
