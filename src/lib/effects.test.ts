import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { effectsToCanvasFilter, getClipEffects } from "./effects.ts"

describe("clip effects", () => {
    it("clamps blur and mosaic", () => {
        assert.equal(getClipEffects({ blur: 90, mosaic: -4 }).blur, 50)
        assert.equal(getClipEffects({ blur: 90, mosaic: -4 }).mosaic, 0)
    })
    it("creates a blur preview filter", () => assert.match(effectsToCanvasFilter({ blur: 10 }), /blur\(4.5px\)/))
    it("clamps advanced effect strengths and builds combined preview filters", () => {
        const effects = getClipEffects({ motionBlur: 200, chromaticAberration: -1, film: 50, sharpen: 40 })
        assert.equal(effects.motionBlur, 100)
        assert.equal(effects.chromaticAberration, 0)
        assert.match(effectsToCanvasFilter(effects), /sepia/)
        assert.match(effectsToCanvasFilter(effects), /contrast/)
    })
})
