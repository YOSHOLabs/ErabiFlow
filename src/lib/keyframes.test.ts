import test from "node:test"
import assert from "node:assert/strict"
import { evaluateKeyframeValue, upsertKeyframes } from "./keyframes.ts"

test("キーフレーム間を線形補間し最後の値を保持する", () => {
    const keyframes = upsertKeyframes([], 1, { scale: 1.5 })
    const next = upsertKeyframes(keyframes, 3, { scale: 2.5 })
    assert.equal(evaluateKeyframeValue(next, "scale", 1, 0.5), 1.25)
    assert.equal(evaluateKeyframeValue(next, "scale", 1, 2), 2)
    assert.equal(evaluateKeyframeValue(next, "scale", 1, 5), 2.5)
})

test("ホールド補間は次のキーフレームまで直前値を保つ", () => {
    const keyframes = upsertKeyframes([], 0, { opacity: 0.2 })
    const next = upsertKeyframes(keyframes, 2, { opacity: 1 }, "hold")
    assert.equal(evaluateKeyframeValue(next, "opacity", 1, 1), 0.2)
    assert.equal(evaluateKeyframeValue(next, "opacity", 1, 2), 0.2)
})

test("キーフレーム値と基準値をプロパティごとの安全範囲へ収める", () => {
    const keyframes = upsertKeyframes([], 0, {
        scale: 0,
        opacity: 99,
        positionX: -5,
        volume: Number.NaN,
    })

    assert.equal(evaluateKeyframeValue(keyframes, "scale", 0, 0), 0.1)
    assert.equal(evaluateKeyframeValue(keyframes, "opacity", 0, 0), 1)
    assert.equal(evaluateKeyframeValue(keyframes, "positionX", 0, 0), -1)
    assert.equal(evaluateKeyframeValue(keyframes, "volume", 1, 0), 0)
    assert.equal(evaluateKeyframeValue([], "scale", 0, 0), 0.1)
})
