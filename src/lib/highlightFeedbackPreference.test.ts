import test from "node:test"
import assert from "node:assert/strict"
import { persistHighlightFeedbackEnabled, readHighlightFeedbackEnabled } from "./highlightFeedbackPreference.ts"

test("保存済みの停止設定を読み取る", () => {
    assert.equal(readHighlightFeedbackEnabled(() => "0"), false)
    assert.equal(readHighlightFeedbackEnabled(() => "1"), true)
})

test("localStorage失敗を報告し、呼出側がセッション中の停止状態を維持できる", () => {
    assert.equal(readHighlightFeedbackEnabled(() => { throw new Error("blocked") }), true)
    assert.equal(persistHighlightFeedbackEnabled(false, () => { throw new Error("full") }), false)
})
