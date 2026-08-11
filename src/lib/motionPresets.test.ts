import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { applyMotionPreset } from "./motionPresets.ts"
import { DEFAULT_TIMELINE_CLIP_TRANSFORM } from "./types.ts"

describe("motion presets", () => {
    it("applies swing, bounce, and pop without mutating the base transform", () => {
        const base = { ...DEFAULT_TIMELINE_CLIP_TRANSFORM }
        assert.notEqual(applyMotionPreset(base, "swing", 0.15).rotation, base.rotation)
        assert.ok(applyMotionPreset(base, "bounce", 0.2).positionY < base.positionY)
        assert.ok(applyMotionPreset(base, "pop", 0).scale > base.scale)
        assert.deepEqual(base, DEFAULT_TIMELINE_CLIP_TRANSFORM)
    })
})
