import type { HighlightAnalysisResponse } from "@/tauri/commands"
import type { AgentHighlight, SubtitleFlag, TextSegment } from "@/lib/types"

export type AnalysisMode = "fast" | "subtitle"

export interface AnalysisTrackInfo {
    voiceTracks: number[]
    gameTracks: number[]
    streamCount: number
    trackStats: {
        track: number
        role: string
        rms?: number | null
        silenceRatio?: number | null
    }[]
}

export interface AnalysisArtifact {
    id: string
    sourcePath: string
    mode: AnalysisMode
    createdAt: string
    transcriptText: string
    highlights: AgentHighlight[]
    subtitles: TextSegment[]
    excitementGraph: number[]
    trackInfo: AnalysisTrackInfo | null
    stats: HighlightAnalysisResponse["stats"] | null
    signalSummary?: HighlightAnalysisResponse["signal_summary"] | null
    warnings: string[]
    gameContext: HighlightAnalysisResponse["game_context"] | null
}

const REVIEW_CONFIDENCE_THRESHOLD = 0.45
const MAX_SUBTITLE_CHARS = 24

function toNumber(value: unknown, fallback = 0): number {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
}

function optionalNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === "") return undefined
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
}

function uniqueFlags(flags: SubtitleFlag[]): SubtitleFlag[] {
    return Array.from(new Set(flags))
}

function deriveFlags(segment: any, confidence?: number): SubtitleFlag[] {
    const rawFlags = Array.isArray(segment.flags) ? segment.flags : []
    const flags: SubtitleFlag[] = rawFlags.filter((flag: string): flag is SubtitleFlag =>
        flag === "low_confidence" ||
        flag === "possible_hallucination" ||
        flag === "needs_review"
    )

    if (confidence !== undefined && confidence < REVIEW_CONFIDENCE_THRESHOLD) {
        flags.push("low_confidence", "needs_review")
    }

    const text = String(segment.text ?? "")
    if (/ご視聴ありがとうございました|ご覧いただきありがとうございました|チャンネル登録|高評価|次の動画でお会いしましょう|次回の動画でお会いしましょう/i.test(text)) {
        flags.push("possible_hallucination", "needs_review")
    }

    const start = toNumber(segment.start ?? segment.startTime ?? segment.start_time, 0)
    const end = toNumber(segment.end ?? segment.endTime ?? segment.end_time, start)
    if (!text.trim() || end <= start) {
        flags.push("needs_review")
    }

    return uniqueFlags(flags)
}

export function normalizeAnalysisSegment(segment: any): TextSegment {
    const confidence = optionalNumber(segment.confidence)
    const sourceTrack = optionalNumber(segment.sourceTrack ?? segment.source_track)
    const start = toNumber(segment.start ?? segment.startTime ?? segment.start_time, 0)
    const end = toNumber(segment.end ?? segment.endTime ?? segment.end_time, start)

    return {
        id: segment.id || crypto.randomUUID(),
        text: String(segment.text ?? ""),
        start,
        end,
        confidence,
        sourceTrack,
        flags: deriveFlags(segment, confidence),
        refinedByGlossary: !!segment.refinedByGlossary,
        originalText: segment.originalText ? String(segment.originalText) : undefined,
        recognitionModel: segment.recognitionModel ? String(segment.recognitionModel) : undefined,
    }
}

function splitSubtitleText(text: string, maxChars = MAX_SUBTITLE_CHARS): string[] {
    const normalized = text.replace(/\s+/g, " ").trim()
    const characters = Array.from(normalized)
    if (characters.length <= maxChars) return normalized ? [normalized] : []

    const chunks: string[] = []
    let rest = characters
    while (rest.length > maxChars) {
        const minimumBreak = Math.max(8, Math.floor(maxChars * 0.55))
        let breakAt = maxChars
        for (let index = maxChars; index >= minimumBreak; index -= 1) {
            if (/[、。！？!?…\s]/.test(rest[index - 1] ?? "")) {
                breakAt = index
                break
            }
        }
        chunks.push(rest.slice(0, breakAt).join("").trim())
        rest = rest.slice(breakAt)
    }
    const tail = rest.join("").trim()
    if (tail) chunks.push(tail)
    return chunks.filter(Boolean)
}

/** 長文を画面内に収まる単位へ分け、隣接字幕の時間重複を除く。 */
export function normalizeSubtitleSequence(segments: TextSegment[]): TextSegment[] {
    const expanded = segments.flatMap((segment) => {
        const chunks = splitSubtitleText(segment.text)
        if (chunks.length <= 1) return [{ ...segment, text: chunks[0] ?? segment.text.trim() }]

        const duration = Math.max(0.2, segment.end - segment.start)
        const totalWeight = chunks.reduce((sum, chunk) => sum + Array.from(chunk).length, 0)
        let cursor = segment.start
        return chunks.map((text, index) => {
            const isLast = index === chunks.length - 1
            const share = Array.from(text).length / Math.max(1, totalWeight)
            const end = isLast ? segment.end : Math.min(segment.end, cursor + duration * share)
            const split = {
                ...segment,
                id: `${segment.id}_${index + 1}`,
                text,
                start: Number(cursor.toFixed(3)),
                end: Number(Math.max(cursor + 0.05, end).toFixed(3)),
            }
            cursor = end
            return split
        })
    }).sort((a, b) => a.start - b.start || a.end - b.end)

    return expanded.map((segment, index) => {
        const next = expanded[index + 1]
        if (!next || next.start <= segment.start || segment.end <= next.start) return segment
        return {
            ...segment,
            end: Number(Math.max(segment.start + 0.05, next.start - 0.01).toFixed(3)),
        }
    })
}

