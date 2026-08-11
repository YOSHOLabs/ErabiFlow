import test from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_SUBTITLE_STYLE } from "./types.ts"
import { createSubtitleStyleOverride, resolveSubtitleStyle } from "./subtitleStyle.ts"

test("字幕個別設定は全体設定を上書きする", () => {
    const resolved = resolveSubtitleStyle(DEFAULT_SUBTITLE_STYLE, {
        styleOverride: { color: "#FF0000", size: 72, positionY: 0.64 },
    })

    assert.equal(resolved.color, "#FF0000")
    assert.equal(resolved.size, 72)
    assert.equal(resolved.positionY, 0.64)
    assert.equal(resolved.strokeWidth, DEFAULT_SUBTITLE_STYLE.strokeWidth)
})

test("個別編集開始時は書き出し対応の外観を複製する", () => {
    const override = createSubtitleStyleOverride({
        ...DEFAULT_SUBTITLE_STYLE,
        color: "#22D3EE",
        emphasisMode: "karaoke",
    })

    assert.equal(override.color, "#22D3EE")
    assert.equal(override.emphasisMode, "karaoke")
    assert.equal(override.font, DEFAULT_SUBTITLE_STYLE.font)
})
