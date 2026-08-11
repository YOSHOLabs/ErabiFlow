import assert from "node:assert/strict"
import test from "node:test"
import { applyFilterPreset, FILTER_PRESETS } from "./filterPresets.ts"

test("主要フィルタープリセットを8種類提供する", () => {
    assert.deepEqual(FILTER_PRESETS.map((preset) => preset.label), [
        "シネマ", "フィルム", "レトロ", "モノクロ", "ビンテージ", "クール", "ウォーム", "HDR風",
    ])
})

test("プリセット適用時もユーザーが選んだLUTを維持する", () => {
    const result = applyFilterPreset(FILTER_PRESETS[0], { lutPath: "C:\\looks\\custom.cube" })
    assert.equal(result.contrast, 118)
    assert.equal(result.lutPath, "C:\\looks\\custom.cube")
})
