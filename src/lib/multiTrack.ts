import type { EditorTrack, EditorTrackKind, MediaAsset, TrackMediaClip } from "./types.ts"
import { getTimelineClipDuration, timelineClipLocalTimeToMedia } from "./timeline.ts"
import { DEFAULT_TIMELINE_CLIP_TRANSFORM } from "./types.ts"

const makeId = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`

export function createEditorTrack(kind: EditorTrackKind, existing: readonly EditorTrack[]): EditorTrack {
    const sameKindCount = existing.filter((track) => track.kind === kind).length
    return {
        id: makeId(`track-${kind}`),
        kind,
        name: `${kind === "video" ? "V" : "A"}${sameKindCount + 2}`,
        locked: false,
        hidden: false,
        muted: false,
    }
}

export function createTrackMediaClip(
    asset: MediaAsset,
    track: EditorTrack,
    timelineStart: number,
    sequenceDuration: number,
): TrackMediaClip | null {
    if (asset.kind === "image" || asset.kind !== track.kind) return null
    const available = Math.max(0.1, asset.duration ?? 5)
    const remaining = sequenceDuration > timelineStart ? sequenceDuration - timelineStart : available
    const duration = Math.max(0.1, Math.min(available, remaining > 0 ? remaining : available))
    return {
        id: makeId("track-clip"),
        trackId: track.id,
        assetId: asset.id,
        path: asset.path,
        kind: track.kind,
        label: asset.name,
        timelineStart: Math.max(0, timelineStart),
        timelineEnd: Math.max(0, timelineStart) + duration,
        sourceStart: 0,
        sourceEnd: duration,
        volume: 1,
        muted: false,
        hasAudio: asset.kind === "audio" || asset.hasAudio !== false,
        transform: { ...DEFAULT_TIMELINE_CLIP_TRANSFORM },
    }
}

export function updateTrackClipTiming(
    clips: readonly TrackMediaClip[],
    id: string,
    nextStart: number,
    nextEnd: number,
): TrackMediaClip[] {
    const source = clips.find((clip) => clip.id === id)
    if (!source || nextEnd - nextStart < 0.1) return [...clips]
    const previousDuration = source.timelineEnd - source.timelineStart
    const nextDuration = nextEnd - nextStart
    const moved = Math.abs(previousDuration - nextDuration) < 0.001
    const moveDelta = Math.max(0, nextStart) - source.timelineStart

    if (moved) {
        return clips.map((clip) => {
            if (clip.id !== id && (!source.groupId || clip.groupId !== source.groupId)) return { ...clip }
            const duration = clip.timelineEnd - clip.timelineStart
            const start = Math.max(0, clip.timelineStart + moveDelta)
            return { ...clip, timelineStart: start, timelineEnd: start + duration }
        })
    }

    return clips.map((clip) => {
        if (clip.id !== id) return { ...clip }
        const safeStart = Math.max(0, nextStart)
        const leftDelta = safeStart - source.timelineStart
        const rightDelta = nextEnd - source.timelineEnd
        const sourceStart = Math.max(0, source.sourceStart + leftDelta)
        const sourceEnd = Math.max(sourceStart + 0.1, source.sourceEnd + rightDelta)
        return { ...clip, timelineStart: safeStart, timelineEnd: nextEnd, sourceStart, sourceEnd }
    })
}

export function copyTrackClipGroup(clips: readonly TrackMediaClip[], id: string): TrackMediaClip[] {
    const source = clips.find((clip) => clip.id === id)
    if (!source) return []
    return clips
        .filter((clip) => clip.id === id || Boolean(source.groupId && clip.groupId === source.groupId))
        .map((clip) => ({ ...clip, transform: { ...clip.transform } }))
}

export function pasteTrackClipGroup(copied: readonly TrackMediaClip[], atTime: number): TrackMediaClip[] {
    if (copied.length === 0) return []
    const origin = Math.min(...copied.map((clip) => clip.timelineStart))
    const nextGroupId = copied.length > 1 ? makeId("group") : undefined
    return copied.map((clip) => {
        const duration = clip.timelineEnd - clip.timelineStart
        const start = Math.max(0, atTime + clip.timelineStart - origin)
        return {
            ...clip,
            id: makeId("track-clip"),
            timelineStart: start,
            timelineEnd: start + duration,
            groupId: nextGroupId,
            transform: { ...clip.transform },
        }
    })
}

export function normalizeEditorTimeline(raw: { editorTracks?: EditorTrack[]; trackMediaClips?: TrackMediaClip[] }) {
    const editorTracks = Array.isArray(raw.editorTracks)
        ? raw.editorTracks
            .filter((track) => track && typeof track.id === "string" && (track.kind === "video" || track.kind === "audio"))
            .map((track) => ({
                id: track.id,
                kind: track.kind,
                name: track.name || (track.kind === "video" ? "V2" : "A2"),
                locked: track.locked === true,
                hidden: track.hidden === true,
                muted: track.muted === true,
            }))
        : []
    const trackIds = new Set(editorTracks.map((track) => track.id))
    const trackMediaClips = Array.isArray(raw.trackMediaClips)
        ? raw.trackMediaClips
            .filter((clip) => clip && typeof clip.id === "string" && trackIds.has(clip.trackId) && typeof clip.path === "string")
            .map((clip) => ({
                ...clip,
                timelineStart: Math.max(0, Number(clip.timelineStart) || 0),
                timelineEnd: Math.max((Number(clip.timelineStart) || 0) + 0.1, Number(clip.timelineEnd) || 0.1),
                sourceStart: Math.max(0, Number(clip.sourceStart) || 0),
                sourceEnd: Math.max((Number(clip.sourceStart) || 0) + 0.1, Number(clip.sourceEnd) || 0.1),
                volume: Number.isFinite(clip.volume) ? Math.max(0, Math.min(2, clip.volume)) : 1,
                muted: clip.muted === true,
                hasAudio: clip.hasAudio !== false,
                transform: { ...DEFAULT_TIMELINE_CLIP_TRANSFORM, ...(clip.transform ?? {}) },
            }))
        : []
    return { editorTracks, trackMediaClips }
}

export function getEditorTimelineDuration(tracks: readonly TrackMediaClip[]) {
    return tracks.reduce((duration, clip) => Math.max(duration, clip.timelineEnd), 0)
}

function asTimelineClip(clip: TrackMediaClip) {
    return {
        id: clip.id,
        mediaStart: clip.sourceStart,
        mediaEnd: clip.sourceEnd,
        speed: clip.speed,
        speedCurve: clip.speedCurve,
        reverse: clip.reverse,
        freezeFrame: clip.freezeFrame,
        freezeDuration: clip.timelineEnd - clip.timelineStart,
    }
}

export function getTrackClipPlaybackDuration(clip: TrackMediaClip) {
    return getTimelineClipDuration(asTimelineClip(clip))
}

export function trackClipLocalTimeToSource(clip: TrackMediaClip, localTime: number) {
    return timelineClipLocalTimeToMedia(asTimelineClip(clip), localTime)
}
