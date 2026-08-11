# ハイライト検出の評価

盛り上がり検出の重みやモデルを変更するときは、同じ実動画の正解区間に対して
旧方式と新方式を比較する。隣接区間が学習側と評価側へ分かれないよう、データは
動画単位、可能なら実況者単位で分割する。

新しい4軸融合スコアは、正解データが十分に蓄積するまでは旧スコアを下げない
保守的な上側補正として使う。候補結合の既定は評価済みの`legacy`を維持し、
比較時だけdaemon起動環境の`VFOCUS_HIGHLIGHT_CANDIDATES=peak`で新しい局所ピーク方式を
明示的に有効にする。方式はキャッシュキーにも含まれるため、切替後に新旧結果が混在しない。

## 正解データ

VIAなどのローカル注釈ツールで時間区間を付け、次の最小JSONへ変換する。

```json
{
  "highlights": [
    {
      "video_id": "session-001",
      "start": 125.2,
      "end": 143.8,
      "event_type": "victory",
      "clip_worthy": true
    }
  ]
}
```

`clip_worthy: false` の区間は正解候補から除外される。候補ではない通常区間は、
誤検出分析用の別データとして保持する。
複数動画をまとめる場合は予測側にも同じ`video_id`を付ける。評価は動画内だけで
matchingし、別動画の同じ時刻を一致と数えない。

## 実行

daemonレスポンスの `highlights`、engine出力の `recommendedCuts`、または単純な
配列を予測JSONとして使用できる。

```powershell
.\.venv\Scripts\python.exe python-sidecar\tools\evaluate_highlights.py `
  --predictions .\evaluation\result.json `
  --references .\evaluation\labels.json `
  --top-k 5 10 `
  --iou 0.3
```

比較時はTop-5精度、Top-10再現率、正解ごとの最大IoU、開始・終了境界の平均
絶対誤差に加え、解析時間、最大メモリ、追加モデル容量を記録する。

旧方式と新方式を同じラベルへ当て、既定値変更のゲートまで確認する場合は次を使う。

```powershell
.\.venv\Scripts\python.exe python-sidecar\tools\compare_highlight_runs.py `
  --baseline .\evaluation\legacy.json `
  --candidate .\evaluation\peak.json `
  --references .\evaluation\labels.json `
  --baseline-resources .\evaluation\legacy-resources.json `
  --candidate-resources .\evaluation\peak-resources.json `
  --output .\evaluation\comparison.json
```

resource JSONには`processing_time_sec`、`peak_memory_mb`、`model_bytes`を記録する。
精度、再現率、平均IoU、開始・終了境界が旧方式以上の場合だけrelease gateが成功する。
比較CLIは既定で3動画・正解10区間以上を要求し、満たさない場合は
`insufficient_data`として終了コード2を返す。小規模な開発確認だけ閾値を明示的に下げる。

## アプリ内のローカル編集フィードバック

候補カードの表示・プレビュー・採用・採用解除・却下・復元・長さ調整・一括キュー・
書き出しに加え、候補になかった見どころの手動範囲とカテゴリを、Tauriのapp local data配下にある
`highlight-feedback/events-v1.jsonl`へ追記する。20 MiBを超えると1世代だけ
`events-v1.previous.jsonl`へローテーションするため、保存量は最大約40 MiBである。

記録するのはランダムな解析ID・候補番号・クリップID、操作、候補区間、4軸スコア、
見逃し区間のカテゴリと最寄り候補との時間IoUだけである。動画名、絶対パス、
字幕本文、文字起こし、候補ラベル、選定理由、
書き出し先はTypeScriptのイベント型に存在せず、Rust側も未知fieldを拒否する。
stdoutや外部通信へは送らない。

工程バーの設定アイコンから、記録の停止・再開と全履歴の削除ができる。停止しても
既存履歴は残るため、不要なら別途「履歴を削除」を2回押して削除する。

評価時は次のように扱う。

- `shown`は母数であり、不採用の意味にはしない。
- `previewed`は弱い関心、`adopted`は正例、`exported`は強い正例として集計する。
- `rejected`と、採用後の`unadopted`は負例候補として扱い、後続の`restored`や
  再採用があれば最終判断を更新する。
- `trimmed`と`exported`の`currentRange`は境界補正の教師候補にする。
- `missed`は候補でカバーできなかった正例候補とし、最寄り候補とのIoUが0.3未満なら
  未カバーの見逃しとして数える。
- 境界差分はクリックごとには足さず、候補の最初の`initialRange`と最後の
  `trimmed`または`exported`をcandidate単位で結合して1件だけ数える。
- 少数ユーザーの癖を固定しないよう、重みの自動更新は行わず、解析run単位で分割した
  オフライン評価を通してから既定値を変更する。

保存済みJSONLの採用率・却下率・書き出し到達率・境界修正量は、動画を開かずに
次のローカルCLIで確認できる。

```powershell
.\.venv\Scripts\python.exe python-sidecar\tools\summarize_highlight_feedback.py `
  <app-local-data>\highlight-feedback\events-v1.previous.jsonl `
  <app-local-data>\highlight-feedback\events-v1.jsonl
```
