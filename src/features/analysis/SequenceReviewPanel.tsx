import {
    ArrowDown,
    ArrowUp,
    Clock3,
    Eye,
    Film,
    ListOrdered,
    Subtitles,
    Trash2,
    Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useDocumentStore } from "@/stores/document"
import { useEditorStore } from "@/stores/editor"
import type { AgentHighlight, TimelineClip } from "@/lib/types"
import {
    getSequenceDuration,
    layoutTimelineClips,
    mediaRangeToSequenceRanges,
    subtitlesToSequence,
    type TimelineLayoutClip,
} from "@/lib/timeline"

function formatTime(seconds: number) {
    const minutes = Math.floor(seconds / 60)
    const rest = (seconds % 60).toFixed(1).padStart(4, "0")
    return `${minutes}:${rest}`
}

function isOriginalOnly(clips: TimelineClip[], duration: number) {
    return clips.length === 1 &&
        !clips[0].isGap &&
        clips[0].mediaStart === 0 &&
        Math.abs(clips[0].mediaEnd - duration) < 0.1
}

function overlapScore(clip: TimelineClip, highlight: AgentHighlight) {
    if (clip.isGap) return 0
    const overlap = Math.max(0, Math.min(clip.mediaEnd, highlight.end) - Math.max(clip.mediaStart, highlight.start))
    const base = Math.max(1, Math.min(clip.mediaEnd - clip.mediaStart, highlight.end - highlight.start))
    return overlap / base
}

function findMatchedHighlight(clip: TimelineClip, highlights: AgentHighlight[]) {
    let best: { highlight: AgentHighlight; score: number } | null = null
    for (const highlight of highlights) {
        const score = overlapScore(clip, highlight)
        if (!best || score > best.score) best = { highlight, score }
    }
    return best && best.score >= 0.5 ? best.highlight : null
}

function getClipLabel(clip: TimelineClip, highlight: AgentHighlight | null) {
    return clip.label || (highlight ? `AI: ${highlight.label}` : "Clip")
}

export function SequenceReviewPanel() {
    const timelineClips = useDocumentStore((s) => s.timelineClips)
    const setTimelineClips = useDocumentStore((s) => s.setTimelineClips)
    const setPreviewTime = useEditorStore((s) => s.setPreviewTime)
    const setIsPlaying = useEditorStore((s) => s.setIsPlaying)
    const recommendedCuts = useDocumentStore((s) => s.recommendedCuts)
    const subtitles = useDocumentStore((s) => s.subtitles)
    const duration = useDocumentStore((s) => s.videoInfo?.duration ?? 0)
    const setAgentThinking = useDocumentStore((s) => s.setAgentThinking)

    const hasWorkingSequence = timelineClips.length > 0 && !isOriginalOnly(timelineClips, duration)
    const layoutClips = hasWorkingSequence
        ? layoutTimelineClips(timelineClips).filter((clip) => !clip.isGap)
        : []
    const totalDuration = hasWorkingSequence ? getSequenceDuration(timelineClips) : 0
    const sequenceSubtitles = hasWorkingSequence ? subtitlesToSequence(timelineClips, subtitles) : []
    const reviewSubtitleCount = hasWorkingSequence
        ? subtitles.filter((subtitle) =>
            subtitle.flags?.includes("needs_review") &&
            mediaRangeToSequenceRanges(timelineClips, subtitle.start, subtitle.end).length > 0
        ).length
        : 0

    const seekSequence = (sequenceTime: number) => {
        setIsPlaying(false)
        setPreviewTime(sequenceTime)
    }

    const moveClip = (clipId: string, direction: -1 | 1) => {
        const index = timelineClips.findIndex((clip) => clip.id === clipId)
        const targetIndex = index + direction
        if (index < 0 || targetIndex < 0 || targetIndex >= timelineClips.length) return
        const next = [...timelineClips]
        const [moved] = next.splice(index, 1)
        next.splice(targetIndex, 0, moved)
        setTimelineClips(next)
        setAgentThinking(`ラフカットの並びを変更しました: ${index + 1} → ${targetIndex + 1}`)
    }

    const removeClip = (clipId: string) => {
        const target = timelineClips.find((clip) => clip.id === clipId)
        setTimelineClips(timelineClips.filter((clip) => clip.id !== clipId))
        if (target) {
            setAgentThinking(`KEEP区間を没にしました: ${formatTime(target.mediaStart)} – ${formatTime(target.mediaEnd)}`)
        }
    }

    const sortBySourceTime = () => {
        const next = timelineClips
            .filter((clip) => !clip.isGap)
            .sort((a, b) => a.mediaStart - b.mediaStart)
        setTimelineClips(next)
        setAgentThinking("ラフカットを元動画の時系列順に並べました")
    }

    const sortByExcitement = () => {
        const next = timelineClips
            .filter((clip) => !clip.isGap)
            .sort((a, b) => {
                const scoreA = findMatchedHighlight(a, recommendedCuts)?.excitement ?? 0
                const scoreB = findMatchedHighlight(b, recommendedCuts)?.excitement ?? 0
                return scoreB - scoreA
            })
        setTimelineClips(next)
        setAgentThinking("ラフカットを盛り上がり順に並べました")
    }

    return (
        <section className="overflow-hidden rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.025]">
            <div className="border-b border-white/[0.06] px-3.5 py-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-200">
                            <Film className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                            <h3 className="text-[12px] font-semibold text-zinc-100">KEEP区間の並び</h3>
                            <p className="text-[9px] text-zinc-600">採用済みクリップだけを完成順で確認</p>
                        </div>
                    </div>

                    {hasWorkingSequence && (
                        <span className="rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-2 py-1 text-[9px] font-semibold text-emerald-200">
                            {layoutClips.length} clips
                        </span>
                    )}
                </div>
            </div>

            {hasWorkingSequence ? (
                <div className="space-y-3 p-3.5">
                    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.06]">
                        <Metric icon={<Clock3 className="h-3 w-3" />} label="完成尺" value={formatTime(totalDuration)} />
                        <Metric icon={<Subtitles className="h-3 w-3" />} label="字幕" value={`${sequenceSubtitles.length}`} />
                        <Metric icon={<Zap className="h-3 w-3" />} label="要確認" value={`${reviewSubtitleCount}`} tone={reviewSubtitleCount > 0 ? "warn" : "normal"} />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={sortBySourceTime}
                            className="flex items-center justify-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.035] px-2 py-1.5 text-[10px] font-medium text-zinc-400 hover:border-emerald-300/20 hover:bg-emerald-300/[0.07] hover:text-emerald-100"
                        >
                            <ListOrdered className="h-3 w-3" />
                            時系列順
                        </button>
                        <button
                            type="button"
                            onClick={sortByExcitement}
                            className="flex items-center justify-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.035] px-2 py-1.5 text-[10px] font-medium text-zinc-400 hover:border-emerald-300/20 hover:bg-emerald-300/[0.07] hover:text-emerald-100"
                        >
                            <Zap className="h-3 w-3" />
                            盛り上がり順
                        </button>
                    </div>

                    <div className="space-y-2">
                        {layoutClips.map((clip, index) => (
                            <SequenceClipCard
                                key={clip.id}
                                clip={clip}
                                index={index}
                                total={layoutClips.length}
                                highlight={findMatchedHighlight(clip, recommendedCuts)}
                                onSeek={() => seekSequence(clip.sequenceStart)}
                                onMoveUp={() => moveClip(clip.id, -1)}
                                onMoveDown={() => moveClip(clip.id, 1)}
                                onRemove={() => removeClip(clip.id)}
                            />
                        ))}
                    </div>
                </div>
            ) : (
                <div className="p-3.5">
                    <div className="rounded-xl border border-dashed border-emerald-300/15 bg-emerald-300/[0.035] p-4 text-center">
                        <p className="text-[11px] font-medium text-emerald-100">まだKEEP区間はありません</p>
                        <p className="mt-1.5 text-[9px] leading-relaxed text-emerald-200/50">
                            上の「AI初稿レビュー」で候補を採用すると、ここに完成順で並びます。
                        </p>
                    </div>
                </div>
            )}
        </section>
    )
}

