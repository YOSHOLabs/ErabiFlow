import { AlertTriangle, Captions, FileClock, RefreshCw, Sparkles, SplitSquareHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { AnalysisArtifact, AnalysisMode } from "@/lib/analysisArtifact"
import { useDocumentStore } from "@/stores/document"

const MODE_LABEL: Record<AnalysisMode, string> = {
    fast: "高速解析",
    subtitle: "字幕生成",
}

function formatCreatedAt(iso: string): string {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return "日時不明"
    return new Intl.DateTimeFormat("ja-JP", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date)
}

function summarizeTracks(artifact: AnalysisArtifact): string {
    if (artifact.trackInfo) {
        const voice = artifact.trackInfo.voiceTracks.length > 0
            ? artifact.trackInfo.voiceTracks.map((track) => `Tr.${track}`).join(",")
            : "未特定"
        const game = artifact.trackInfo.gameTracks.length > 0
            ? artifact.trackInfo.gameTracks.map((track) => `Tr.${track}`).join(",")
            : "なし"
        return `声 ${voice} / ゲーム ${game}`
    }

    const counts = new Map<number, number>()
    for (const subtitle of artifact.subtitles) {
        if (subtitle.sourceTrack === undefined) continue
        counts.set(subtitle.sourceTrack, (counts.get(subtitle.sourceTrack) ?? 0) + 1)
    }
    if (counts.size === 0) return "未取得"

    return Array.from(counts.entries())
        .sort(([a], [b]) => a - b)
        .map(([track, count]) => `Tr.${track}: ${count}`)
        .join(" / ")
}

function summarizeTrackStats(artifact: AnalysisArtifact): string[] {
    return artifact.trackInfo?.trackStats.map((track) => {
        const silence = track.silenceRatio === undefined || track.silenceRatio === null
            ? "無音率 --"
            : `無音率 ${Math.round(track.silenceRatio * 100)}%`
        const rms = track.rms === undefined || track.rms === null
            ? "RMS --"
            : `RMS ${track.rms.toFixed(4)}`
        const role = track.role === "voice" ? "声" : track.role === "game" ? "ゲーム" : track.role
        return `Tr.${track.track} ${role} · ${silence} · ${rms}`
    }) ?? []
}

function averageConfidence(artifact: AnalysisArtifact): number | null {
    const values = artifact.subtitles
        .map((subtitle) => subtitle.confidence)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    if (values.length === 0) return null
    return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function AnalysisArtifactPanel() {
    const artifacts = useDocumentStore((s) => s.analysisArtifacts)
    const activeAnalysisId = useDocumentStore((s) => s.activeAnalysisId)
    const setAnalysisArtifact = useDocumentStore((s) => s.setAnalysisArtifact)
    const setRecommendedCuts = useDocumentStore((s) => s.setRecommendedCuts)
    const clearRejectedHighlightCandidates = useDocumentStore((s) => s.clearRejectedHighlightCandidates)
    const setSubtitles = useDocumentStore((s) => s.setSubtitles)
    const setExcitementGraph = useDocumentStore((s) => s.setExcitementGraph)
    const setAgentThinking = useDocumentStore((s) => s.setAgentThinking)

    const artifact = artifacts.find((item) => item.id === activeAnalysisId) ?? artifacts[0]
    if (!artifact) return null

    const confidence = averageConfidence(artifact)
    const trackStats = summarizeTrackStats(artifact)
    const reviewCount = artifact.subtitles.filter((subtitle) => subtitle.flags?.includes("needs_review")).length
    const persistentWarnings = artifact.warnings.filter((warning) => !warning.includes("字幕に確認フラグ"))
    const warningMessages = reviewCount > 0
        ? [`${reviewCount}件の字幕に確認フラグがあります`, ...persistentWarnings]
        : persistentWarnings
    const warningCount = warningMessages.length
    const analysisBasis = artifact.signalSummary?.visualChange
        ? `音声 + 映像変化${artifact.signalSummary.visualSampling === "keyframes" ? "（長尺サンプル）" : ""}`
        : artifact.signalSummary?.perceptualLoudness
            ? "音声 + 知覚音量"
            : "音声ベース"

    const applyArtifact = () => {
        clearRejectedHighlightCandidates()
        setAnalysisArtifact(artifact)
        setRecommendedCuts(artifact.highlights)
        setSubtitles(artifact.subtitles)
        setExcitementGraph(artifact.excitementGraph)
        setAgentThinking(
            `${MODE_LABEL[artifact.mode]}の初稿を再適用: ` +
            `${artifact.highlights.length}候補 / ${artifact.subtitles.length}字幕`
        )
    }

    return (
        <section className="overflow-hidden rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.035]">
            <div className="border-b border-white/[0.06] px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-200">
                            <FileClock className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h3 className="text-[12px] font-semibold text-cyan-50">最新AI初稿</h3>
                                <span className="rounded-full border border-cyan-300/15 px-1.5 py-0.5 text-[8px] font-semibold tracking-wider text-cyan-300/70">
                                    {MODE_LABEL[artifact.mode]}
                                </span>
                            </div>
                            <p className="mt-1 text-[9px] text-cyan-300/45">
                                {formatCreatedAt(artifact.createdAt)} · {analysisBasis}
                                {artifact.gameContext?.glossaryApplied
                                    ? ` · ${artifact.gameContext.label}用語 ${artifact.gameContext.refinementCount ?? 0}件`
                                    : " · ゲーム用語なし"}
                            </p>
                        </div>
                    </div>

                    <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={applyArtifact}
                        className="h-7 flex-none border-cyan-300/15 bg-cyan-300/[0.06] text-[10px] text-cyan-100 hover:bg-cyan-300/[0.12]"
                    >
                        <RefreshCw className="h-3 w-3" />
                        再適用
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-px bg-white/[0.06]">
                <Metric
                    icon={<Sparkles className="h-3 w-3" />}
                    label="候補"
                    value={`${artifact.highlights.length}`}
                />
                <Metric
                    icon={<Captions className="h-3 w-3" />}
                    label="字幕"
                    value={`${artifact.subtitles.length}`}
                />
                <Metric
                    icon={<AlertTriangle className="h-3 w-3" />}
                    label="要確認"
                    value={`${warningCount}`}
                    tone={warningCount > 0 ? "warn" : "normal"}
                />
            </div>

            <div className="space-y-2.5 px-3.5 py-3">
                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/15 px-3 py-2">
                    <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                        <SplitSquareHorizontal className="h-3 w-3" />
                        字幕トラック
                    </span>
                    <span className="truncate text-right text-[10px] font-medium text-zinc-300">
                        {summarizeTracks(artifact)}
                    </span>
                </div>

                {trackStats.length > 0 && (
                    <div className="space-y-1 rounded-xl border border-white/[0.05] bg-black/10 px-3 py-2">
                        {trackStats.map((line) => (
                            <div key={line} className="truncate text-[8px] font-mono text-zinc-600">
                                {line}
                            </div>
                        ))}
                    </div>
                )}

                <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[10px]">
                        <span className="text-zinc-500">字幕平均信頼度</span>
                        <span className={confidence !== null && confidence < 0.55 ? "text-amber-300" : "text-emerald-300"}>
                            {confidence === null ? "未取得" : `${Math.round(confidence * 100)}%`}
                        </span>
                    </div>
                    {confidence !== null && (
                        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                            <div
                                className={`h-full rounded-full ${confidence < 0.55 ? "bg-amber-400" : "bg-emerald-400"}`}
                                style={{ width: `${Math.max(4, Math.min(100, confidence * 100))}%` }}
                            />
                        </div>
                    )}
                </div>

                {warningMessages.length > 0 && (
                    <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.055] p-2.5">
                        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-amber-200">
                            <AlertTriangle className="h-3 w-3" />
                            確認ポイント
                        </div>
                        <ul className="space-y-1">
                            {warningMessages.slice(0, 3).map((warning) => (
                                <li key={warning} className="text-[9px] leading-relaxed text-amber-100/70">
                                    {warning}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </section>
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
            <div className={`font-mono text-[15px] font-semibold ${tone === "warn" ? "text-amber-200" : "text-zinc-100"}`}>
                {value}
            </div>
        </div>
    )
}
