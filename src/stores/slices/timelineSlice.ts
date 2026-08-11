/**
 * timelineSlice — タイムライン・再生・NLEクリップの状態とアクション
 */
import type { SilenceSegment, DuckingConfig, EditorTrack, TimelineClip, TrackMediaClip } from "../../lib/types.ts"
import { DEFAULT_DUCKING } from "../../lib/types.ts"
import { splitTimelineClipAt } from "../../lib/timeline.ts"
import { updateTrackClipTiming } from "../../lib/multiTrack.ts"

export const createTimelineSlice = (set: any) => ({
    // --- 初期値 ---
    trim: { start: 0, end: 0 },
    silenceSegments: [] as SilenceSegment[],
    ducking: DEFAULT_DUCKING,
    timelineClips: [] as TimelineClip[],
    editorTracks: [] as EditorTrack[],
    trackMediaClips: [] as TrackMediaClip[],

    // --- Trim アクション ---
    setTrimStart: (v: number) =>
        set((s: any) => {
            s.trim.start = v
            if (s.trim.end <= v) s.trim.end = v + 0.5
        }),
    setTrimEnd: (v: number) =>
        set((s: any) => {
            s.trim.end = v
            if (s.trim.start >= v) s.trim.start = v - 0.5
        }),
    resetTrim: () =>
        set((s: any) => {
            s.trim = { start: 0, end: 0 }
            s.silenceSegments = []
        }),
    setSilenceSegments: (segments: SilenceSegment[]) =>
        set((s: any) => {
            s.silenceSegments = segments
        }),
    setDucking: (partial: Partial<DuckingConfig>) =>
        set((s: any) => {
            Object.assign(s.ducking, partial)
        }),

    // --- NLE クリップアクション ---
    setTimelineClips: (clips: TimelineClip[]) =>
        set((s: any) => {
            s.timelineClips = clips
        }),
    addTimelineClip: (clip: TimelineClip) =>
        set((s: any) => {
            s.timelineClips.push(clip)
        }),
    updateTimelineClip: (id: string, partial: Partial<TimelineClip>) =>
        set((s: any) => {
            const clip = s.timelineClips.find((c: any) => c.id === id)
            if (clip) Object.assign(clip, partial)
        }),
    removeTimelineClip: (id: string, ripple: boolean) =>
        set((s: any) => {
            const idx = s.timelineClips.findIndex((c: any) => c.id === id)
            if (idx < 0) return

            if (ripple) {
                s.timelineClips.splice(idx, 1)
            } else {
                const clip = s.timelineClips[idx]
                s.timelineClips[idx] = {
                    id: crypto.randomUUID(),
                    isGap: true,
                    mediaStart: clip.mediaEnd - clip.mediaStart,
                    mediaEnd: 0
                }
            }
        }),
    splitTimelineClip: (id: string, splitMediaTime: number) =>
        set((s: any) => {
            const idx = s.timelineClips.findIndex((c: any) => c.id === id)
            if (idx < 0) return
            const clip = s.timelineClips[idx]
            const split = splitTimelineClipAt(clip, splitMediaTime)
            if (!split) return

            s.timelineClips[idx] = split[0]
            s.timelineClips.splice(idx + 1, 0, split[1])
        }),
    duplicateTimelineClip: (id: string) =>
        set((s: any) => {
            const idx = s.timelineClips.findIndex((clip: any) => clip.id === id)
            if (idx < 0) return
            const source = s.timelineClips[idx]
            s.timelineClips.splice(idx + 1, 0, {
                ...source,
                id: globalThis.crypto?.randomUUID?.() ?? `clip-copy-${Date.now()}`,
                label: `${source.label || (source.isGap ? "Gap" : "クリップ")} コピー`,
            })
        }),
    reorderTimelineClips: (fromIndex: number, toIndex: number) =>
        set((s: any) => {
            if (fromIndex < 0 || fromIndex >= s.timelineClips.length || toIndex < 0 || toIndex >= s.timelineClips.length) return
            const [movedItem] = s.timelineClips.splice(fromIndex, 1)
            s.timelineClips.splice(toIndex, 0, movedItem)
        }),

    // --- 任意追加トラック ---
    addEditorTrack: (track: EditorTrack) =>
        set((s: any) => {
            if (!s.editorTracks.some((item: EditorTrack) => item.id === track.id)) s.editorTracks.push(track)
        }),
    updateEditorTrack: (id: string, partial: Partial<EditorTrack>) =>
        set((s: any) => {
            const track = s.editorTracks.find((item: EditorTrack) => item.id === id)
            if (track) Object.assign(track, partial, { id: track.id, kind: track.kind })
        }),
    removeEditorTrack: (id: string) =>
        set((s: any) => {
            s.editorTracks = s.editorTracks.filter((track: EditorTrack) => track.id !== id)
            s.trackMediaClips = s.trackMediaClips.filter((clip: TrackMediaClip) => clip.trackId !== id)
        }),
    addTrackMediaClip: (clip: TrackMediaClip) =>
        set((s: any) => {
            const track = s.editorTracks.find((item: EditorTrack) => item.id === clip.trackId)
            if (track && track.kind === clip.kind && !track.locked) s.trackMediaClips.push(clip)
        }),
    addTrackMediaClips: (clips: TrackMediaClip[]) =>
        set((s: any) => {
            for (const clip of clips) {
                const track = s.editorTracks.find((item: EditorTrack) => item.id === clip.trackId)
                if (track && track.kind === clip.kind && !track.locked) s.trackMediaClips.push(clip)
            }
        }),
    updateTrackMediaClip: (id: string, partial: Partial<TrackMediaClip>) =>
        set((s: any) => {
            const clip = s.trackMediaClips.find((item: TrackMediaClip) => item.id === id)
            if (!clip) return
            const track = s.editorTracks.find((item: EditorTrack) => item.id === clip.trackId)
            if (!track || track.locked) return
            const targetTrack = partial.trackId
                ? s.editorTracks.find((item: EditorTrack) => item.id === partial.trackId && item.kind === clip.kind && !item.locked)
                : track
            if (!targetTrack) return
            Object.assign(clip, partial, { id: clip.id, trackId: targetTrack.id, kind: clip.kind })
        }),
    updateTrackMediaClipTiming: (id: string, start: number, end: number) =>
        set((s: any) => {
            const clip = s.trackMediaClips.find((item: TrackMediaClip) => item.id === id)
            const track = clip && s.editorTracks.find((item: EditorTrack) => item.id === clip.trackId)
            if (!clip || !track || track.locked) return
            s.trackMediaClips = updateTrackClipTiming(s.trackMediaClips, id, start, end)
        }),
    removeTrackMediaClip: (id: string, includeGroup = false) =>
        set((s: any) => {
            const clip = s.trackMediaClips.find((item: TrackMediaClip) => item.id === id)
            const track = clip && s.editorTracks.find((item: EditorTrack) => item.id === clip.trackId)
            if (!clip || !track || track.locked) return
            s.trackMediaClips = s.trackMediaClips.filter((item: TrackMediaClip) =>
                item.id !== id && !(includeGroup && clip.groupId && item.groupId === clip.groupId)
            )
        }),
    setTrackMediaClipGroup: (id: string, groupId?: string) =>
        set((s: any) => {
            const clip = s.trackMediaClips.find((item: TrackMediaClip) => item.id === id)
            const track = clip && s.editorTracks.find((item: EditorTrack) => item.id === clip.trackId)
            if (clip && track && !track.locked) clip.groupId = groupId
        }),
})
