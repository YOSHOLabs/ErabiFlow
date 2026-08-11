import test from "node:test"
import assert from "node:assert/strict"
import { activeCaptionRange, splitCaptionChunks } from "./captionEmphasis.ts"

test("日本語字幕を読みやすい短い塊へ分ける", () => {
    assert.deepEqual(splitCaptionChunks("このあと逆転").map((chunk) => chunk.text), ["このあ", "と逆転"])
})

test("再生進捗から現在の強調範囲を返す", () => {
    assert.deepEqual(activeCaptionRange("one two three", 0), { start: 0, end: 4 })
    assert.deepEqual(activeCaptionRange("one two three", 0.99), { start: 8, end: 13 })
})

