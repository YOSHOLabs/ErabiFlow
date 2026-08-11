import test from "node:test"
import assert from "node:assert/strict"
import { applyClipTransitions } from "./transitions.ts"
import { DEFAULT_TIMELINE_CLIP_TRANSFORM } from "./types.ts"

test("フェードイン・アウトはクリップ端で不透明度を下げる", () => {
    const middle = applyClipTransitions(DEFAULT_TIMELINE_CLIP_TRANSFORM, { type: "fade", duration: 1 }, { type: "fade", duration: 1 }, 5, 10)
    const edge = applyClipTransitions(DEFAULT_TIMELINE_CLIP_TRANSFORM, { type: "fade", duration: 1 }, undefined, 0.5, 10)
    assert.equal(middle.opacity, 1)
    assert.equal(edge.opacity, 0.5)
})

test("スライドは開始前寄りで画面外から移動する", () => {
    const value = applyClipTransitions(DEFAULT_TIMELINE_CLIP_TRANSFORM, { type: "slide", duration: 1 }, undefined, 0.25, 5)
    assert.equal(value.positionX, -1.5)
})

test("ズームは開始時に寄り、中央で元サイズへ戻る", () => {
    const edge = applyClipTransitions(DEFAULT_TIMELINE_CLIP_TRANSFORM, { type: "zoom", duration: 1 }, undefined, 0, 5)
    const middle = applyClipTransitions(DEFAULT_TIMELINE_CLIP_TRANSFORM, { type: "zoom", duration: 1 }, undefined, 2, 5)
    assert.equal(edge.scale, 1.28)
    assert.equal(middle.scale, 1)
})

test("回転トランジションは端だけ角度を加える", () => {
    const edge = applyClipTransitions(DEFAULT_TIMELINE_CLIP_TRANSFORM, { type: "rotate", duration: 1 }, undefined, 0, 5)
    const middle = applyClipTransitions(DEFAULT_TIMELINE_CLIP_TRANSFORM, { type: "rotate", duration: 1 }, undefined, 2, 5)
    assert.equal(edge.rotation, -18)
    assert.equal(middle.rotation, 0)
})
