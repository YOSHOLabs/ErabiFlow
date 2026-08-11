import type { AgentHighlight, TimelineClip } from "./types.ts"
import type { HighlightFeedbackRange, MissedHighlightCategory } from "./highlightFeedbackEvent.ts"
import { layoutTimelineClips, timelineClipLocalTimeToMedia } from "./timeline.ts"

export const MISSED_HIGHLIGHT_CATEGORY_LABELS: Record<MissedHighlightCategory, string> = {
    victory: "勝利・達成",
    failure: "失敗・ピンチ",
    surprise: "驚き・発見",
    comedy: "笑い・リアクション",
    explanation: "解説・学び",
    other: "その他",
}

export function normalizeMissedHighlightRange(
    first: number | null,
    second: number | null,
    duration: number,
    minDuration = 2,
): HighlightFeedbackRange | null {
    if (first === null || second === null || !Number.isFinite(first) || !Number.isFinite(second)) return null
    const safeDuration = Math.max(0, Number.isFinite(duration) ? duration : 0)
    const start = Math.max(0, Math.min(first, second, safeDuration))
    const end = Math.max(0, Math.min(Math.max(first, second), safeDuration))
    if (end - start < minDuration) return null
    return { start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) }
}

/** 編集シーケンスの選択を、同じ非Gapクリップ内の元動画区間へだけ変換する。 */
export function missedHighlightRangeFromSequence(
    clips: TimelineClip[],
    first: number | null,
    second: number | null,
    mediaDuration: number,
    minDuration = 2,
): HighlightFeedbackRange | null {
    if (clips.length === 0) {
        return normalizeMissedHighlightRange(first, second, mediaDuration, minDuration)
    }
    if (first === null || second === null || !Number.isFinite(first) || !Number.isFinite(second)) return null
    const sequenceStart = Math.min(first, second)
    const sequenceEnd = Math.max(first, second)
    if (sequenceEnd - sequenceStart < minDuration) return null

    const layout = layoutTimelineClips(clips)
    const startClip = layout.find((clip) =>
        sequenceStart >= clip.sequenceStart && sequenceStart < clip.sequenceStart + clip.duration,
    )
    // シーケンス終端はhalf-open境界なので、終了側だけ直前クリップへ含める。
    const endClip = layout.find((clip) =>
        sequenceEnd > clip.sequenceStart && sequenceEnd <= clip.sequenceStart + clip.duration,
    )
    if (!startClip || !endClip || startClip.isGap || endClip.isGap || startClip.id !== endClip.id) return null

    const toMediaBoundary = (sequenceTime: number) => {
        const localTime = Math.max(0, Math.min(startClip.duration, sequenceTime - startClip.sequenceStart))
        if (localTime >= startClip.duration - 1e-9) {
            return startClip.reverse ? startClip.mediaStart : startClip.mediaEnd
        }
        if (localTime <= 1e-9 && startClip.reverse) return startClip.mediaEnd
        return timelineClipLocalTimeToMedia(startClip, localTime)
    }
    return normalizeMissedHighlightRange(
        toMediaBoundary(sequenceStart),
        toMediaBoundary(sequenceEnd),
        mediaDuration,
        minDuration,
    )
}

export function temporalIou(
    first: HighlightFeedbackRange,
    second: Pick<AgentHighlight, "start" | "end">,
): number {
    const intersection = Math.max(0, Math.min(first.end, second.end) - Math.max(first.start, second.start))
    const union = Math.max(first.end, second.end) - Math.min(first.start, second.start)
    return union > 0 ? intersection / union : 0
}

export function nearestHighlightIou(range: HighlightFeedbackRange, highlights: AgentHighlight[]): number {
    return highlights.reduce((best, highlight) => Math.max(best, temporalIou(range, highlight)), 0)
}
