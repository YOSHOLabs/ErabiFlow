import { AlertTriangle, CheckCircle2, CircleDot, ClipboardList, Lock } from "lucide-react"
import { useDocumentStore } from "@/stores/document"
import { computeWorkflowSummary, type WorkflowStep, type WorkflowStepId } from "@/lib/workflow"
import type { AnalysisJob, AnalysisStageStatus } from "@/lib/analysisJob"
import { AnalysisArtifactPanel } from "./AnalysisArtifactPanel"
import { DraftReviewPanel } from "./DraftReviewPanel"
import { ProgressOverlay } from "./ProgressOverlay"
import { SequenceReviewPanel } from "./SequenceReviewPanel"
import { useAnalysisController } from "./AnalysisControllerContext"
import { useWhisperModel } from "@/hooks/useWhisperModel"
import { WhisperModelSetupCard } from "@/features/setup/WhisperModelSetupCard"

const STAGE_STYLE: Record<WorkflowStep["state"], string> = {
    complete: "border-emerald-400/15 bg-emerald-400/[0.035]",
    attention: "border-amber-300/18 bg-amber-300/[0.04]",
    active: "border-cyan-400/18 bg-cyan-400/[0.035]",
    locked: "border-white/[0.06] bg-white/[0.018] opacity-75",
}

const STATUS_LABEL: Record<WorkflowStep["state"], string> = {
    complete: "完了",
    attention: "確認",
    active: "次にやる",
    locked: "待機",
}

const JOB_STATUS_LABEL: Record<AnalysisJob["status"], string> = {
    queued: "待機",
    running: "解析中",
    cancelling: "停止中",
    success: "完了",
    error: "失敗",
    cancelled: "キャンセル",
}

const JOB_STATUS_STYLE: Record<AnalysisJob["status"], string> = {
    queued: "border-white/[0.08] text-zinc-400",
    running: "border-cyan-300/20 bg-cyan-300/[0.05] text-cyan-100",
    cancelling: "border-amber-300/20 bg-amber-300/[0.05] text-amber-100",
    success: "border-emerald-300/20 bg-emerald-300/[0.05] text-emerald-100",
    error: "border-red-300/20 bg-red-300/[0.05] text-red-100",
    cancelled: "border-amber-300/20 bg-amber-300/[0.05] text-amber-100",
}

const STAGE_DOT_STYLE: Record<AnalysisStageStatus, string> = {
    pending: "bg-zinc-700",
    running: "bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.45)]",
    complete: "bg-emerald-300",
    error: "bg-red-300",
    skipped: "bg-zinc-500",
}

function getStep(steps: WorkflowStep[], id: WorkflowStepId) {
    return steps.find((step) => step.id === id) ?? steps[0]
}

function StatusIcon({ state }: { state: WorkflowStep["state"] }) {
    if (state === "complete") return <CheckCircle2 className="h-3.5 w-3.5" />
    if (state === "attention") return <AlertTriangle className="h-3.5 w-3.5" />
    if (state === "locked") return <Lock className="h-3.5 w-3.5" />
    return <CircleDot className="h-3.5 w-3.5" />
}

function StageSection({
    step,
    children,
}: {
    step: WorkflowStep
    children: React.ReactNode
}) {
    return (
        <section className={`overflow-hidden rounded-2xl border ${STAGE_STYLE[step.state]}`}>
            <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-3.5 py-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-white/[0.05] text-zinc-300">
                            <StatusIcon state={step.state} />
                        </span>
                        <div className="min-w-0">
                            <h3 className="truncate text-[12px] font-semibold text-zinc-100">{step.label}</h3>
                            <p className="mt-0.5 text-[9px] leading-relaxed text-zinc-600">{step.description}</p>
                        </div>
                    </div>
                </div>
                <div className="flex flex-none flex-col items-end gap-1">
                    <span className="rounded-full border border-white/[0.08] bg-black/15 px-2 py-1 text-[8px] font-semibold tracking-wider text-zinc-400">
                        {STATUS_LABEL[step.state]}
                    </span>
                    <span className="font-mono text-[9px] text-zinc-600">{step.metric}</span>
                </div>
            </div>
            <div className="space-y-3.5 p-3.5">
                {children}
            </div>
        </section>
    )
}

function EmptyStage({
    title,
    detail,
}: {
    title: string
    detail: string
}) {
    return (
        <div className="rounded-xl border border-dashed border-white/[0.08] bg-black/10 p-4 text-center">
            <p className="text-[11px] font-medium text-zinc-300">{title}</p>
            <p className="mt-1.5 text-[9px] leading-relaxed text-zinc-600">{detail}</p>
        </div>
    )
}

