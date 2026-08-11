/**
 * analysisSlice — AI解析結果の状態とアクション
 * （Undo対象外のデータ群）
 */
import type { AgentHighlight } from "../../lib/types.ts"
import type { AnalysisArtifact } from "../../lib/analysisArtifact.ts"
import type { AnalysisJob } from "../../lib/analysisJob.ts"
import {
    applyAnalysisProgress,
    cancelAnalysisJob,
    completeAnalysisJob,
    failAnalysisJob,
    requestCancelAnalysisJob,
} from "../../lib/analysisJob.ts"

export const createAnalysisSlice = (set: any) => ({
    // --- 初期値 ---
    excitementGraph: [] as number[],
    waveformData: [] as number[],
    agentThinking: "",
    recommendedCuts: [] as AgentHighlight[],
    rejectedHighlightCandidateIndices: [] as number[],
    analysisArtifacts: [] as AnalysisArtifact[],
    activeAnalysisId: null as string | null,
    analysisJobs: [] as AnalysisJob[],
    activeAnalysisJobId: null as string | null,

    // --- アクション ---
    setExcitementGraph: (graph: number[]) =>
        set((s: any) => {
            s.excitementGraph = graph
        }),
    setWaveformData: (data: number[]) =>
        set((s: any) => {
            s.waveformData = data
        }),
    setAgentThinking: (thinking: string) =>
        set((s: any) => {
            s.agentThinking = thinking
        }),
    setRecommendedCuts: (cuts: AgentHighlight[]) =>
        set((s: any) => {
            s.recommendedCuts = cuts
        }),
    rejectHighlightCandidate: (candidateIndex: number) =>
        set((s: any) => {
            if (!Number.isInteger(candidateIndex) || candidateIndex < 0) return
            if (!s.rejectedHighlightCandidateIndices.includes(candidateIndex)) {
                s.rejectedHighlightCandidateIndices.push(candidateIndex)
            }
        }),
    restoreHighlightCandidates: (candidateIndices: readonly number[]) =>
        set((s: any) => {
            const restored = new Set(candidateIndices)
            s.rejectedHighlightCandidateIndices = s.rejectedHighlightCandidateIndices
                .filter((index: number) => !restored.has(index))
        }),
    clearRejectedHighlightCandidates: () =>
        set((s: any) => {
            s.rejectedHighlightCandidateIndices = []
        }),
    setAnalysisArtifact: (artifact: AnalysisArtifact) =>
        set((s: any) => {
            const nextArtifacts = s.analysisArtifacts.filter((a: AnalysisArtifact) => a.id !== artifact.id)
            nextArtifacts.unshift(artifact)
            s.analysisArtifacts = nextArtifacts.slice(0, 10)
            s.activeAnalysisId = artifact.id
        }),
    clearAnalysisArtifacts: () =>
        set((s: any) => {
            s.analysisArtifacts = []
            s.activeAnalysisId = null
        }),
    startAnalysisJob: (job: AnalysisJob) =>
        set((s: any) => {
            const nextJobs = s.analysisJobs.filter((j: AnalysisJob) => j.id !== job.id)
            nextJobs.unshift(job)
            s.analysisJobs = nextJobs.slice(0, 10)
            s.activeAnalysisJobId = job.id
        }),
    updateActiveAnalysisJobProgress: (progress: { progress: number; message?: string }) =>
        set((s: any) => {
            const id = s.activeAnalysisJobId
            if (!id) return
            s.analysisJobs = s.analysisJobs.map((job: AnalysisJob) =>
                job.id === id ? applyAnalysisProgress(job, progress) : job
            )
        }),
    finishActiveAnalysisJob: (message?: string) =>
        set((s: any) => {
            const id = s.activeAnalysisJobId
            if (!id) return
            s.analysisJobs = s.analysisJobs.map((job: AnalysisJob) =>
                job.id === id ? completeAnalysisJob(job, message) : job
            )
        }),
    failActiveAnalysisJob: (error: string) =>
        set((s: any) => {
            const id = s.activeAnalysisJobId
            if (!id) return
            s.analysisJobs = s.analysisJobs.map((job: AnalysisJob) =>
                job.id === id ? failAnalysisJob(job, error) : job
            )
        }),
    requestCancelActiveAnalysisJob: (message?: string) =>
        set((s: any) => {
            const id = s.activeAnalysisJobId
            if (!id) return
            s.analysisJobs = s.analysisJobs.map((job: AnalysisJob) =>
                job.id === id ? requestCancelAnalysisJob(job, message) : job
            )
        }),
    cancelActiveAnalysisJob: (message?: string) =>
        set((s: any) => {
            const id = s.activeAnalysisJobId
            if (!id) return
            s.analysisJobs = s.analysisJobs.map((job: AnalysisJob) =>
                job.id === id ? cancelAnalysisJob(job, message) : job
            )
        }),
    clearAnalysisJobs: () =>
        set((s: any) => {
            s.analysisJobs = []
            s.activeAnalysisJobId = null
        }),
})
