import { DEFAULT_TIMELINE_CLIP_TRANSFORM } from "./types.ts"
import type { SilenceSegment, SpeedCurvePoint, TextSegment, TimelineClip, TimelineClipTransform } from "./types.ts"

const DEFAULT_MIN_CLIP_DURATION = 0.1

export interface TimelineLayoutClip extends TimelineClip {
    index: number
    sequenceStart: number
    duration: number
}

export interface SequenceMediaPosition {
    clip: TimelineClip
    clipIdx: number
    clipAccTime: number
    mediaTime: number
}

export type TimelineClipEdge = "start" | "end"

function clamp(value: number, min: number, max: number) {
    if (max < min) return min
    return Math.max(min, Math.min(max, value))
}

function roundTime(value: number) {
    return Number(value.toFixed(3))
}

function maxFiniteDuration(mediaDuration: number | null | undefined) {
    return typeof mediaDuration === "number" && Number.isFinite(mediaDuration) && mediaDuration > 0
        ? mediaDuration
        : Number.POSITIVE_INFINITY
}

/** Gap は後方互換のため mediaStart に長さを保持する。 */
export function getTimelineClipSpeed(clip: TimelineClip): number {
    if (clip.isGap) return 1
    const speed = Number.isFinite(clip.speed) ? clip.speed! : 1
    return Math.max(0.25, Math.min(4, speed))
}

export function getTimelineClipVolume(clip: TimelineClip): number {
    if (clip.muted) return 0
    const volume = Number.isFinite(clip.volume) ? clip.volume! : 1
    return Math.max(0, Math.min(2, volume))
}

export function getTimelineClipTransform(clip: TimelineClip): TimelineClipTransform {
    const transform = clip.transform ?? DEFAULT_TIMELINE_CLIP_TRANSFORM
    return {
        positionX: clamp(Number.isFinite(transform.positionX) ? transform.positionX : 0, -1, 1),
        positionY: clamp(Number.isFinite(transform.positionY) ? transform.positionY : 0, -1, 1),
        scale: clamp(Number.isFinite(transform.scale) ? transform.scale : 1, 1, 3),
        rotation: clamp(Number.isFinite(transform.rotation) ? transform.rotation : 0, -180, 180),
        flipHorizontal: transform.flipHorizontal === true,
        flipVertical: transform.flipVertical === true,
        opacity: clamp(Number.isFinite(transform.opacity) ? transform.opacity : 1, 0, 1),
    }
}

/** 素材上の長さ。速度変更前のトリム範囲を返す。 */
export function getTimelineClipSourceDuration(clip: TimelineClip): number {
    return Math.max(0, clip.isGap ? clip.mediaStart : clip.mediaEnd - clip.mediaStart)
}

export interface TimelineSpeedSegment {
    sourceStart: number
    sourceEnd: number
    speed: number
    outputDuration: number
}

export function normalizeSpeedCurve(points: readonly SpeedCurvePoint[] | undefined, fallbackSpeed = 1): SpeedCurvePoint[] {
    const normalized = (points ?? [])
        .filter((point) => Number.isFinite(point.position) && Number.isFinite(point.speed))
        .map((point) => ({ position: clamp(point.position, 0, 1), speed: clamp(point.speed, 0.25, 4) }))
        .sort((a, b) => a.position - b.position)
    if (normalized.length === 0) return []
    if (normalized[0].position > 0) normalized.unshift({ position: 0, speed: clamp(fallbackSpeed, 0.25, 4) })
    if (normalized.at(-1)!.position < 1) normalized.push({ position: 1, speed: normalized.at(-1)!.speed })
    return normalized
}

