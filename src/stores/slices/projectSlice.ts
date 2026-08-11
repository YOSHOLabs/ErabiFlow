/**
 * projectSlice — プロジェクト基本情報の状態とアクション
 */
import type { VideoInfo } from "../../lib/types.ts"
import { DEFAULT_PROCESSING } from "../../lib/types.ts"
import { useEditorStore } from "../editor.ts"

export const createProjectSlice = (set: any) => ({
    // --- 初期値 ---
    inputPath: "",
    avatarPath: "",
    videoInfo: null as VideoInfo | null,
    bgmPath: "",
    bgmVolume: 0.5,
    bgmStart: 0,
    bgmEnd: null as number | null,
    bgmTrimStart: 0,
    bgmSourceDuration: null as number | null,

    // --- アクション ---
    setInputPath: (path: string) => {
        set((s: any) => {
            s.inputPath = path
            s.videoInfo = null
            // Issue 5: Reset analysis state on new video load
            s.subtitles = []
            s.recommendedCuts = []
            s.rejectedHighlightCandidateIndices = []
            s.agentThinking = ""
            s.excitementGraph = []
            s.waveformData = []
            s.analysisArtifacts = []
            s.activeAnalysisId = null
            s.analysisJobs = []
            s.activeAnalysisJobId = null
            s.timelineClips = []
            s.silenceSegments = []
            s.seSlots = []
            s.images = []
            s.creatorBatch = []
            s.processing = { ...DEFAULT_PROCESSING }
        })
        useEditorStore.getState().resetPlayback()
    },
    setAvatarPath: (path: string) =>
        set((s: any) => {
            s.avatarPath = path
        }),
    setVideoInfo: (info: VideoInfo | null) =>
        set((s: any) => {
            s.videoInfo = info
        }),
    setBgmPath: (path: string) =>
        set((s: any) => {
            s.bgmPath = path
            s.bgmStart = 0
            s.bgmEnd = null
            s.bgmTrimStart = 0
            s.bgmSourceDuration = null
        }),
    setBgmVolume: (volume: number) =>
        set((s: any) => {
            s.bgmVolume = Math.max(0, Math.min(1, volume))
        }),
    setBgmStart: (start: number) =>
        set((s: any) => {
            s.bgmStart = Math.max(0, start)
        }),
    setBgmEnd: (end: number | null) =>
        set((s: any) => {
            s.bgmEnd = end === null ? null : Math.max(s.bgmStart + 0.1, end)
        }),
    setBgmTrimStart: (start: number) =>
        set((s: any) => {
            const maxStart = Math.max(0, (s.bgmSourceDuration ?? Number.POSITIVE_INFINITY) - 0.1)
            s.bgmTrimStart = Math.max(0, Math.min(maxStart, start))
        }),
    setBgmSourceDuration: (duration: number | null) =>
        set((s: any) => {
            s.bgmSourceDuration = duration !== null && Number.isFinite(duration) && duration > 0
                ? duration
                : null
            if (s.bgmSourceDuration !== null) {
                s.bgmTrimStart = Math.min(s.bgmTrimStart, Math.max(0, s.bgmSourceDuration - 0.1))
            }
        }),
    setBgmTiming: (timing: { start?: number; end?: number | null; trimStart?: number }) =>
        set((s: any) => {
            if (timing.start !== undefined) s.bgmStart = Math.max(0, timing.start)
            if (timing.trimStart !== undefined) {
                const maxStart = Math.max(0, (s.bgmSourceDuration ?? Number.POSITIVE_INFINITY) - 0.1)
                s.bgmTrimStart = Math.max(0, Math.min(maxStart, timing.trimStart))
            }
            if (timing.end !== undefined) {
                s.bgmEnd = timing.end === null ? null : Math.max(s.bgmStart + 0.1, timing.end)
            } else if (s.bgmEnd !== null && s.bgmEnd <= s.bgmStart) {
                s.bgmEnd = s.bgmStart + 0.1
            }
        }),
})
