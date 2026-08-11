import test from "node:test"
import assert from "node:assert/strict"
import { findActiveSubtitle } from "./subtitleTiming.ts"

test("現在時刻に一致する字幕を返す", () => {
    const subtitles = [
        { id: "a", text: "最初", start: 1, end: 2 },
        { id: "b", text: "次", start: 3, end: 4 },
    ]
    assert.equal(findActiveSubtitle(subtitles, 1.5)?.id, "a")
    assert.equal(findActiveSubtitle(subtitles, 2.5), undefined)
})

test("字幕区間が重なった場合は新しく始まった発話を優先する", () => {
    const subtitles = [
        { id: "old", text: "長く残った字幕", start: 10, end: 18 },
        { id: "new", text: "次の発話", start: 13, end: 15 },
    ]
    assert.equal(findActiveSubtitle(subtitles, 13.2)?.id, "new")
})
