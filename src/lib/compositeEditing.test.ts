import assert from "node:assert/strict"
import test from "node:test"
import {
    applyClipVisualAction,
    applyCompositePlacement,
    createCompositeVideoClip,
} from "./compositeEditing.ts"
import { DEFAULT_TIMELINE_CLIP_TRANSFORM } from "./types.ts"
import type { MediaAsset, TrackMediaClip } from "./types.ts"

const trackClip: TrackMediaClip = {
    id: "face", trackId: "v2", assetId: "camera", path: "camera.mp4", kind: "video", label: "camera.mp4",
    timelineStart: 0, timelineEnd: 10, sourceStart: 0, sourceEnd: 10,
    volume: 1, muted: false, hasAudio: true, transform: { ...DEFAULT_TIMELINE_CLIP_TRANSFORM },
}

test("V2 clips can be moved independently between face-cam and cutaway layouts", () => {
    const upperLeft = applyCompositePlacement(trackClip, "top-left")
    assert.ok(upperLeft.transform.positionX < 0)
    assert.ok(upperLeft.transform.positionY < 0)
    assert.ok(upperLeft.transform.scale < 0.5)

    const cutaway = applyCompositePlacement(upperLeft, "fullscreen")
    assert.equal(cutaway.transform.positionX, 0)
    assert.equal(cutaway.transform.positionY, 0)
    assert.equal(cutaway.transform.scale, 1)
    assert.equal(cutaway.effects?.mask.shape, "none")
})

test("ellipse placement is an editable feathered mask", () => {
    const result = applyCompositePlacement(trackClip, "ellipse")
    assert.equal(result.effects?.mask.shape, "ellipse")
    assert.equal(result.effects?.mask.feather, 3)
    assert.ok(result.transform.scale > 0.75)
})

test("a video asset becomes a timed and optionally muted V2 clip", () => {
    const asset: MediaAsset = {
        id: "asset", kind: "video", path: "face.mp4", name: "face.mp4", folderId: null,
        favorite: false, addedAt: "2026-07-27T00:00:00Z", duration: 4, hasAudio: true,
    }
    const clip = createCompositeVideoClip(asset, "v2", {
        timelineStart: 3,
        duration: 8,
        placement: "top-right",
        includeAudio: false,
    }, () => "generated")
    assert.equal(clip?.id, "generated")
    assert.equal(clip?.timelineStart, 3)
    assert.equal(clip?.timelineEnd, 7)
    assert.equal(clip?.muted, true)
})

test("visual actions are independent editable clip properties", () => {
    const source = { id: "main", mediaStart: 0, mediaEnd: 2 }
    const punched = applyClipVisualAction(source, "punch")
    assert.equal(punched.keyframes?.filter((keyframe) => keyframe.property === "scale").length, 2)
    const impact = applyClipVisualAction(source, "impact")
    assert.ok((impact.effects?.shake ?? 0) >= 18)
    const monochrome = applyClipVisualAction(source, "monochrome")
    assert.equal(monochrome.color?.saturation, 0)
})
