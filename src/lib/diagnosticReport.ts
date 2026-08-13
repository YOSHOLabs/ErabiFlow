import type { VFocusDocument } from "@/stores/document"
import { computeReleaseReadiness } from "./releaseReadiness.ts"
import { computeExportPreflight } from "./preflight.ts"
import { computeWorkflowSummary } from "./workflow.ts"

function basename(path: string | null | undefined) {
    if (!path) return "none"
    return path.split(/[\\/]/).pop() || path
}

function formatDuration(seconds: number | null | undefined) {
    if (!seconds || seconds <= 0) return "unknown"
    if (seconds < 60) return `${seconds.toFixed(1)}s`
    const minutes = Math.floor(seconds / 60)
    const rest = Math.round(seconds % 60).toString().padStart(2, "0")
    return `${minutes}:${rest}`
}

function countReviewSubtitles(document: VFocusDocument) {
    return document.subtitles.filter((subtitle) => subtitle.flags?.includes("needs_review")).length
}

function averageConfidence(document: VFocusDocument) {
    const values = document.subtitles
        .map((subtitle) => subtitle.confidence)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    if (values.length === 0) return "not available"
    const average = values.reduce((sum, value) => sum + value, 0) / values.length
    return `${Math.round(average * 100)}%`
}

function summarizeAnalysisJob(document: VFocusDocument) {
    const jobs = document.analysisJobs ?? []
    const job = jobs.find((item) => item.id === document.activeAnalysisJobId)
        ?? jobs[0]
    if (!job) {
        return [
            "activeJob: none",
        ]
    }

    const stage = job.stages.find((item) => item.id === job.currentStageId)
    const tail = job.logs.slice(-5).map((log) => `- ${log.level}: ${log.stageId ?? "general"} / ${log.message}`)

    return [
        `activeJob: ${job.id}`,
        `jobStatus: ${job.status}`,
        `jobMode: ${job.mode}`,
        `jobProgress: ${Math.round(job.progress * 100)}%`,
        `jobStage: ${stage?.label ?? job.currentStageId}`,
        `jobLastError: ${job.lastError ?? "none"}`,
        `jobLogs: ${job.logs.length}`,
        ...tail,
    ]
}

export function createDiagnosticReport(document: VFocusDocument, generatedAt = new Date().toISOString()) {
    const workflow = computeWorkflowSummary(document)
    const preflight = computeExportPreflight(document)
    const readiness = computeReleaseReadiness(document)
    const info = document.videoInfo

    const lines: string[] = [
        "ErabiFlow Diagnostic Report",
        `generatedAt: ${generatedAt}`,
        "",
        "[Media]",
        `inputFile: ${basename(document.inputPath)}`,
        `videoInfo: ${info ? `${info.width}x${info.height} / ${formatDuration(info.duration)}` : "missing"}`,
        "",
        "[Workflow]",
        `activeStep: ${workflow.activeStepId}`,
        `nextAction: ${workflow.nextAction}`,
        `analysisDraft: ${workflow.stats.hasAnalysisDraft ? "yes" : "no"}`,
        `adoptedClips: ${workflow.stats.adoptedClipCount}`,
        `sequenceDuration: ${formatDuration(workflow.stats.sequenceDuration)}`,
        `reviewSubtitlesInSequence: ${workflow.stats.reviewSubtitleCount}`,
        "",
        "[Timeline / Assets]",
        `timelineClips: ${document.timelineClips.length}`,
        `subtitles: ${document.subtitles.length}`,
        `reviewSubtitlesTotal: ${countReviewSubtitles(document)}`,
        `subtitleAverageConfidence: ${averageConfidence(document)}`,
        `images: ${document.images.length}`,
        `seSlots: ${document.seSlots.length}`,
        `bgm: ${document.bgmPath ? basename(document.bgmPath) : "none"}`,
        `avatar: ${document.avatarPath ? basename(document.avatarPath) : "none"}`,
        "",
        "[Preflight]",
        `canExport: ${preflight.canExport ? "yes" : "no"}`,
        `counts: error=${preflight.counts.error}, warning=${preflight.counts.warning}, info=${preflight.counts.info}, ok=${preflight.counts.ok}`,
        ...preflight.items.map((item) => `- ${item.severity}: ${item.id} / ${item.title}`),
        "",
        "[Release Readiness]",
        `readyForSmokeTest: ${readiness.readyForSmokeTest ? "yes" : "no"}`,
        `readyForDistribution: ${readiness.readyForDistribution ? "yes" : "no"}`,
        `progress: ${readiness.doneCount}/${readiness.totalCount}`,
        `nextItem: ${readiness.nextItem ? `${readiness.nextItem.id} / ${readiness.nextItem.title}` : "none"}`,
        "",
        "[Processing]",
        `gpuType: ${document.processing.gpuType}`,
        `autoReframe: ${document.processing.enableAutoReframe ? "on" : "off"}`,
        `jumpCut: ${document.processing.enableJumpCut ? "on" : "off"}`,
        `status: ${document.processing.status || "none"}`,
        `phase: ${document.processing.phase || "none"}`,
        `progress: ${Math.round(document.processing.progress)}%`,
        `lastOutputFile: ${basename(document.processing.lastOutputPath)}`,
        `lastStartedAt: ${document.processing.lastStartedAt ?? "none"}`,
        `lastFinishedAt: ${document.processing.lastFinishedAt ?? "none"}`,
        `lastError: ${document.processing.lastError ?? "none"}`,
        "",
        "[Analysis]",
        `artifacts: ${document.analysisArtifacts.length}`,
        `activeAnalysisId: ${document.activeAnalysisId ?? "none"}`,
        `recommendedCuts: ${document.recommendedCuts.length}`,
        `excitementGraphPoints: ${document.excitementGraph.length}`,
        "",
        "[Analysis Job]",
        ...summarizeAnalysisJob(document),
    ]

    return `${lines.join("\n")}\n`
}