export function getTimelineClipSpeedSegments(clip: TimelineClip): TimelineSpeedSegment[] {
    const sourceDuration = getTimelineClipSourceDuration(clip)
    if (clip.isGap || sourceDuration <= 0) return []
    const curve = normalizeSpeedCurve(clip.speedCurve, getTimelineClipSpeed(clip))
    if (curve.length < 2) {
        const speed = getTimelineClipSpeed(clip)
        return [{ sourceStart: 0, sourceEnd: sourceDuration, speed, outputDuration: sourceDuration / speed }]
    }
    return curve.slice(0, -1).map((point, index) => {
        const next = curve[index + 1]
        const sourceStart = sourceDuration * point.position
        const sourceEnd = sourceDuration * next.position
        const speed = clamp((point.speed + next.speed) / 2, 0.25, 4)
        return { sourceStart, sourceEnd, speed, outputDuration: (sourceEnd - sourceStart) / speed }
    }).filter((segment) => segment.sourceEnd - segment.sourceStart > 0.0001)
}

export function getTimelineClipDuration(clip: TimelineClip): number {
    const sourceDuration = getTimelineClipSourceDuration(clip)
    if (clip.isGap) return sourceDuration
    if (Number.isFinite(clip.freezeFrame)) return clamp(clip.freezeDuration ?? 2, 0.1, 30)
    return getTimelineClipSpeedSegments(clip).reduce((total, segment) => total + segment.outputDuration, 0)
}

export function timelineClipLocalTimeToMedia(clip: TimelineClip, localTime: number): number {
    if (clip.isGap) return 0
    const lastFrame = Math.max(clip.mediaStart, clip.mediaEnd - 1 / 30)
    if (Number.isFinite(clip.freezeFrame)) return clamp(clip.freezeFrame!, clip.mediaStart, lastFrame)
    let remaining = Math.max(0, localTime)
    let sourceOffset = 0
    const segments = getTimelineClipSpeedSegments(clip)
    for (const segment of segments) {
        if (remaining <= segment.outputDuration) {
            sourceOffset = segment.sourceStart + remaining * segment.speed
            break
        }
        remaining -= segment.outputDuration
        sourceOffset = segment.sourceEnd
    }
    return clip.reverse
        ? clamp(clip.mediaEnd - sourceOffset, clip.mediaStart, lastFrame)
        : clamp(clip.mediaStart + sourceOffset, clip.mediaStart, lastFrame)
}

export function timelineClipMediaToLocalTime(clip: TimelineClip, mediaTime: number): number {
    if (Number.isFinite(clip.freezeFrame)) return 0
    const totalSource = getTimelineClipSourceDuration(clip)
    const wanted = clip.reverse ? clip.mediaEnd - mediaTime : mediaTime - clip.mediaStart
    const offset = clamp(wanted, 0, totalSource)
    let local = 0
    for (const segment of getTimelineClipSpeedSegments(clip)) {
        if (offset <= segment.sourceEnd) return local + (offset - segment.sourceStart) / segment.speed
        local += segment.outputDuration
    }
    return local
}

/** クリップの片端を安全に設定する。短すぎるクリップや動画範囲外への更新を防ぐ。 */
export function setTimelineClipEdge(
    clip: TimelineClip,
    edge: TimelineClipEdge,
    value: number,
    mediaDuration?: number | null,
    minDuration = DEFAULT_MIN_CLIP_DURATION,
): TimelineClip {
    if (clip.isGap) return clip

    const maxEnd = maxFiniteDuration(mediaDuration)
    const safeMinDuration = Math.max(0.001, minDuration)
    const safeValue = Number.isFinite(value) ? value : edge === "start" ? clip.mediaStart : clip.mediaEnd

    if (edge === "start") {
        return {
            ...clip,
            mediaStart: roundTime(clamp(safeValue, 0, clip.mediaEnd - safeMinDuration)),
        }
    }

    return {
        ...clip,
        mediaEnd: roundTime(clamp(safeValue, clip.mediaStart + safeMinDuration, maxEnd)),
    }
}