function StatPill({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border border-white/[0.06] bg-black/15 px-3 py-2">
            <div className="text-[8px] font-semibold uppercase tracking-[0.14em] text-zinc-700">{label}</div>
            <div className="mt-1 font-mono text-[12px] font-semibold text-zinc-200">{value}</div>
        </div>
    )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-white/[0.06] bg-black/15 px-2 py-1.5 text-center">
            <div className="font-mono text-[12px] font-semibold text-zinc-200">{value}</div>
            <div className="mt-0.5 text-[8px] text-zinc-700">{label}</div>
        </div>
    )
}

function formatTime(iso: string | null) {
    if (!iso) return "--:--"
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return "--:--"
    return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function createJobDiagnosticText(job: AnalysisJob) {
    const currentStage = job.stages.find((stage) => stage.id === job.currentStageId)
    return [
        "TateClip Analysis Job",
        `jobId: ${job.id}`,
        `mode: ${job.mode}`,
        `status: ${job.status}`,
        `progress: ${Math.round(job.progress * 100)}%`,
        `currentStage: ${currentStage?.label ?? job.currentStageId}`,
        `createdAt: ${job.createdAt}`,
        `finishedAt: ${job.finishedAt ?? "none"}`,
        `lastError: ${job.lastError ?? "none"}`,
        "",
        "[Stages]",
        ...job.stages.map((stage) => `- ${stage.status}: ${stage.id} / ${stage.message || stage.description}`),
        "",
        "[Logs]",
        ...job.logs.slice(-40).map((log) => `${log.at} ${log.level} ${log.stageId ?? "general"}: ${log.message}`),
    ].join("\n")
}

function AnalysisJobPanel({
    job,
    isCancelable = false,
    onCancel,
}: {
    job: AnalysisJob | null
    isCancelable?: boolean
    onCancel?: () => void
}) {
    if (!job) {
        return null
    }

    const currentStage = job.stages.find((stage) => stage.id === job.currentStageId)
    const logPreview = job.logs.slice(-5)

    const copyLog = () => {
        void navigator.clipboard?.writeText(createJobDiagnosticText(job))
    }

    return (
        <section className="rounded-xl border border-cyan-300/10 bg-cyan-300/[0.025] p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-cyan-300/10 text-cyan-200">
                            <ClipboardList className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                            <h3 className="truncate text-[11px] font-semibold text-zinc-100">{currentStage?.label ?? "解析中"}</h3>
                            <p className="mt-0.5 truncate text-[9px] text-zinc-600">
                                {formatTime(job.startedAt)} 開始 · {currentStage?.label ?? "工程確認中"}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex flex-none items-center gap-2">
                    <span className={`rounded-full border px-2 py-1 text-[8px] font-semibold ${JOB_STATUS_STYLE[job.status]}`}>
                        {JOB_STATUS_LABEL[job.status]}
                    </span>
                    {isCancelable && (
                        <button
                            type="button"
                            onClick={onCancel}
                            className="rounded-full border border-red-300/15 bg-red-300/[0.04] px-2 py-1 text-[8px] font-semibold text-red-200 transition hover:bg-red-300/[0.08]"
                        >
                            キャンセル
                        </button>
                    )}
                </div>
            </div>

            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                <div
                    className="h-full rounded-full bg-cyan-300 transition-all"
                    style={{ width: `${Math.round(job.progress * 100)}%` }}
                />
            </div>

            {currentStage && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-black/10 px-2.5 py-2">
                    <span className={`mt-1 h-2 w-2 flex-none rounded-full ${STAGE_DOT_STYLE[currentStage.status]}`} />
                    <div className="min-w-0">
                        <p className="truncate text-[10px] font-medium text-zinc-200">{currentStage.label}</p>
                        <p className="mt-0.5 line-clamp-2 break-words text-[9px] leading-relaxed text-zinc-600">
                            {currentStage.message || currentStage.description}
                        </p>
                    </div>
                </div>
            )}

            {job.lastError && (
                <div className="mt-3 rounded-lg border border-red-400/15 bg-red-400/[0.05] p-2.5 text-[9px] leading-relaxed text-red-200">
                    停止位置: {currentStage?.label ?? job.currentStageId} · {job.lastError}
                </div>
            )}

            {import.meta.env.DEV && (job.stages.length > 0 || logPreview.length > 0) && (
                <details className="mt-2 group">
                    <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 py-1.5 text-[9px] font-semibold text-zinc-500 transition hover:text-cyan-200">
                        工程とログ
                        <button
                            type="button"
                            onClick={(event) => {
                                event.preventDefault()
                                copyLog()
                            }}
                            className="rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[8px] text-zinc-500 hover:text-cyan-200"
                        >
                            コピー
                        </button>
                    </summary>

                    <div className="mt-2 grid gap-1.5">
                        {job.stages.map((stage) => (
                            <div key={stage.id} className="flex items-start gap-2 rounded-lg bg-black/10 px-2.5 py-1.5">
                                <span className={`mt-1 h-2 w-2 flex-none rounded-full ${STAGE_DOT_STYLE[stage.status]}`} />
                                <span className="w-16 flex-none text-[9px] font-medium text-zinc-300">{stage.label}</span>
                                <span className="min-w-0 break-words text-[8px] leading-relaxed text-zinc-600">
                                    {stage.message || stage.description}
                                </span>
                            </div>
                        ))}
                    </div>

                    {logPreview.length > 0 && (
                        <div className="mt-2 space-y-1 rounded-xl border border-white/[0.05] bg-black/10 p-2.5">
                            {logPreview.map((log) => (
                                <div key={log.id} className="flex gap-2 text-[8px] leading-relaxed">
                                    <span className="flex-none font-mono text-zinc-700">{formatTime(log.at)}</span>
                                    <span className={`min-w-0 break-words ${log.level === "error" ? "text-red-300" : "text-zinc-500"}`}>
                                        {log.message}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </details>
            )}
        </section>
    )
}

export function AnalysisPanel() {
    const developmentUi = import.meta.env.DEV
    const document = useDocumentStore((state) => state)
    const { inputPath, recommendedCuts, subtitles } = document
    const analysisGameId = document.processing.analysisGameId
    const activeArtifact = document.analysisArtifacts.find((item) => item.id === document.activeAnalysisId)
    const activeJob = document.analysisJobs.find((job) => job.id === document.activeAnalysisJobId) ?? document.analysisJobs[0] ?? null
    const workflow = computeWorkflowSummary(document)
    const whisperModel = useWhisperModel()
    const analysisStep = getStep(workflow.steps, "analysis")
    const reviewStep = getStep(workflow.steps, "review")
    const editStep = getStep(workflow.steps, "edit")

    const controller = useAnalysisController()
    const {
        daemonProgress,
        daemonMessage,
    } = controller

    const isAnalysisProgressDemo = import.meta.env.DEV
        && new URLSearchParams(window.location.search).get("demo") === "analysis-progress"
    const isAnalyzing = controller.isAnalyzing || isAnalysisProgressDemo
    const analysisError = controller.analysisError
    const hasDraft = workflow.stats.hasAnalysisDraft
    const hasAdoptedSequence = workflow.stats.adoptedClipCount > 0
    const cancelAnalysis = controller.cancel
    const currentJobStage = activeJob?.stages.find((stage) => stage.id === activeJob.currentStageId)
    const visibleJob = isAnalyzing || activeJob?.status === "error" || activeJob?.status === "cancelled"
        ? activeJob
        : null
    const statusLabel = isAnalyzing
        ? currentJobStage?.label ?? "解析中"
        : hasDraft
            ? `${recommendedCuts.length}候補 · ${subtitles.length}字幕`
            : "未解析"
    const visibleProgress = activeJob?.status === "running" || activeJob?.status === "cancelling"
        ? Math.max(daemonProgress, activeJob.progress)
        : daemonProgress
    const visibleProgressMessage = currentJobStage?.message || daemonMessage
    const gameSelector = (
        <label className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/10 px-2.5 py-1.5">
            <span className="min-w-0">
                <span className="block text-[9px] font-semibold text-zinc-400">ゲーム用語</span>
                <span className="block truncate text-[8px] text-zinc-600">
                    {activeArtifact?.gameContext?.glossaryApplied
                        ? `${activeArtifact.gameContext.label} · ${activeArtifact.gameContext.refinementCount ?? 0}件再判定`
                        : "低信頼字幕へ使用"}
                </span>
            </span>
            <select
                value={analysisGameId}
                disabled={isAnalyzing}
                onChange={(event) => document.setProcessing({ analysisGameId: event.target.value })}
                className="h-7 max-w-[112px] rounded-md border border-white/[0.08] bg-zinc-950 px-2 text-[9px] text-zinc-300 outline-none focus:border-cyan-300/30 disabled:opacity-50"
                aria-label="字幕用ゲーム選択"
            >
                <option value="auto">自動判定</option>
                <option value="none">用語集なし</option>
                <option value="valorant">VALORANT</option>
            </select>
        </label>
    )

    return (
        <>
            <div className="grid gap-3 xl:grid-cols-[320px_minmax(0,1fr)]">
                <div className="min-w-0 space-y-3">
                    <WhisperModelSetupCard model={whisperModel} />

                    <section className="rounded-2xl border border-violet-400/15 bg-violet-400/[0.045] p-3.5">
                        <div className="flex items-start">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                    <h2 className="truncate text-sm font-semibold text-zinc-100">見どころ検出</h2>
                                    <span className={`flex-none border-l pl-2 text-[11px] font-medium ${
                                        isAnalyzing
                                            ? "border-cyan-300/40 text-cyan-100"
                                            : hasDraft
                                                ? "border-emerald-300/40 text-emerald-100"
                                                : "border-white/[0.12] text-zinc-500"
                                    }`}>
                                        {isAnalyzing ? "解析中" : hasDraft ? "候補あり" : "未解析"}
                                    </span>
                                </div>
                                <p className="mt-1 truncate text-[10px] text-zinc-500">{statusLabel}</p>
                            </div>
                        </div>

                        <div className="mt-3 grid grid-cols-3 gap-1.5">
                            <MiniMetric label="候補" value={`${recommendedCuts.length}`} />
                            <MiniMetric label="字幕" value={`${subtitles.length}`} />
                            <MiniMetric label="KEEP" value={`${workflow.stats.adoptedClipCount}`} />
                        </div>

                        <button
                            type="button"
                            onClick={controller.analyze}
                            disabled={isAnalyzing || !inputPath || !whisperModel.ready}
                            className="mt-3 flex w-full items-center justify-center rounded bg-cyan-400 py-2.5 text-[12px] font-semibold text-cyan-950 transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {hasDraft ? "見どころを再検出" : "見どころを検出"}
                        </button>

                        <p className="mt-2 truncate text-center text-[9px] text-zinc-700">
                            {!whisperModel.ready
                                ? "先に字幕モデルの初回準備を完了してください"
                                : `次: KEEP／没を判断 · 推定 ${controller.estimatedMinutes}分`}
                        </p>
                    </section>

                    <ProgressOverlay
                        isActive={isAnalyzing}
                        progress={visibleProgress}
                        message={visibleProgressMessage}
                    />

                    <AnalysisJobPanel
                        job={visibleJob}
                        isCancelable={isAnalyzing && activeJob?.status === "running"}
                        onCancel={cancelAnalysis}
                    />

                    <details className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                        <summary className="cursor-pointer list-none text-[10px] font-medium text-zinc-400 [&::-webkit-details-marker]:hidden">解析オプション</summary>
                        <div className="mt-2 space-y-2">
                            {gameSelector}
                        </div>
                    </details>

                    {analysisError && (
                        <div className="rounded-lg border border-red-400/15 bg-red-400/[0.05] p-3 text-[10px] leading-relaxed text-red-300">
                            {analysisError}
                        </div>
                    )}

                </div>

                <div className="min-w-0 space-y-3">
                    {!isAnalyzing && hasDraft ? (
                        <>
                            <DraftReviewPanel />
                            {developmentUi && <details className="group">
                                <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[10px] font-semibold text-zinc-500 transition hover:text-zinc-200">
                                    解析メタ情報
                                    <span className="text-[8px] text-zinc-700">任意</span>
                                </summary>
                                <div className="mt-2">
                                    <AnalysisArtifactPanel />
                                </div>
                            </details>}
                        </>
                    ) : !isAnalyzing ? (
                        <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed border-white/[0.08] bg-black/10 p-3 text-center">
                            <div>
                                <p className="text-[11px] font-medium text-zinc-300">まず見どころを検出します</p>
                                <p className="mt-1 text-[9px] leading-relaxed text-zinc-600">
                                    候補と根拠が出たら、ここでKEEP／没を判断できます。
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex min-h-[148px] items-center justify-center rounded-xl border border-cyan-300/10 bg-cyan-300/[0.025] p-3 text-center">
                                <div>
                                    <p className="text-[10px] font-medium text-zinc-400">解析結果を準備中です</p>
                                    <p className="mt-1 text-[9px] text-zinc-600">進捗とキャンセルは左側で確認できます</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {hasAdoptedSequence && !isAnalyzing && (
                        <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] px-3 py-2 text-[10px] text-emerald-100">
                            KEEP区間があります。端と並び順は「ラフカットを決める」で調整できます。
                        </div>
                    )}
                </div>
            </div>

        </>
    )
}
