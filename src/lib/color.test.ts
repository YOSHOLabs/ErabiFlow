import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { colorToCanvasFilter, getClipColor } from "./color.ts"
import { DEFAULT_CLIP_COLOR } from "./types.ts"

describe("clip color", () => {
    it("fills defaults and clamps unsafe values", () => {
        assert.deepEqual(getClipColor({ brightness: 120, contrast: -1 }), { ...DEFAULT_CLIP_COLOR, brightness: 100, contrast: 0 })
    })

    it("builds a canvas filter", () => {
        const filter = colorToCanvasFilter({ brightness: 10, contrast: 120, saturation: 80, temperature: 50 })
        assert.match(filter, /brightness\(110\.0%\)/)
        assert.match(filter, /contrast\(120\.0%\)/)
        assert.match(filter, /saturate\(80\.0%\)/)
    })

    it("clamps advanced tone, HSL, and curve controls", () => {
        const color = getClipColor({ tint: 200, hue: -300, highlights: 150, curveMidtones: -120 })
        assert.equal(color.tint, 100)
        assert.equal(color.hue, -180)
        assert.equal(color.highlights, 100)
        assert.equal(color.curveMidtones, -100)
    })
})
