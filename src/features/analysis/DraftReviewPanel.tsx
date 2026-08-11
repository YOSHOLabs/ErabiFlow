import { AlertTriangle, Check, CheckCircle2, Clock3, Crown, Eye, Flag, Scissors, Subtitles, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import type { AnalysisArtifact } from "@/lib/analysisArtifact"
import type { AgentHighlight, TextSegment, TimelineClip } from "@/lib/types"
import { mediaRangeToSequenceRanges, shouldReplaceTimelineOnFirstAdoption } from "@/lib/timeline"
import { useDocumentStore } from "@/stores/document"
import { useEditorStore } from "@/stores/editor"
import { useEntitlementStore } from "@/stores/entitlement"
import { hasCapability } from "@/lib/entitlements"
import {
    highlightCandidateClipPrefix,
    highlightCandidateId,
    isHighlightCandidateClipId,
} from "@/lib/highlightCandidateClip"
import { CreatorUpgradeModal } from "@/features/premium/CreatorUpgradeModal"
import {
    HIGHLIGHT_FEEDBACK_RESET_EVENT,
    isHighlightFeedbackEnabled,
    recordHighlightFeedback,
    shouldRecordHighlightShown,
    type HighlightFeedbackAction,
    type HighlightFeedbackRange,
} from "@/lib/highlightFeedback"
import {
    MISSED_HIGHLIGHT_CATEGORY_LABELS,
    missedHighlightRangeFromSequence,
    nearestHighlightIou,
} from "@/lib/highlightMiss"
import type { MissedHighlightCategory } from "@/lib/highlightFeedback"

const MIN_CLIP_DURATION = 2

function activeArtifact(
    artifacts: AnalysisArtifact[],
    activeAnalysisId: string | null,
    persisted: {
        sourcePath: string
        highlights: AgentHighlight[]
        subtitles: TextSegment[]
        excitementGraph: number[]
    },
) {
    const active = artifacts.find((item) => item.id === activeAnalysisId) ?? artifacts[0]
    if (active) return active
    if (persisted.highlights.length === 0) return null

    // Analysis artifacts are runtime/cache data. Rebuild the reviewable subset
    // from the project fields that are intentionally persisted in .vfocus.
    return {
        id: "persisted-draft",
        sourcePath: persisted.sourcePath,
        mode: "fast",
        createdAt: "",
        transcriptText: persisted.subtitles.map((subtitle) => subtitle.text).join(" "),
        highlights: persisted.highlights,
        subtitles: persisted.subtitles,
        excitementGraph: persisted.excitementGraph,
        trackInfo: null,
        stats: null,
        warnings: [],
        gameContext: null,
    } satisfies AnalysisArtifact
}

function clampHighlight(highlight: AgentHighlight, duration: number): AgentHighlight {
    const mediaDuration = duration > 0 ? duration : Math.max(MIN_CLIP_DURATION, highlight.end)
    let start = Math.max(0, Math.min(highlight.start, mediaDuration))
    let end = Math.max(start + MIN_CLIP_DURATION, Math.min(highlight.end, mediaDuration))

    if (end > mediaDuration) {
        end = mediaDuration
        start = Math.max(0, end - MIN_CLIP_DURATION)
    }

    return {
        ...highlight,
        start: Number(start.toFixed(3)),
        end: Number(end.toFixed(3)),
    }
}

function rebuildWarnings(artifact: AnalysisArtifact, subtitles: TextSegment[]) {
    const persistentWarnings = artifact.warnings.filter((warning) => !warning.includes("字幕に確認フラグ"))
    const reviewCount = subtitles.filter((subtitle) => subtitle.flags?.includes("needs_review")).length
    return reviewCount > 0
        ? [`${reviewCount}件の字幕に確認フラグがあります`, ...persistentWarnings]
        : persistentWarnings
}

function formatTime(seconds: number) {
    const minutes = Math.floor(seconds / 60)
    const rest = (seconds % 60).toFixed(1).padStart(4, "0")
    return `${minutes}:${rest}`
}

export function DraftReviewPanel() {
    const [showCreatorModal, setShowCreatorModal] = useState(false)
    const [feedbackSession, setFeedbackSession] = useState(0)
    const [missedCategory, setMissedCategory] = useState<MissedHighlightCategory>("other")
    const [missedMessage, setMissedMessage] = useState("")
    const shownCandidateIds = useRef(new Set<string>())
    const initialCandidateRanges = useRef(new Map<string, HighlightFeedbackRange>())
    const developmentUi = import.meta.env.DEV
    const productPlan = useEntitlementStore((s) => s.plan)
    const canSeeAllCandidates = hasCapability(productPlan, "clips.extendedCandidates")
    const artifacts = useDocumentStore((s) => s.analysisArtifacts)
    const activeAnalysisId = useDocumentStore((s) => s.activeAnalysisId)
    const inputPath = useDocumentStore((s) => s.inputPath)
    const recommendedCuts = useDocumentStore((s) => s.recommendedCuts)
    const excitementGraph = useDocumentStore((s) => s.excitementGraph)
    const duration = useDocumentStore((s) => s.videoInfo?.duration ?? 0)
    const timelineClips = useDocumentStore((s) => s.timelineClips)
    const subtitles = useDocumentStore((s) => s.subtitles)
    const artifact = activeArtifact(artifacts, activeAnalysisId, {
        sourcePath: inputPath,
        highlights: recommendedCuts,
        subtitles,
        excitementGraph,
    })
    const setTimelineClips = useDocumentStore((s) => s.setTimelineClips)
    const setPreviewTime = useEditorStore((s) => s.setPreviewTime)
    const setSourcePreviewTime = useEditorStore((s) => s.setSourcePreviewTime)
    const setIsPlaying = useEditorStore((s) => s.setIsPlaying)
    const previewTime = useEditorStore((s) => s.previewTime)
    const workspaceIn = useEditorStore((s) => s.workspaceIn)
    const workspaceOut = useEditorStore((s) => s.workspaceOut)
    const setWorkspaceIn = useEditorStore((s) => s.setWorkspaceIn)
    const setWorkspaceOut = useEditorStore((s) => s.setWorkspaceOut)
    const setAnalysisArtifact = useDocumentStore((s) => s.setAnalysisArtifact)
    const setRecommendedCuts = useDocumentStore((s) => s.setRecommendedCuts)
    const setSubtitles = useDocumentStore((s) => s.setSubtitles)
    const setAgentThinking = useDocumentStore((s) => s.setAgentThinking)
    const selectEditorItem = useEditorStore((s) => s.select)
    const rejectedCandidateIndices = useDocumentStore((s) => s.rejectedHighlightCandidateIndices)
    const rejectHighlightCandidate = useDocumentStore((s) => s.rejectHighlightCandidate)
    const restoreHighlightCandidates = useDocumentStore((s) => s.restoreHighlightCandidates)

    useEffect(() => {
        const resetShownCandidates = () => {
            shownCandidateIds.current.clear()
            setFeedbackSession((session) => session + 1)
        }
        window.addEventListener(HIGHLIGHT_FEEDBACK_RESET_EVENT, resetShownCandidates)
        return () => window.removeEventListener(HIGHLIGHT_FEEDBACK_RESET_EVENT, resetShownCandidates)
    }, [])

    useEffect(() => {
        if (!artifact) return
        const visible = canSeeAllCandidates ? artifact.highlights : artifact.highlights.slice(0, 5)
        visible.forEach((highlight, index) => {
            if (!shouldRecordHighlightShown(highlight, canSeeAllCandidates)) return
            const candidateId = highlightCandidateId(artifact.id, index)
            if (!initialCandidateRanges.current.has(candidateId)) {
                initialCandidateRanges.current.set(candidateId, { start: highlight.start, end: highlight.end })
            }
            if (shownCandidateIds.current.has(candidateId)) return
            shownCandidateIds.current.add(candidateId)
            void recordHighlightFeedback({
                action: "shown",
                analysisId: artifact.id,
                candidateId,
                candidateIndex: index,
                analysisMode: artifact.mode,
                initialRange: { start: highlight.start, end: highlight.end },
                currentRange: { start: highlight.start, end: highlight.end },
                scoreDetails: highlight.scoreDetails,
            })
        })
    }, [artifact?.id, canSeeAllCandidates, feedbackSession])

    if (!artifact) return null

    const reviewSubtitles = artifact.subtitles.filter((subtitle) => subtitle.flags?.includes("needs_review"))
    const signalWarnings = Array.isArray(artifact.signalSummary?.warnings)
        ? artifact.signalSummary.warnings.map((warning) => String(warning)).filter(Boolean)
        : []
    const queueId = (index: number) => highlightCandidateId(artifact.id, index)
    const candidateClipPrefix = (index: number) => highlightCandidateClipPrefix(artifact.id, index)
    const isCandidateClip = (clip: TimelineClip, _highlight: AgentHighlight, index: number) =>
        isHighlightCandidateClipId(clip.id, artifact.id, index)
    const limitedHighlights = canSeeAllCandidates ? artifact.highlights : artifact.highlights.slice(0, 5)
    const hiddenCandidateIndices = new Set(rejectedCandidateIndices)
    const topHighlights = limitedHighlights
        .map((highlight, index) => ({ highlight, index }))
        .filter(({ index }) => !hiddenCandidateIndices.has(index))

    const recordCandidateAction = (
        action: HighlightFeedbackAction,
        highlight: AgentHighlight,
        index: number,
        extra: { clipId?: string; currentRange?: { start: number; end: number } } = {},
    ) => {
        void recordHighlightFeedback({
            action,
            analysisId: artifact.id,
            candidateId: queueId(index),
            candidateIndex: index,
            analysisMode: artifact.mode,
            initialRange: initialCandidateRanges.current.get(queueId(index))
                ?? { start: highlight.start, end: highlight.end },
            currentRange: extra.currentRange ?? { start: highlight.start, end: highlight.end },
            scoreDetails: highlight.scoreDetails,
            ...(extra.clipId ? { clipId: extra.clipId } : {}),
        })
    }

    const updateArtifact = (next: AnalysisArtifact) => {
        setAnalysisArtifact(next)
        setRecommendedCuts(next.highlights)
        setSubtitles(next.subtitles)
    }

    const updateHighlight = (index: number, updater: (highlight: AgentHighlight) => AgentHighlight) => {
        const previous = artifact.highlights[index]
        if (!previous) return

        const nextHighlight = clampHighlight(updater(previous), duration)
        const nextHighlights = artifact.highlights.map((highlight, i) => i === index ? nextHighlight : highlight)
        const nextArtifact = { ...artifact, highlights: nextHighlights }
        updateArtifact(nextArtifact)

        const adoptedClip = timelineClips.find((clip) => isCandidateClip(clip, previous, index))
        recordCandidateAction("trimmed", previous, index, {
            clipId: adoptedClip?.id,
            currentRange: { start: nextHighlight.start, end: nextHighlight.end },
        })

        setTimelineClips(timelineClips.map((clip) =>
            isCandidateClip(clip, previous, index)
                ? { ...clip, mediaStart: nextHighlight.start, mediaEnd: nextHighlight.end, label: `AI: ${nextHighlight.label.substring(0, 30)}` }
                : clip
        ))
    }

    const toggleAdopt = (highlight: AgentHighlight, index: number) => {
        const adoptedClip = timelineClips.find((clip) => isCandidateClip(clip, highlight, index))

        if (adoptedClip) {
            setTimelineClips(timelineClips.filter((clip) => !isCandidateClip(clip, highlight, index)))
            recordCandidateAction("unadopted", highlight, index, { clipId: adoptedClip.id })
            return
        }

        const nextClip: TimelineClip = {
            id: `${candidateClipPrefix(index)}${crypto.randomUUID()}`,
            mediaStart: highlight.start,
            mediaEnd: highlight.end,
            label: `AI: ${highlight.label.substring(0, 30)}`,
        }

        setTimelineClips(shouldReplaceTimelineOnFirstAdoption(timelineClips, duration) ? [nextClip] : [...timelineClips, nextClip])
        recordCandidateAction("adopted", highlight, index, { clipId: nextClip.id })
    }

    const seekMediaRange = (start: number, end = start + 0.2) => {
        const sequenceStart = mediaRangeToSequenceRanges(timelineClips, start, end)[0]?.sequenceStart ?? start
        setIsPlaying(false)
        setPreviewTime(sequenceStart)
    }

    const previewCandidate = (highlight: AgentHighlight, index: number) => {
        setIsPlaying(false)
        setSourcePreviewTime(Math.max(0, Math.min(duration || highlight.end, highlight.start)))
        recordCandidateAction("previewed", highlight, index)
    }

    const rejectCandidate = (highlight: AgentHighlight, index: number) => {
        const adoptedClip = timelineClips.find((clip) => isCandidateClip(clip, highlight, index))
        if (adoptedClip) {
            setTimelineClips(timelineClips.filter((clip) => !isCandidateClip(clip, highlight, index)))
            recordCandidateAction("unadopted", highlight, index, { clipId: adoptedClip.id })
        }
        rejectHighlightCandidate(index)
        recordCandidateAction("rejected", highlight, index)
    }

    const restoreRejectedCandidates = () => {
        hiddenCandidateIndices.forEach((index) => {
            const highlight = artifact.highlights[index]
            if (highlight) recordCandidateAction("restored", highlight, index)
        })
        restoreHighlightCandidates([...hiddenCandidateIndices])
    }

    const registerMissedHighlight = () => {
        const range = missedHighlightRangeFromSequence(timelineClips, workspaceIn, workspaceOut, duration)
        if (!range) {
            setMissedMessage("同じ映像クリップ内で、開始と終了を2秒以上離して設定してください")
            return
        }

        const clipId = `${artifact.id}:missed:${crypto.randomUUID()}`
        const nextClip: TimelineClip = {
            id: clipId,
            mediaStart: range.start,
            mediaEnd: range.end,
            label: `手動: ${MISSED_HIGHLIGHT_CATEGORY_LABELS[missedCategory]}`,
        }
        setTimelineClips(shouldReplaceTimelineOnFirstAdoption(timelineClips, duration) ? [nextClip] : [...timelineClips, nextClip])
        void recordHighlightFeedback({
            action: "missed",
            analysisId: artifact.id,
            clipId,
            analysisMode: artifact.mode,
            category: missedCategory,
            currentRange: range,
            nearestCandidateIou: nearestHighlightIou(range, artifact.highlights),
        })
        const feedbackEnabled = isHighlightFeedbackEnabled()
        setWorkspaceIn(null)
        setWorkspaceOut(null)
        setMissedMessage(feedbackEnabled
            ? `見逃し区間 ${formatTime(range.start)}–${formatTime(range.end)} を追加しました`
            : `見逃し区間 ${formatTime(range.start)}–${formatTime(range.end)} を追加しました（評価記録は停止中）`)
        setAgentThinking(feedbackEnabled
            ? "候補になかった見どころをローカル評価へ追加しました"
            : "見どころクリップを追加しました。ローカル評価の記録は停止中です")
    }

    const updateReviewSubtitle = (subtitleId: string, partial: Partial<TextSegment>) => {
        const nextArtifactSubtitles = artifact.subtitles.map((subtitle) =>
            subtitle.id === subtitleId ? { ...subtitle, ...partial } : subtitle
        )
        const nextArtifact = {
            ...artifact,
            subtitles: nextArtifactSubtitles,
            warnings: rebuildWarnings(artifact, nextArtifactSubtitles),
        }
        setAnalysisArtifact(nextArtifact)
        setSubtitles(subtitles.map((subtitle) =>
            subtitle.id === subtitleId ? { ...subtitle, ...partial } : subtitle
        ))
    }

    const markSubtitleConfirmed = (subtitle: TextSegment) => {
        updateReviewSubtitle(subtitle.id, {
            flags: subtitle.flags?.filter((flag) => flag !== "needs_review" && flag !== "low_confidence" && flag !== "possible_hallucination") ?? [],
        })
        setAgentThinking(`字幕を確認済みにしました: ${formatTime(subtitle.start)}`)
    }

    const openSubtitleEditor = (subtitle: TextSegment) => {
        seekMediaRange(subtitle.start, subtitle.end)
        selectEditorItem({ type: "subtitle", id: subtitle.id })
    }

    return (
        <>
        <section className="overflow-hidden rounded-2xl border border-violet-400/15 bg-white/[0.025]">
            <div className="border-b border-white/[0.06] px-3.5 py-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-400/10 text-violet-200">
                            <Scissors className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                            <h3 className="truncate text-[12px] font-semibold text-zinc-100">見どころ判断</h3>
                            <p className="truncate text-[9px] text-zinc-600">AIの根拠を見てKEEP／没を決める</p>
                        </div>
                    </div>
                    <span className="flex-none rounded-full border border-white/[0.06] bg-black/15 px-2 py-1 text-[8px] font-semibold text-zinc-500">
                        {topHighlights.length}候補
                    </span>
                </div>
            </div>

            <div className="space-y-4 p-3.5">
                {signalWarnings.length > 0 && (
                    <div role="alert" className="rounded-xl border border-amber-300/15 bg-amber-300/[0.055] p-2.5 text-[9px] leading-relaxed text-amber-100">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-amber-300" />
                            <div>
                                <p className="font-semibold">一部の解析信号を利用できませんでした</p>
                                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-100/75">
                                    {signalWarnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
                                </ul>
                            </div>
                        </div>
                    </div>
                )}
                <div className="space-y-2">
                    <details className="rounded-xl border border-cyan-300/10 bg-cyan-300/[0.035] p-2.5">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[10px] font-semibold text-cyan-100 [&::-webkit-details-marker]:hidden">
                            <span className="flex items-center gap-1.5"><Flag className="h-3 w-3" />候補にない見どころを追加</span>
                            <span className="font-normal text-zinc-600">ローカル評価</span>
                        </summary>
                        <div className="mt-2.5 space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                                <button type="button" onClick={() => setWorkspaceIn(previewTime)} className="rounded-lg border border-white/[0.07] bg-black/15 px-2 py-1.5 text-[9px] text-zinc-300 hover:border-cyan-300/20">
                                    開始に設定 <span className="font-mono text-zinc-500">{workspaceIn === null ? "—" : formatTime(workspaceIn)}</span>
                                </button>
                                <button type="button" onClick={() => setWorkspaceOut(previewTime)} className="rounded-lg border border-white/[0.07] bg-black/15 px-2 py-1.5 text-[9px] text-zinc-300 hover:border-cyan-300/20">
                                    終了に設定 <span className="font-mono text-zinc-500">{workspaceOut === null ? "—" : formatTime(workspaceOut)}</span>
                                </button>
                            </div>
                            <select value={missedCategory} onChange={(event) => setMissedCategory(event.target.value as MissedHighlightCategory)} aria-label="見どころの種類" className="h-8 w-full rounded-lg border border-white/[0.07] bg-[#0d131b] px-2 text-[9px] text-zinc-300">
                                {Object.entries(MISSED_HIGHLIGHT_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                            <button type="button" onClick={registerMissedHighlight} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.08] text-[10px] font-semibold text-cyan-100 hover:bg-cyan-300/[0.13]">
                                <Flag className="h-3 w-3" />見どころとして追加
                            </button>
                            {missedMessage && <p role="status" className="text-[9px] text-zinc-500">{missedMessage}</p>}
                        </div>
                    </details>

                    <div className="flex items-center justify-between">
                        <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                            <Clock3 className="h-3 w-3" />
                            見どころ候補
                        </h4>
                        {hiddenCandidateIndices.size > 0 ? (
                            <button type="button" onClick={restoreRejectedCandidates} className="text-[9px] text-zinc-500 hover:text-zinc-200">
                                没にした候補を戻す
                            </button>
                        ) : developmentUi ? (
                            <span className="text-[9px] text-zinc-700">{topHighlights.length}/{artifact.highlights.length}</span>
                        ) : null}
                    </div>

                    {topHighlights.length > 0 ? (
                        <div className="grid gap-2 2xl:grid-cols-2">
                            {topHighlights.map(({ highlight, index }) => {
                                const adopted = timelineClips.some((clip) => isCandidateClip(clip, highlight, index))
                                const clipLength = Math.max(0, highlight.end - highlight.start)
                                const locked = Boolean(highlight.isProRequired && !canSeeAllCandidates)

                                if (locked) {
                                    return (
                                        <div key={`${highlight.start}-${highlight.end}-${index}`} className="rounded-xl border border-amber-300/10 bg-amber-300/[0.035] p-3 text-center">
                                            <Crown className="mx-auto h-4 w-4 text-amber-300" />
                                            <p className="mt-1.5 text-[10px] font-semibold text-amber-100">追加候補はCreatorで利用できます</p>
                                            <button type="button" onClick={() => setShowCreatorModal(true)} className="mt-2 rounded-md border border-amber-300/20 px-2 py-1 text-[9px] text-amber-200 hover:bg-amber-300/[0.08]">
                                                Creator機能を見る
                                            </button>
                                        </div>
                                    )
                                }

                                return (
                                    <div key={`${highlight.start}-${highlight.end}-${index}`} className="rounded-xl border border-white/[0.06] bg-black/20 p-2.5">
                                        <div className="flex items-start justify-between gap-2">
                                            <button
                                                type="button"
                                                onClick={() => previewCandidate(highlight, index)}
                                                className="min-w-0 flex-1 text-left"
                                            >
                                                <div className="flex items-center gap-1.5">
                                                    <span className="truncate text-[11px] font-semibold text-zinc-100">{highlight.label}</span>
                                                    <span className="rounded bg-violet-400/10 px-1.5 py-0.5 text-[8px] font-semibold text-violet-200">
                                                        LV.{highlight.excitement}
                                                    </span>
                                                </div>
                                                <p className="mt-1 truncate text-[9px] font-mono text-zinc-500">
                                                    {formatTime(highlight.start)} – {formatTime(highlight.end)} · {clipLength.toFixed(1)}s
                                                </p>
                                                <p data-testid={`highlight-reason-${index}`} className="mt-1.5 line-clamp-2 text-[9px] leading-relaxed text-zinc-400">
                                                    {highlight.reason?.trim() || highlight.evidence?.filter(Boolean).join(" / ") || "候補の根拠はこの解析結果に含まれていません"}
                                                </p>
                                            </button>

                                            <Button
                                                type="button"
                                                size="icon-xs"
                                                variant="ghost"
                                                onClick={() => previewCandidate(highlight, index)}
                                                className="text-zinc-500 hover:text-zinc-100"
                                                title="プレビュー位置へ移動"
                                            >
                                                <Eye className="h-3 w-3" />
                                            </Button>
                                        </div>

                                        {highlight.scoreDetails ? (
                                            <div
                                                className="mt-2 grid grid-cols-4 gap-1 text-center"
                                                title="各観点のスコアと、解析に利用できた信号の充足度です"
                                            >
                                                {([
                                                    ["イベント", highlight.scoreDetails.event],
                                                    ["反応", highlight.scoreDetails.reaction],
                                                    ["編集適性", highlight.scoreDetails.clipability],
                                                    ["信号充足", highlight.scoreDetails.confidence * 100],
                                                ] as const).map(([label, value]) => (
                                                    <div key={label} className="rounded border border-white/[0.05] bg-black/15 px-1 py-1">
                                                        <div className="text-[8px] text-zinc-600">{label}</div>
                                                        <div className="font-mono text-[9px] text-zinc-300">{Math.round(value)}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="mt-2 rounded border border-white/[0.05] bg-black/10 px-2 py-1 text-[8px] text-zinc-600">
                                                信号内訳は未取得です。映像を確認してKEEP／没を判断してください。
                                            </p>
                                        )}

                                        {highlight.scoreDetails && highlight.scoreDetails.confidence < 0.45 && (
                                            <p className="mt-1.5 text-[8px] text-amber-200/80">低信頼候補 · 複数信号が十分に揃っていません</p>
                                        )}

                                        {developmentUi && highlight.category && <p className="mt-2 text-[8px] text-zinc-700">{highlight.category} · risk {Math.round((highlight.falsePositiveRisk ?? 0) * 100)}</p>}

                                        <details className="mt-2 rounded-lg border border-white/[0.05] bg-black/10 px-2 py-1.5">
                                            <summary className="cursor-pointer list-none text-[9px] text-zinc-500 [&::-webkit-details-marker]:hidden">長さを調整</summary>
                                            <TrimButtons onUpdate={(side, delta) => updateHighlight(index, (h) => ({ ...h, [side]: h[side] + delta }))} />
                                        </details>

                                        <button
                                            type="button"
                                            data-testid={`adopt-highlight-${index}`}
                                            onClick={() => toggleAdopt(highlight, index)}
                                            className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[10px] font-semibold transition ${
                                                adopted
                                                    ? "border-zinc-700 bg-zinc-800/70 text-zinc-400 hover:bg-zinc-800"
                                                    : "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-200 hover:bg-emerald-400/[0.13]"
                                            }`}
                                        >
                                            {adopted ? <CheckCircle2 className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                                            {adopted ? "KEEP済み / 解除する" : "KEEP（残す）"}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => rejectCandidate(highlight, index)}
                                            className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/[0.06] px-2 py-1.5 text-[9px] font-medium text-zinc-500 transition hover:border-red-300/15 hover:text-red-200"
                                        >
                                            <X className="h-3 w-3" />
                                            没（使わない）
                                        </button>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <div className="rounded-xl border border-dashed border-white/[0.08] p-3 text-center text-[10px] text-zinc-600">
                            まだカット候補がありません
                        </div>
                    )}
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                            <Subtitles className="h-3 w-3" />
                            字幕確認
                        </h4>
                        <span className={`text-[9px] ${reviewSubtitles.length > 0 ? "text-amber-300" : "text-emerald-300"}`}>
                            {reviewSubtitles.length > 0 ? `${reviewSubtitles.length}件 要確認` : "要確認なし"}
                        </span>
                    </div>

                    {reviewSubtitles.length > 0 ? (
                        <div className="custom-scrollbar grid max-h-[360px] gap-2 overflow-y-auto pr-1 2xl:grid-cols-2">
                            {reviewSubtitles.map((subtitle) => {
                                const allSubtitleIndex = subtitles.findIndex((item) => item.id === subtitle.id)
                                const sequenceRange = mediaRangeToSequenceRanges(timelineClips, subtitle.start, subtitle.end)[0]
                                const reason = subtitle.flags?.includes("possible_hallucination")
                                    ? "誤認識の可能性"
                                    : subtitle.flags?.includes("low_confidence")
                                        ? "信頼度が低い"
                                        : "内容を確認"
                                return (
                                <div key={subtitle.id} className="rounded-xl border border-amber-300/20 bg-amber-300/[0.055] p-2.5">
                                    <div className="mb-1.5 flex items-center justify-between gap-2">
                                        <button
                                            type="button"
                                            onClick={() => openSubtitleEditor(subtitle)}
                                            className="flex min-w-0 items-center gap-1.5 text-left text-[9px] text-amber-100 hover:text-white"
                                        >
                                            <AlertTriangle className="h-3 w-3 flex-none" />
                                            <span className="font-semibold">字幕 #{allSubtitleIndex >= 0 ? allSubtitleIndex + 1 : "?"}</span>
                                            <span className="truncate font-mono text-amber-200/65">{formatTime(subtitle.start)}</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => markSubtitleConfirmed(subtitle)}
                                            className="rounded-md bg-emerald-400/10 px-2 py-1 text-[9px] font-medium text-emerald-200 hover:bg-emerald-400/15"
                                        >
                                            確認済み
                                        </button>
                                    </div>
                                    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[8px]">
                                        <span className="rounded bg-amber-300/10 px-1.5 py-0.5 text-amber-200">{reason}</span>
                                        <span className={sequenceRange ? "text-cyan-200/70" : "text-zinc-600"}>
                                            {sequenceRange
                                                ? `タイムライン ${formatTime(sequenceRange.sequenceStart)}`
                                                : "現在のKEEP区間外"}
                                        </span>
                                        {subtitle.confidence !== undefined && (
                                            <span className="text-zinc-600">信頼度 {Math.round(subtitle.confidence * 100)}%</span>
                                        )}
                                    </div>
                                    <textarea
                                        value={subtitle.text}
                                        onChange={(e) => updateReviewSubtitle(subtitle.id, { text: e.target.value })}
                                        rows={2}
                                        className="w-full resize-y rounded-lg border border-amber-300/10 bg-black/25 px-2.5 py-1.5 text-[11px] leading-relaxed text-zinc-100 outline-none focus:border-amber-300/30"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => openSubtitleEditor(subtitle)}
                                        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-cyan-300/10 bg-cyan-300/[0.04] py-1.5 text-[9px] font-medium text-cyan-100/80 hover:bg-cyan-300/[0.08]"
                                    >
                                        <Eye className="h-3 w-3" />
                                        この位置へ移動して編集
                                    </button>
                                </div>
                            )})}
                        </div>
                    ) : (
                        <div className="rounded-xl border border-emerald-400/10 bg-emerald-400/[0.035] px-3 py-2 text-[10px] text-emerald-200/70">
                            要確認字幕はありません。
                        </div>
                    )}
                </div>
            </div>
        </section>
        <CreatorUpgradeModal
            isOpen={showCreatorModal}
            onClose={() => setShowCreatorModal(false)}
            featureName="追加の見どころ候補"
        />
        </>
    )
}

function TimeButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="rounded-md border border-white/[0.06] bg-white/[0.035] px-1.5 py-1 text-[9px] font-medium text-zinc-400 transition hover:border-violet-300/20 hover:bg-violet-300/[0.08] hover:text-violet-100"
        >
            {label}
        </button>
    )
}

function TrimButtons({ onUpdate }: { onUpdate: (side: "start" | "end", delta: number) => void }) {
    return (
        <div className="mt-2 grid grid-cols-4 gap-1">
            <TimeButton label="前+1s" onClick={() => onUpdate("start", -1)} />
            <TimeButton label="前-1s" onClick={() => onUpdate("start", 1)} />
            <TimeButton label="後-1s" onClick={() => onUpdate("end", -1)} />
            <TimeButton label="後+1s" onClick={() => onUpdate("end", 1)} />
        </div>
    )
}