export function normalizeAnalysisHighlight(highlight: any): AgentHighlight {
    const highlightStart = Math.max(0, toNumber(highlight.start, 0))
    const highlightEnd = Math.max(highlightStart, toNumber(highlight.end, highlightStart))
    const falsePositiveRisk = optionalNumber(highlight.falsePositiveRisk ?? highlight.false_positive_risk)
    const durationVariantEntries = highlight.durationVariants && typeof highlight.durationVariants === "object"
        ? (["15", "30", "60"] as const).flatMap((key) => {
            const variant = highlight.durationVariants[key]
            if (!variant || typeof variant !== "object") return []
            const start = Math.max(0, toNumber(variant.start, highlightStart))
            return [[key, {
                start,
                end: Math.max(start, toNumber(variant.end, highlightEnd)),
            }] as const]
        })
        : []
    const rawScoreDetails = highlight.scoreDetails ?? highlight.score_details
    const scoreDetails = rawScoreDetails && typeof rawScoreDetails === "object"
        ? {
            event: Math.min(100, Math.max(0, toNumber(rawScoreDetails.event, 0))),
            reaction: Math.min(100, Math.max(0, toNumber(rawScoreDetails.reaction, 0))),
            clipability: Math.min(100, Math.max(0, toNumber(rawScoreDetails.clipability, 0))),
            confidence: Math.min(1, Math.max(0, toNumber(rawScoreDetails.confidence, 0))),
        }
        : undefined
    return {
        start: highlightStart,
        end: highlightEnd,
        label: highlight.label || "Highlight",
        reason: highlight.reason || "",
        excitement: toNumber(highlight.excitement, 0),
        isProRequired: highlight.isProRequired,
        scoreDetails,
        evidence: Array.isArray(highlight.evidence)
            ? highlight.evidence.map((item: unknown) => String(item))
            : undefined,
        category: highlight.category ? String(highlight.category) : undefined,
        falsePositiveRisk: falsePositiveRisk === undefined
            ? undefined
            : Math.min(1, Math.max(0, falsePositiveRisk)),
        durationVariants: durationVariantEntries.length > 0
            ? Object.fromEntries(durationVariantEntries) as AgentHighlight["durationVariants"]
            : undefined,
    }
}

function normalizeTrackInfo(response: HighlightAnalysisResponse): AnalysisTrackInfo | null {
    const raw = response.track_info
    if (!raw) return null

    return {
        voiceTracks: Array.isArray(raw.voice_tracks) ? raw.voice_tracks.map((track) => toNumber(track, 0)) : [],
        gameTracks: Array.isArray(raw.game_tracks) ? raw.game_tracks.map((track) => toNumber(track, 0)) : [],
        streamCount: toNumber(raw.stream_count, 0),
        trackStats: Array.isArray(raw.track_stats)
            ? raw.track_stats.map((item) => ({
                track: toNumber(item.track, 0),
                role: String(item.role ?? "unknown"),
                rms: optionalNumber(item.rms),
                silenceRatio: optionalNumber(item.silence_ratio),
            }))
            : [],
    }
}

export function createAnalysisArtifactFromResponse(
    response: HighlightAnalysisResponse,
    sourcePath: string,
    mode: AnalysisMode,
): AnalysisArtifact {
    const subtitles = Array.isArray(response.segments)
        ? normalizeSubtitleSequence(response.segments.map(normalizeAnalysisSegment))
        : []
    const highlights = Array.isArray(response.highlights)
        ? response.highlights.map(normalizeAnalysisHighlight)
        : []
    const warnings: string[] = []
    const trackInfo = normalizeTrackInfo(response)

    const reviewCount = subtitles.filter((subtitle) => subtitle.flags?.includes("needs_review")).length
    if (reviewCount > 0) {
        warnings.push(`${reviewCount}件の字幕に確認フラグがあります`)
    }
    if (!Array.isArray(response.segments)) {
        warnings.push("バックエンドから字幕セグメントが返りませんでした")
    }
    if (trackInfo && trackInfo.streamCount > 1 && trackInfo.voiceTracks.length === 0) {
        warnings.push("声トラックを特定できなかったため、字幕欠落の可能性があります")
    }
    if (response.game_context?.glossaryApplied && response.game_context.refinementCount) {
        warnings.push(`${response.game_context.refinementCount}件をゲーム用語で再判定しました`)
    }
    if (Array.isArray(response.signal_summary?.warnings)) {
        warnings.push(...response.signal_summary.warnings.map((warning) => String(warning)))
    }

    return {
        id: crypto.randomUUID(),
        sourcePath,
        mode,
        createdAt: new Date().toISOString(),
        transcriptText: response.transcript_text || subtitles.map((s) => s.text).join(" "),
        highlights,
        subtitles,
        excitementGraph: response.excitement_graph || [],
        trackInfo,
        stats: response.stats ?? null,
        signalSummary: response.signal_summary ?? null,
        warnings,
        gameContext: response.game_context ?? null,
    }
}
