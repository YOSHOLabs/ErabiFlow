# TateClip アーキテクチャ方針 v2

## 方針

全面刷新は、動いている低層を捨てることではなく、製品の責務と導線を作り直すことと定義する。FFmpeg実行、パス検証、復旧、ライセンス、Python daemon、RenderSpec互換性には既に障害対応とテストが蓄積されているため維持する。刷新対象は、ユーザーに見える作業モデル、機能の優先順位、UIの情報量である。

```text
React UI: 見どころを見つける → ラフカットを決める → 受け渡す
        ↓
document store / pure domain logic / preview
        ↓
typed Tauri commands
        ↓
Rust: security / recovery / RenderSpec validation / FFmpeg orchestration
        ↓
Python daemon: transcription / signal analysis / highlight draft
```

## ユーザーに見える3工程

### 見どころを見つける

- 入力選択、解析状態、候補比較、KEEP・没を同じ文脈に置く
- AIの詳細設定は初期状態で閉じ、必要時だけ開く
- AI結果は編集可能な初稿であり、完成品として扱わない

### ラフカットを決める

- 元動画の画角を保つプレビュー、KEEPタイムライン、区間設定だけを常設する
- 既定面はIN／OUT、分割、没、順番に絞り、合成、素材追加、LUT、エフェクト、キーフレームは主導線から外す
- 永続的な編集内容は`useDocumentStore`、再生・選択・表示状態はeditor storeに置く
- pureな時間計算、正規化、RenderSpec変換は`src/lib`に置く

### 受け渡す

- 横・縦・任意尺のラフカット動画、preflight、NLE受け渡しを主役にする
- `src/lib/roughCut.ts`を正本にJSON、CSV、CMX 3600 EDL、SRTを生成する
- `source` layoutは装飾レイヤーを焼き込まず、RustがKEEP区間だけを元画角で連結する

## 維持する境界

- Tauri呼び出し名と引数は`src/tauri/commands.ts`に集約する
- OS、パス、Creator権限、出力ファイルの最終検証はRustで行う
- Python stdoutはJSON Lines IPC専用、ログはstderrへ出す
- Canvas previewとFFmpeg exportは`source` layoutで装飾を表示・出力せず、同じKEEP sequenceを共有する
- 外部プロセス、listener、temp file、cancel flagのcleanupを維持する
- 動画配信はallowlistとrange対応の`vfocus` protocolを使い、全読み込みへ戻さない

## 内部モジュールの責務

依存方向を次の一方向に固定する。UI、OS、FFmpeg、Pythonの型をpure logicへ逆流させない。

| 層 | 主な場所 | 責務 |
| --- | --- | --- |
| Presentation | `src/components`, `src/features` | 表示、入力、3工程の段階的開示 |
| Application state | `src/stores`, `src/controllers` | document更新、job lifecycle、undo/redo |
| Domain | `src/lib` | timeline、preflight、RenderSpec、migration、正規化 |
| Desktop adapter | `src/tauri/commands.ts`, `src-tauri/src/commands` | 型付きIPC、OS検証、use case起動 |
| Render adapter | `src-tauri/src/ffmpeg` | FFmpeg固有のescaping、式生成、filter graph、runner |
| Analysis adapter | `python-sidecar` | 音声・字幕・映像signalから編集可能な候補draftを生成 |

Rustの動画系は、Tauri command本体から次を分離した。

- `commands/video/probe.rs`: FFmpeg probe出力とdecode progressの解釈
- `commands/video/media_proxy.rs`: managed proxyの命名、検証、staged生成、削除境界
- `ffmpeg/escaping.rs`: filter parser専用のpath escaping
- `ffmpeg/animation.rs`: keyframe、transition、motionのpure expression
- `ffmpeg/clip_effects.rs`: color、visual effect、audio effectのpure filter fragment
- `ffmpeg/builder.rs`: 入力streamを上記fragmentへ配線するcompositor

Pythonでは`highlight_signal_math.py`をscorerから分離し、中央値/MAD、時間窓、range抽出をpipeline stateを持たないpure functionにした。`HighlightScorer`は文字起こし・音声signalの意味付けと候補policyに集中する。

Tauri command名、TypeScript引数、RenderSpec、Python JSONL protocolはこの分割で変更しない。内部file配置を外部互換性から切り離す。

## 今回削除した責務

- 独立した「投稿設計」作業空間
- アプリ内の収益枠と表示・クリック集計
- UIへ常設していたトレンドスタジオ
- ヘッダーのGPUバッジ

投稿プラットフォーム、説明文、CTA、ハッシュタグ、権利確認、装飾、追加トラックのdocument fieldは、旧`.vfocus`との互換性のため残すが、新しい主UIとラフカットpreflightでは使用しない。完全に削除する場合は、schema migration、allowlist、RenderSpec、旧fixtureを一組で変更する。

`verticalTrends`と旧compositorは旧プロジェクト互換のため残る。新規documentの`game.layoutMode`は`source`である。旧projectのレイアウト値は読み込み時に維持し、ユーザーが書き出し画面で明示的にラフカットへ切り替えた時だけ`source`へ移る。

## 残る移行単位

大きなファイルを機械的に分割するのではなく、変更頻度と障害境界で分ける。

1. Rustの`video.rs`に残るPNG連番transactionと通常output transactionを、同じcommit/rollback testを保ったまま専用moduleへ移す
2. FFmpeg builderのcompositorをmain sequence、追加video track、audio mix、overlayへ分け、最終graphだけをbuilderで接続する
3. Python highlight scorerのcandidate生成、ranking、deduplicationをpolicy moduleへ移す
4. project schemaの旧version fixtureを増やしてから、互換用の投稿設計fieldを将来schemaで廃止するか判断する

分割は個別の振る舞いを固定するregression testを先に追加し、外部protocolを変えずに行う。

## 互換性と事実上の制約

- 実装上の`.vfocus` current schemaは`src/lib/project.ts`のv15である
- TypeScriptはRenderSpec v2を生成し、Rustはv1/v2を受理する
- LUTはexport側が正確で、生成particleはCanvasとFFmpegで完全一致しない
- export即時cancelは確認できておらず、Creator batch停止は現在item完了後である
- GPU、実メディア、2 GiB超ファイル、disk full、権限不足は自動テストだけでは確認できない

## 完了条件

新しい機能は「3工程のどこでユーザーの時間または失敗を減らすか」を説明できる場合だけ追加する。説明できない常設パネル、宣伝枠、重複設定、流行だけを根拠にしたテンプレートは追加しない。
