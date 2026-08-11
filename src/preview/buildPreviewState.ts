import type { PreviewMediaTimeInfo } from "../hooks/usePreviewPlaybackClock.ts"
import type { TrackMediaClip } from "../lib/types.ts"
import type { PreviewState } from "./types.ts"

export interface PreviewTrackSource {
    clip: TrackMediaClip
    element: HTMLVideoElement | undefined
    trackOrder: number
    hidden: boolean
}

type PreviewStateBase = Omit<
    PreviewState,
    "hasVideo" | "activeClip" | "activeClipLocalTime" | "trackVideos"
>

export function buildPreviewState({
    state,
    activeInfo,
    trackSources,
}: {
    state: PreviewStateBase
    activeInfo: PreviewMediaTimeInfo | null
    trackSources: readonly PreviewTrackSource[]
}): PreviewState {
    const sequenceTime = Math.max(0, Number.isFinite(state.previewTime) ? state.previewTime : 0)
    return {
        ...state,
        previewTime: sequenceTime,
        hasVideo: Boolean(state.video && state.video.readyState >= 1 && state.video.videoWidth > 0),
        activeClip: activeInfo?.clip ?? null,
        activeClipLocalTime: activeInfo ? Math.max(0, sequenceTime - activeInfo.clipAccTime) : 0,
        trackVideos: trackSources
            .filter(({ clip, element, hidden }) =>
                !hidden && Boolean(element) && sequenceTime >= clip.timelineStart && sequenceTime < clip.timelineEnd
            )
            .map(({ clip, element, trackOrder }) => ({ clip, element: element!, trackOrder })),
    }
}