function SequenceClipCard({
    clip,
    index,
    total,
    highlight,
    onSeek,
    onMoveUp,
    onMoveDown,
    onRemove,
}: {
    clip: TimelineLayoutClip
    index: number
    total: number
    highlight: AgentHighlight | null
    onSeek: () => void
    onMoveUp: () => void
    onMoveDown: () => void
    onRemove: () => void
}) {
    const duration = Math.max(0, clip.mediaEnd - clip.mediaStart)

    return (
        <div className="rounded-xl border border-white/[0.06] bg-black/20 p-2.5">
            <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={onSeek} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-1.5">
                        <span className="flex h-5 w-5 flex-none items-center justify-center rounded-md bg-emerald-400/10 text-[10px] font-semibold text-emerald-200">
                            {index + 1}
                        </span>
                        <span className="truncate text-[11px] font-semibold text-zinc-100">
                            {getClipLabel(clip, highlight)}
                        </span>
                        {highlight && (
                            <span className="rounded bg-red-400/10 px-1.5 py-0.5 text-[8px] font-semibold text-red-300">
                                LV.{highlight.excitement}
                            </span>
                        )}
                    </div>
                    <p className="mt-1 text-[9px] font-mono text-zinc-500">
                        Seq {formatTime(clip.sequenceStart)} · Src {formatTime(clip.mediaStart)} – {formatTime(clip.mediaEnd)} · {duration.toFixed(1)}s
                    </p>
                </button>

                <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    onClick={onSeek}
                    className="text-zinc-500 hover:text-zinc-100"
                    title="このクリップへ移動"
                >
                    <Eye className="h-3 w-3" />
                </Button>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-1">
                <button
                    type="button"
                    onClick={onMoveUp}
                    disabled={index === 0}
                    className="flex items-center justify-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.035] px-1.5 py-1 text-[9px] text-zinc-400 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-30"
                >
                    <ArrowUp className="h-3 w-3" />
                    上へ
                </button>
                <button
                    type="button"
                    onClick={onMoveDown}
                    disabled={index >= total - 1}
                    className="flex items-center justify-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.035] px-1.5 py-1 text-[9px] text-zinc-400 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-30"
                >
                    <ArrowDown className="h-3 w-3" />
                    下へ
                </button>
                <button
                    type="button"
                    onClick={onRemove}
                    className="flex items-center justify-center gap-1 rounded-md border border-red-400/10 bg-red-400/[0.035] px-1.5 py-1 text-[9px] text-red-300/80 hover:bg-red-400/[0.08] hover:text-red-200"
                >
                    <Trash2 className="h-3 w-3" />
                    削除
                </button>
            </div>
        </div>
    )
}

function Metric({
    icon,
    label,
    value,
    tone = "normal",
}: {
    icon: React.ReactNode
    label: string
    value: string
    tone?: "normal" | "warn"
}) {
    return (
        <div className="bg-[#101114] px-3 py-2.5">
            <div className={`mb-1 flex items-center gap-1.5 text-[9px] ${tone === "warn" ? "text-amber-300/80" : "text-zinc-600"}`}>
                {icon}
                {label}
            </div>
            <div className={`font-mono text-[14px] font-semibold ${tone === "warn" ? "text-amber-200" : "text-zinc-100"}`}>
                {value}
            </div>
        </div>
    )
}
