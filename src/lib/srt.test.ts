import assert from "node:assert/strict"
import test from "node:test"
import { assignSpeakerLabels, createSrt, parseSrt } from "./srt.ts"

test("SRTを読み書きして話者ラベルを保持する", () => {
    const parsed = parseSrt("1\n00:00:01,000 --> 00:00:02,500\n[話者 1] こんにちは\n")
    assert.equal(parsed[0].speaker, "話者 1")
    assert.match(createSrt(parsed), /00:00:01,000 --> 00:00:02,500/)
})

test("音声トラック番号から話者を分離する", () => {
    const labeled = assignSpeakerLabels([{ id: "a", text: "a", start: 0, end: 1, sourceTrack: 2 }])
    assert.equal(labeled[0].speaker, "話者 3")
})
