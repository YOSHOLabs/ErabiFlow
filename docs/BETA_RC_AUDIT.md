# Beta 0.1.0 候補の監査記録

2026-09-10/11調査。公開・tag・MSI uploadは未実施。

| 対象 | 分類 | 判断 |
| --- | --- | --- |
| remote main ea89f365ba8ec79ef58fb165b7de4aee10b51499 | current | 今回fetchで確認。CI 33240235713成功 |
| 元local main a90a07aと未commit/untracked | local only / stale | 公開mainより古い別系統。変更を保全 |
| codex/general-release 7ec90eaと未commit修正 | reusable / local only | 最新mainへ3-way適用。元worktreeは保全 |
| .codex-tmpの旧MSI・過去smoke/audit・checksum | generated only / stale / must rebuild | 現候補の成功根拠や配布物に使わない |
| 今回codex/beta-0.1.0 | current | 最新main基点で候補を一本化 |
| stash・tag | current | 調査時点でなし |
| Release・通常Issue | current | 調査時点でなし |
| README・Windows・Privacy・EULA・Release Notes | reusable | Beta向け改訂。EULAの事業判断は別記 |
| third-party notices | reusable / must rebuild | manifest照合、最終環境から通知を再生成 |
| portfolio画像 | reusable | サンプルデータ表示。再撮影し実解析証拠と区別 |

AGENTS.mdとコードの差異: daemonのcache versionは15（指示文の14より新しい）。eslint.config.mjsは現在の公開mainに存在しない。実行コードを優先する。

## GitHubとDependabot

secret scanning / push protection / Private Vulnerability Reportingは有効。Dependabot security updatesは無効。設定は変更していない。

PR #27 npm、#28 Cargo、#29 Pythonはいずれも **DEFER UNTIL AFTER BETA**。現依存の監査で未解決の脆弱性はなく、グループ更新全体を取り込む根拠はない。3 PRのCIは調査時点で失敗。merge/close/commentは行っていない。

npmのbrowserslist・baseline-browser-mappingの脆弱性は必要な推移依存を含む最小更新で解消。Rust auditの不要な許可10項目を削除し、未知の警告を追加許可していない。残る11項目は既存の保守終了等通知で、脆弱性0とは区別する。

## レビュー対応

独立したバグ・安全性、仕様・テストの2レビューを実施。

- checksum生成先とcheck:light参照先の不一致: 修正が必要。MSI横のSHA256SUMS.txtへ統一。
- Release NotesのBeta表記とリンク不足: 修正が必要。一般ユーザー向けに更新。
- windowed daemonのIPC: 追加情報が必要。今回生成したdaemonでboot / health / shutdownのJSONL応答を実測。MSI組込み後の再起動は別途検証する。
- 日本語パスの実解析失敗: 修正が必要。Windows既定文字コードでUTF-8入力を誤読していた。stdinをUTF-8に固定し、CP932環境で失敗する回帰testを追加。

Node/Python/Rust unit、ブラウザdemo、配布frontendの成功はMSI・実動画・実NLE・別PC確認の代替ではない。Rustの条件付きtestは環境変数なしで早期returnする。source rough cut testは実動画と公式FFmpegを指定して別途実行した。effects/tracksの条件付きtestは素材未指定で、実メディア成功に含めない。

EULAの判断は[BETA_LAUNCH.md](BETA_LAUNCH.md)、別PC/NLE手順は[BETA_MANUAL_RELEASE_TEST.md](BETA_MANUAL_RELEASE_TEST.md)を参照。最終SHA・MSI・検証ログは候補記録と併せて管理する。
