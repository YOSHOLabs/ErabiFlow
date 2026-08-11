import test from "node:test"
import assert from "node:assert/strict"
import { buildPreviewState } from "../preview/buildPreviewState.ts"

function baseState(previewTime: number) {
    return {
        cw: 540,
        ch: 960,
        video: { readyState: 2, videoWidth: 1920 } as HTMLVideoElement,
        text: {} as any,
        watermark: {} as any,
        subtitleStyle: {} as any,
        avatarImg: null,
        avatar: {} as any,
        game: {} as any,
        subtitles: [],
        previewTime,
        mediaTime: previewTime,
        trimStart: 0,
        dragTarget: null,
        hoveredTarget: null,
        overlayImages: [],
        silenceSegments: [],
        safeZone: null,
    }
}

test("active clipと表示中の追加映像だけをPreviewStateへ投影する", () => {
    const clip = {
        id: "main",
        index: 0,
        sequenceStart: 4,
        duration: 6,
        mediaStart: 10,
        mediaEnd: 16,
    }
    const visibleTrack = {
        id: "visible",
        trackId: "v2",
        assetId: "asset",
        path: "C:\\visible.mp4",
        kind: "video" as const,
        label: "Visible",
        timelineStart: 3,
        timelineEnd: 8,
        sourceStart: 0,
        sourceEnd: 5,
        volume: 1,
        muted: false,
        hasAudio: true,
        transform: {} as any,
    }
    const element = {} as HTMLVideoElement

    const state = buildPreviewState({
        state: baseState(5),
        activeInfo: { clip, clipIdx: 0, clipAccTime: 4, mediaTime: 11 },
        trackSources: [
            { clip: visibleTrack, element, trackOrder: 1, hidden: false },
            { clip: { ...visibleTrack, id: "hidden" }, element, trackOrder: 2, hidden: true },
            { clip: { ...visibleTrack, id: "future", timelineStart: 8, timelineEnd: 10 }, element, trackOrder: 3, hidden: false },
        ],
    })

    assert.equal(state.hasVideo, true)
    assert.equal(state.activeClip?.id, "main")
    assert.equal(state.activeClipLocalTime, 1)
    assert.deepEqual(state.trackVideos.map((item) => item.clip.id), ["visible"])
})

test("不正なpreviewTimeと未準備videoを安全な値へ正規化する", () => {
    const state = buildPreviewState({
        state: { ...baseState(Number.NaN), video: { readyState: 0, videoWidth: 0 } as HTMLVideoElement },
        activeInfo: null,
        trackSources: [],
    })
    assert.equal(state.previewTime, 0)
    assert.equal(state.hasVideo, false)
    assert.equal(state.activeClip, null)
})
