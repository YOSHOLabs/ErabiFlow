import assert from "node:assert/strict"
import test from "node:test"
import { mixPreviewVolume } from "./previewMixer.ts"

test("プレビューのマスター・チャンネル・素材音量を掛け合わせる", () => {
    assert.ok(Math.abs(mixPreviewVolume(0.5, 0.4, 0.8) - 0.16) < 1e-9)
    assert.equal(mixPreviewVolume(2, -1, Number.NaN), 0)
})
