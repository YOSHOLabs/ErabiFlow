import type { HighlightScoreDetails } from "./types.ts"

export type HighlightFeedbackAction =
    | "shown"
    | "previewed"
    | "adopted"
    | "unadopted"
    | "queued"
    | "dequeued"
    | "trimmed"
    | "rejected"
    | "restored"
    | "missed"
    | "exported"

export type MissedHighlightCategory = "victory" | "failure" | "surprise" | "comedy" | "explanation" | "other"

export interface HighlightFeedbackRange {
    start: number
    end: number
}

export interface HighlightFeedbackEvent {
    schemaVersion: 1
    eventId: string
    occurredAt: string
    action: HighlightFeedbackAction
    analysisId?: string
    candidateId?: string
    clipId?: string
    candidateIndex?: number
    analysisMode?: "fast" | "subtitle"
    initialRange?: HighlightFeedbackRange
    currentRange?: HighlightFeedbackRange
    scoreDetails?: HighlightScoreDetails
    category?: MissedHighlightCategory
    nearestCandidateIou?: number
}

export interface HighlightFeedbackInput extends Omit<HighlightFeedbackEvent, "schemaVersion" | "eventId" | "occurredAt"> {
    eventId?: string
    occurredAt?: string
}

function finite(value: number): number {
    return Number.isFinite(value) ? value : 0
}

function normalizeRange(range: HighlightFeedbackRange | undefined): HighlightFeedbackRange | undefined {
    if (!range) return undefined
    const start = Math.max(0, finite(range.start))
    const end = Math.max(start, finite(range.end))
    return { start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) }
}

function normalizeScores(scores: HighlightScoreDetails | undefined): HighlightScoreDetails | undefined {
    if (!scores) return undefined
    return {
        event: Math.max(0, Math.min(100, finite(scores.event))),
        reaction: Math.max(0, Math.min(100, finite(scores.reaction))),
        clipability: Math.max(0, Math.min(100, finite(scores.clipability))),
        confidence: Math.max(0, Math.min(1, finite(scores.confidence))),
    }
}

const MISSED_CATEGORIES = new Set<MissedHighlightCategory>([
    "victory", "failure", "surprise", "comedy", "explanation", "other",
])

export function shouldRecordHighlightShown(
    highlight: { isProRequired?: boolean },
    canSeeAllCandidates: boolean,
): boolean {
    return canSeeAllCandidates || !highlight.isProRequired
}

/** 動画名・パス・字幕・候補文言を受け取らない、ローカル学習専用イベントを組み立てる。 */
export function createHighlightFeedbackEvent(input: HighlightFeedbackInput): HighlightFeedbackEvent {
    const initialRange = normalizeRange(input.initialRange)
    const currentRange = normalizeRange(input.currentRange)
    const scoreDetails = normalizeScores(input.scoreDetails)
    const nearestCandidateIou = input.nearestCandidateIou === undefined
        ? undefined
        : Math.max(0, Math.min(1, finite(input.nearestCandidateIou)))
    return {
        schemaVersion: 1,
        eventId: input.eventId ?? globalThis.crypto?.randomUUID?.() ?? `feedback-${Date.now()}`,
        occurredAt: input.occurredAt ?? new Date().toISOString(),
        action: input.action,
        ...(input.analysisId ? { analysisId: input.analysisId } : {}),
        ...(input.candidateId ? { candidateId: input.candidateId } : {}),
        ...(input.clipId ? { clipId: input.clipId } : {}),
        ...(Number.isInteger(input.candidateIndex) && Number(input.candidateIndex) >= 0
            ? { candidateIndex: Number(input.candidateIndex) }
            : {}),
        ...(input.analysisMode ? { analysisMode: input.analysisMode } : {}),
        ...(initialRange ? { initialRange } : {}),
        ...(currentRange ? { currentRange } : {}),
        ...(scoreDetails ? { scoreDetails } : {}),
        ...(input.category && MISSED_CATEGORIES.has(input.category) ? { category: input.category } : {}),
        ...(nearestCandidateIou !== undefined ? { nearestCandidateIou: Number(nearestCandidateIou.toFixed(4)) } : {}),
    }
}