/** クリップ端を指定秒数だけ伸縮する。 */
export function trimTimelineClipEdge(
    clip: TimelineClip,
    edge: TimelineClipEdge,
    delta: number,
    mediaDuration?: number | null,
    minDuration = DEFAULT_MIN_CLIP_DURATION,
): TimelineClip {
    const baseValue = edge === "start" ? clip.mediaStart : clip.mediaEnd
    return setTimelineClipEdge(clip, edge, baseValue + delta, mediaDuration, minDuration)
}

export function canSplitTimelineClip(
    clip: TimelineClip,
    splitMediaTime: number,
    minDuration = DEFAULT_MIN_CLIP_DURATION,
) {
    if (clip.isGap) return false
    return splitMediaTime > clip.mediaStart + minDuration &&
        splitMediaTime < clip.mediaEnd - minDuration
}

export function splitTimelineClipAt(
    clip: TimelineClip,
    splitMediaTime: number,
    makeId: () => string = () => globalThis.crypto?.randomUUID?.() ?? `clip-${Date.now()}`,
    minDuration = DEFAULT_MIN_CLIP_DURATION,
): [TimelineClip, TimelineClip] | null {
    if (!canSplitTimelineClip(clip, splitMediaTime, minDuration)) return null

    const split = roundTime(splitMediaTime)
    return [
        { ...clip, mediaEnd: split },
        { ...clip, id: makeId(), mediaStart: split },
    ]
}

export function layoutTimelineClips(clips: TimelineClip[]): TimelineLayoutClip[] {
    let sequenceStart = 0
    return clips.map((clip, index) => {
        const duration = getTimelineClipDuration(clip)
        const laidOut = { ...clip, index, sequenceStart, duration }
        sequenceStart += duration
        return laidOut
    })
}

export function getSequenceDuration(clips: TimelineClip[]): number {
    return clips.reduce((total, clip) => total + getTimelineClipDuration(clip), 0)
}

export function isFullSourceTimeline(clips: TimelineClip[], mediaDuration: number | null | undefined): boolean {
    const duration = maxFiniteDuration(mediaDuration)
    if (!Number.isFinite(duration) || clips.length === 0) return false

    // 手動で分割しただけのタイムラインも「元動画全体」とみなす。
    // 途中削除・Gap・並べ替え・複製があれば連続性が崩れるため false になる。
    const tolerance = 0.1
    if (clips.some((clip) => clip.isGap || clip.mediaEnd <= clip.mediaStart)) return false
    if (Math.abs(clips[0].mediaStart) >= tolerance) return false
    for (let index = 1; index < clips.length; index += 1) {
        if (Math.abs(clips[index - 1].mediaEnd - clips[index].mediaStart) >= tolerance) {
            return false
        }
    }
    return Math.abs(clips[clips.length - 1].mediaEnd - duration) < tolerance
}

/** AI候補の初回採用で、現在の下書きタイムラインを候補へ置き換えるべきか。 */
export function shouldReplaceTimelineOnFirstAdoption(
    clips: TimelineClip[],
    mediaDuration: number | null | undefined,
): boolean {
    if (isFullSourceTimeline(clips, mediaDuration)) return true
    if (clips.length === 0) return true

    // 無音カットは元素材から自動生成した下書きであり、ユーザーが採用した候補列ではない。
    // ここを通常の編集済みタイムライン扱いすると、初回候補が末尾へ追加されてしまう。
    return clips.every((clip) =>
        !clip.isGap && (clip.label ?? "").toLowerCase().startsWith("auto cut"),
    )
}

export function createFullSourceClip(
    mediaDuration: number,
    makeId: () => string = () => globalThis.crypto?.randomUUID?.() ?? `source-${Date.now()}`,
): TimelineClip {
    return {
        id: makeId(),
        mediaStart: 0,
        mediaEnd: roundTime(mediaDuration),
        label: "元動画",
    }
}

