# GitHub Public公開手順

対象は`YOSHOLabs/ErabiFlow`のソースリポジトリです。一般ユーザー向けMSI、EULA、Webサイト、GitHub Releaseの公開可否は別に判定します。

## 公開対象

- アプリ本体のTypeScript／Rust／Pythonソースとテスト
- 再現可能なセットアップ・監査・build補助
- lockfileと固定toolchain情報
- 第三者notice、provenance、取得元URL／size／SHA-256
- YOSHOLabsの非OSSソースコード権利表記

次は含めません: `website/`、private beta資産／URL／metadata、MSI、release artifact、テスト／ユーザー動画、AI model、FFmpeg等の再取得可能なbinary、Node／Rust／Python生成物、secret／key／certificate、IDE／local環境、recovery／feedback。

## 履歴の作成

1. 旧repositoryと`.git`はローカルbackupとしてそのまま残す。
2. 監査済み公開対象だけを新しい空folderへcopyする。
3. 新しいGit repositoryを`main`で初期化し、author／committerへGitHub noreply identityを設定する。
4. 全ファイルを1つの親なしcommitとして記録する。
5. `origin`は`https://github.com/YOSHOLabs/ErabiFlow.git`にするが、GO判定前はfetch／pushしない。
6. 旧tag、`refs/codex`、reflog、unreachable object、旧`.git`をcopyしない。

## clean clone検証

```powershell
npm ci
npm run setup:dev -- -SkipNpm
npm test
npm run build
npm run test:e2e
npm run test:e2e:release
npm run audit:dependencies
npm run audit:licenses
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
.\.venv\Scripts\python.exe -m unittest discover -s python-sidecar\tests -p "test_*.py"
npm run build:sidecar
npm run check:repo -- -InitialPublication
```

加えて、gitleaksで公開予定の全履歴を走査し、個人email、Windows user名、絶対local path、private URL／情報、key／certificate、巨大file、unexpected Git refs／tag／objectを独立に検査します。

## 停止条件

GO判定前にGitHub repository作成、push、Public化、Release作成、MSI／Webサイト公開を行いません。GOになっても最初のpush直前に、owner/repository、branch、commit、tree hash、scan・test結果を報告して停止します。
