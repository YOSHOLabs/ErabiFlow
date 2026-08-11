import test from "node:test"
import assert from "node:assert/strict"
import { copyTrackClipGroup, createEditorTrack, createTrackMediaClip, pasteTrackClipGroup, updateTrackClipTiming } from "./multiTrack.ts"
import type { EditorTrack, TrackMediaClip } from "./types.ts"

const videoTrack: EditorTrack = { id: "v2", kind: "video", name: "V2", locked: false, hidden: false, muted: false }

test("素材を再生ヘッド位置から追加トラックへ配置する", () => {
    const track = createEditorTrack("video", [])
    assert.equal(track.name, "V2")
    const clip = createTrackMediaClip({
        id: "asset", kind: "video", path: "C:\\clips\\b.mp4", name: "b.mp4", folderId: null,
        favorite: false, addedAt: "2026-07-27T00:00:00Z", duration: 8, hasAudio: true,
    }, track, 3, 10)
    assert.equal(clip?.timelineStart, 3)
    assert.equal(clip?.timelineEnd, 10)
    assert.equal(clip?.sourceEnd, 7)
})

test("グループ移動は全クリップの相対位置を保つ", () => {
    const clips = [
        { id: "one", trackId: "v2", timelineStart: 1, timelineEnd: 3, groupId: "g" },
        { id: "two", trackId: "a2", timelineStart: 2, timelineEnd: 4, groupId: "g" },
    ].map((clip) => ({
        ...clip, assetId: clip.id, path: `${clip.id}.mp4`, kind: clip.trackId === "v2" ? "video" : "audio",
        label: clip.id, sourceStart: 0, sourceEnd: 2, volume: 1, muted: false, hasAudio: true,
        transform: { positionX: 0, positionY: 0, scale: 1, rotation: 0, flipHorizontal: false, flipVertical: false, opacity: 1 },
    })) as TrackMediaClip[]
    const moved = updateTrackClipTiming(clips, "one", 5, 7)
    assert.deepEqual(moved.map((clip) => [clip.timelineStart, clip.timelineEnd]), [[5, 7], [6, 8]])
})

test("グループのコピー貼り付けは新しいIDと相対配置を作る", () => {
    const clip = createTrackMediaClip({
        id: "asset", kind: "video", path: "b.mp4", name: "b", folderId: null, favorite: false,
        addedAt: "2026-07-27T00:00:00Z", duration: 3,
    }, videoTrack, 2, 20)!
    clip.groupId = "old"
    const peer = { ...clip, id: "peer", trackId: "v3", timelineStart: 4, timelineEnd: 7 }
    const copied = copyTrackClipGroup([clip, peer], clip.id)
    const pasted = pasteTrackClipGroup(copied, 10)
    assert.deepEqual(pasted.map((item) => item.timelineStart), [10, 12])
    assert.notEqual(pasted[0].id, clip.id)
    assert.equal(pasted[0].groupId, pasted[1].groupId)
    assert.notEqual(pasted[0].groupId, "old")
})