/** シーケンス上の時刻を、元動画上の時刻とクリップ情報へ変換する。 */
export function sequenceTimeToMedia(
    clips: TimelineClip[],
    sequenceTime: number,
): SequenceMediaPosition | null {
    const safeTime = Math.max(0, sequenceTime)
    let clipAccTime = 0

    for (let clipIdx = 0; clipIdx < clips.length; clipIdx += 1) {
        const clip = clips[clipIdx]
        const duration = getTimelineClipDuration(clip)
        if (safeTime >= clipAccTime && safeTime < clipAccTime + duration) {
            return {
                clip,
                clipIdx,
                clipAccTime,
                mediaTime: clip.isGap
                    ? 0
                    : timelineClipLocalTimeToMedia(clip, safeTime - clipAccTime),
            }
        }
        clipAccTime += duration
    }

    return null
}

/** 元動画の区間を、採用済みクリップ上に現れるシーケンス区間へ展開する。 */
export function mediaRangeToSequenceRanges(
    clips: TimelineClip[],
    mediaStart: number,
    mediaEnd: number,
) {
    return layoutTimelineClips(clips).flatMap((clip) => {
        if (clip.isGap) return []
        const overlapStart = Math.max(mediaStart, clip.mediaStart)
        const overlapEnd = Math.min(mediaEnd, clip.mediaEnd)
        if (overlapStart >= overlapEnd) return []
        return [{
            clipId: clip.id,
            sequenceStart: clip.sequenceStart + Math.min(timelineClipMediaToLocalTime(clip, overlapStart), timelineClipMediaToLocalTime(clip, overlapEnd)),
            sequenceEnd: clip.sequenceStart + Math.max(timelineClipMediaToLocalTime(clip, overlapStart), timelineClipMediaToLocalTime(clip, overlapEnd)),
        }]
    })
}

export interface SequenceSubtitle {
    id: string
    text: string
    startTime: number
    endTime: number
    emotion: string
    styleOverride?: TextSegment["styleOverride"]
}

/** 元動画時間で保持した字幕を、FFmpegが使うシーケンス時間へ変換する。 */
export function subtitlesToSequence(
    clips: TimelineClip[],
    subtitles: TextSegment[],
): SequenceSubtitle[] {
    return subtitles.flatMap((subtitle) =>
        mediaRangeToSequenceRanges(clips, subtitle.start, subtitle.end).map((range) => ({
            id: `${subtitle.id}_${range.clipId}`,
            text: subtitle.text,
            startTime: range.sequenceStart,
            endTime: range.sequenceEnd,
            emotion: "neutral",
            ...(subtitle.styleOverride ? { styleOverride: subtitle.styleOverride } : {}),
        }))
    )
}

/** 無音区間を除外した、元動画順の編集クリップ列を作る。 */
export function createClipsExcludingRanges(
    duration: number,
    removedRanges: SilenceSegment[],
    label = "Auto Cut",
): TimelineClip[] {
    const normalized = removedRanges
        .map((range) => ({
            start: Math.max(0, Math.min(duration, range.start)),
            end: Math.max(0, Math.min(duration, range.end)),
        }))
        .filter((range) => range.end > range.start)
        .sort((a, b) => a.start - b.start)

    const merged: SilenceSegment[] = []
    const minimumAudibleIsland = 0.12
    for (const range of normalized) {
        const previous = merged.at(-1)
        if (previous && range.start - previous.end <= minimumAudibleIsland) {
            previous.end = Math.max(previous.end, range.end)
        } else {
            merged.push({ ...range })
        }
    }

    const clips: TimelineClip[] = []
    let cursor = 0
    for (const range of merged) {
        if (range.start > cursor) {
            clips.push({
                id: crypto.randomUUID(),
                mediaStart: cursor,
                mediaEnd: range.start,
                label,
            })
        }
        cursor = Math.max(cursor, range.end)
    }
    if (cursor < duration) {
        clips.push({
            id: crypto.randomUUID(),
            mediaStart: cursor,
            mediaEnd: duration,
            label,
        })
    }
    return clips
}
