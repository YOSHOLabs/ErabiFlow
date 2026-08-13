# Git workflow

## Public repositoryの範囲

`YOSHOLabs/ErabiFlow`はWindows application本体のsource-visible repositoryです。`website/`、private beta資産、配布installer、実動画、外部binary／model、build output、local user dataは含めません。

公開対象には、アプリのソース、lockfile、セットアップ・テスト・監査スクリプト、第三者notice／provenance、外部runtimeを再取得・検証するためのURL／size／SHA-256記録を含めます。

## 履歴

旧ローカル履歴には個人author情報とprivate beta関連履歴があるため、Public remoteへpushしません。監査済みtreeから親commitを持たない新しい公開履歴を作り、GitHub noreply identityを使います。

Public repositoryの最初のpushでは、監査済み`main`だけを通常pushします。`--mirror`、`--all`、旧tag、旧refs、旧`.git`のコピーは禁止です。公開用repositoryは別フォルダに作り、さらに別フォルダへclean cloneして検証します。

## 通常の変更

機能変更は関連testが通る単位でcommitします。秘密、個人情報、動画、生成物を履歴へ追加しません。依存やvendored資産を更新する場合はlockfile、hash、license notice、provenanceを同じPull Requestで更新します。

GitHubへのpush、repositoryのPublic化、Release作成は、それぞれ明示的な承認を得てから行います。
