/**
 * useHighlightAnalysis — ゲーム実況ハイライト分析（無料版・高速モード）。
 * whisper.cpp + librosa による音声ベースの高速スキャン。
 * Gemma 映像判定は含まない（PRO解析に統合済み）。
 */
import { useState, useCallback, useRef } from "react"
import { commands } from "@/tauri/commands"
import { useDocumentStore } from "@/stores/document"
import { isTauriEnv } from "@/lib/utils"
import { createAnalysisArtifactFromResponse } from "@/lib/analysisArtifact"
import { canApplyAnalysisResult, createAnalysisJob } from "@/lib/analysisJob"

/** フックの引数: daemon 進捗を親から制御するための setter */
export interface HighlightAnalysisOptions {
    setDaemonProgress: React.Dispatch<React.SetStateAction<number>>
    setDaemonMessage: React.Dispatch<React.SetStateAction<string>>
}

/** フックの返り値 */
export interface HighlightAnalysisReturn {
    analyze: () => Promise<void>
    cancel: () => Promise<void>
    isAnalyzing: boolean
    analysisError: string
    estimatedMinutes: number
}

export function useHighlightAnalysis({
    setDaemonProgress,
    setDaemonMessage,
}: HighlightAnalysisOptions): HighlightAnalysisReturn {
    const inputPath = useDocumentStore((s) => s.inputPath)
    const setRecommendedCuts = useDocumentStore((s) => s.setRecommendedCuts)
    const clearRejectedHighlightCandidates = useDocumentStore((s) => s.clearRejectedHighlightCandidates)
    const setAgentThinking = useDocumentStore((s) => s.setAgentThinking)
    const setExcitementGraph = useDocumentStore((s) => s.setExcitementGraph)
    const setSubtitles = useDocumentStore((s) => s.setSubtitles)
    const setAnalysisArtifact = useDocumentStore((s) => s.setAnalysisArtifact)
    const startAnalysisJob = useDocumentStore((s) => s.startAnalysisJob)
    const finishActiveAnalysisJob = useDocumentStore((s) => s.finishActiveAnalysisJob)
    const failActiveAnalysisJob = useDocumentStore((s) => s.failActiveAnalysisJob)
    const requestCancelActiveAnalysisJob = useDocumentStore((s) => s.requestCancelActiveAnalysisJob)
    const cancelActiveAnalysisJob = useDocumentStore((s) => s.cancelActiveAnalysisJob)
    const gpuType = useDocumentStore((s) => s.processing.gpuType)
    const analysisGameId = useDocumentStore((s) => s.processing.analysisGameId)

    const [isAnalyzing, setIsAnalyzing] = useState(false)
    const [analysisError, setAnalysisError] = useState("")
    const activeClientJobIdRef = useRef<string | null>(null)
    const inFlightRef = useRef(false)

    const isTauri = isTauriEnv()

    const createJobId = () => globalThis.crypto?.randomUUID?.() ?? `analysis-${Date.now()}-${Math.random().toString(36).slice(2)}`
    
    // 全クリップの合計時間を動画尺として近似（カット前なら元動画と同じ）
    const clips = useDocumentStore(s => s.timelineClips)
    const videoDuration = useDocumentStore(s => s.videoInfo?.duration ?? 0)
    const timelineDurationSeconds = clips.reduce((acc: number, c: any) => acc + (c.isGap ? c.mediaStart : c.mediaEnd - c.mediaStart), 0)
    const totalDurationSeconds = timelineDurationSeconds > 0 ? timelineDurationSeconds : videoDuration
    
    // ハイライト分析は通常、動画尺の約25〜30%の時間がかかる
    const estimatedMinutes = Math.max(1, Math.ceil((totalDurationSeconds * 0.25) / 60))

    const analyze = useCallback(async () => {
        if (!inputPath || !isTauri || inFlightRef.current) return
        inFlightRef.current = true
        setIsAnalyzing(true)
        setAnalysisError("")
        setAgentThinking("")
        setRecommendedCuts([])
        clearRejectedHighlightCandidates()
        setExcitementGraph([])
        setDaemonProgress(0)
        setDaemonMessage("ハイライト分析を開始...")

        const clientJobId = createJobId()
        activeClientJobIdRef.current = clientJobId
        const params = {
            videoPath: inputPath,
            chunkSize: 300,
            threshold: 25.0,
            maxClips: 10,
            language: "auto",
            gameId: analysisGameId,
            gpuType: gpuType,
            clientJobId,
        }
        startAnalysisJob(createAnalysisJob({
            id: clientJobId,
            sourcePath: inputPath,
            mode: "fast",
            params,
        }))

        try {
            const response = await commands.analyzeHighlights(params)

            const currentDocument = useDocumentStore.getState()
            const currentJob = currentDocument.analysisJobs.find((job) => job.id === clientJobId)
            const canApply = activeClientJobIdRef.current === clientJobId && canApplyAnalysisResult({
                job: currentJob,
                activeJobId: currentDocument.activeAnalysisJobId,
                clientJobId,
                capturedSourcePath: inputPath,
                currentSourcePath: currentDocument.inputPath,
            })
            if (!canApply) {
                if (currentDocument.activeAnalysisJobId === clientJobId) {
                    cancelActiveAnalysisJob("解析結果を破棄してキャンセルしました")
                }
                return
            }

            const artifact = createAnalysisArtifactFromResponse(response, inputPath, "fast")
            setAnalysisArtifact(artifact)

            if (artifact.highlights.length > 0) {
                setRecommendedCuts(artifact.highlights)
            }

            if (artifact.excitementGraph.length > 0) {
                setExcitementGraph(artifact.excitementGraph)
            }

            if (response.segments && Array.isArray(response.segments)) {
                setSubtitles(artifact.subtitles)
            } else {
                setAnalysisError("Warning: no segments returned from backend")
            }

            if (response.transcript_text) {
                setAgentThinking(
                    `${response.stats.cache_hit ? "キャッシュ復元" : "分析完了"}: ` +
                    `${response.stats.highlights_found}件のハイライト候補を発見 (${response.stats.processing_time_sec}秒)`
                )
            }

            setDaemonProgress(1.0)
            const doneLabel = response.stats?.cache_hit ? "キャッシュ復元" : "完了"
            setDaemonMessage(`${doneLabel}! ハイライト: ${response.stats?.highlights_found || 0}件, 字幕: ${response.segments?.length || 0}件`)
            finishActiveAnalysisJob(`${doneLabel}: ハイライト ${response.stats?.highlights_found || 0}件 / 字幕 ${response.segments?.length || 0}件`)

        } catch (err: any) {
            console.error("Highlight analysis failed:", err)
            const message = err?.toString() || "ハイライト分析エラー"
            if (useDocumentStore.getState().activeAnalysisJobId !== clientJobId) return
            if (/キャンセル|cancel/i.test(message)) {
                cancelActiveAnalysisJob("解析をキャンセルしました")
                setAnalysisError("")
                setDaemonMessage("解析をキャンセルしました")
            } else {
                failActiveAnalysisJob(message)
                setAnalysisError(message)
            }
        } finally {
            activeClientJobIdRef.current = null
            inFlightRef.current = false
            setIsAnalyzing(false)
        }
    }, [
        inputPath, isTauri, gpuType, analysisGameId,
        setAgentThinking, setRecommendedCuts, clearRejectedHighlightCandidates, setExcitementGraph, setSubtitles, setAnalysisArtifact,
        startAnalysisJob, finishActiveAnalysisJob, failActiveAnalysisJob, requestCancelActiveAnalysisJob, cancelActiveAnalysisJob,
        setDaemonProgress, setDaemonMessage,
    ])

    const cancel = useCallback(async () => {
        const clientJobId = activeClientJobIdRef.current
        if (!clientJobId || !isTauri) return
        requestCancelActiveAnalysisJob("キャンセル要求を送信しました")
        setDaemonMessage("キャンセル要求を送信しました...")
        try {
            await commands.cancelAnalysis({ clientJobId })
        } catch (err) {
            console.error("Failed to cancel highlight analysis:", err)
        }
    }, [isTauri, requestCancelActiveAnalysisJob, setDaemonMessage])

    return {
        analyze,
        cancel,
        isAnalyzing,
        analysisError,
        estimatedMinutes,
    }
}
