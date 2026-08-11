# Preview / Export rendering contract

描画能力の機械可読な正本は `src/lib/renderCapabilities.json` とする。新しいカラー補正、トランジション、映像・音声エフェクト、特殊再生を追加するときは、Canvas / HTML mediaプレビューとFFmpeg書き出しの実装と同時にこの表を更新する。

- `exact`: そのレンダラーにおける正本。最終成果物はFFmpeg側を正本とする。
- `approximate`: 機能は確認できるが、Canvas APIとFFmpeg filterの違いによる見た目の差を許容する。
- `unsupported`: 意図的に適用しない。現在はLUT、音声補正、高度な追加トラック音声のプレビューが該当する。

TypeScript testは全fieldとプレビュー実装根拠を照合し、Rust testは同じJSONを読み、各effectから期待するFFmpeg filterが生成され、完成filter graphへ接続されることを確認する。生成パーティクル、ノイズ、天候、グロー、色処理などはアルゴリズムが異なるため、同一フレームのpixel一致を保証しない。LUTを含む最終判断は短い実メディアを書き出して行う。
