import assert from "node:assert/strict"
import test from "node:test"
import { TEXT_STYLE_PRESETS } from "./textPresets.ts"

test("タイトルと字幕で共用できる6種類のプリセットを提供する", () => {
    assert.equal(TEXT_STYLE_PRESETS.length, 6)
    for (const preset of TEXT_STYLE_PRESETS) {
        assert.ok(preset.title.size)
        assert.ok(preset.subtitle.size)
        assert.ok(preset.title.strokeColor)
        assert.ok(preset.subtitle.strokeColor)
    }
})
