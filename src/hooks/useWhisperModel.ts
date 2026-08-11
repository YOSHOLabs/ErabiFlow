import { useCallback, useEffect, useMemo, useState } from "react"
import { cancelDownloadJob, runDownloadJob } from "@/controllers/backgroundDownloads"
import { isActiveBackgroundJob } from "@/lib/backgroundJob"
import { isTauriEnv } from "@/lib/utils"
import { useBackgroundJobStore } from "@/stores/backgroundJobs"
import {
    commands,
    type WhisperModelProgress,
    type WhisperModelStatus,
} from "@/tauri/commands"

const EXPECTED_BYTES = 1_624_555_275

function demoStatus(): WhisperModelStatus {
    return {
        state: "missing",
        source: "downloaded",
        bytes: 0,
        expectedBytes: EXPECTED_BYTES,
        downloadedBytes: 0,
        modelName: "ggml-large-v3-turbo.bin",
        sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
        downloadUrl: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
        message: "AI字幕を使うには字幕モデルの取得が必要です。",
    }
}

export function useWhisperModel() {
    const tauri = isTauriEnv()
    const demoMissing = import.meta.env.DEV
        && typeof window !== "undefined"
        && new URLSearchParams(window.location.search).get("model") === "missing"
    const supported = tauri || demoMissing
    const [status, setStatus] = useState<WhisperModelStatus | null>(() => demoMissing ? demoStatus() : null)
    const [isLoading, setIsLoading] = useState(tauri)
    const [error, setError] = useState<string | null>(null)
    const downloadJob = useBackgroundJobStore((state) => state.jobs["whisper-download"])
    const isDownloading = isActiveBackgroundJob(downloadJob)

    const refresh = useCallback(async () => {
        if (demoMissing) {
            setStatus(demoStatus())
            setIsLoading(false)
            return
        }
        if (!tauri) {
            setIsLoading(false)
            return
        }
        setIsLoading(true)
        try {
            setStatus(await commands.getWhisperModelStatus())
            setError(null)
        } catch (reason) {
            setError(String(reason))
        } finally {
            setIsLoading(false)
        }
    }, [demoMissing, tauri])

    useEffect(() => {
        void refresh()
    }, [refresh])

    useEffect(() => {
        if (!tauri || !downloadJob || isActiveBackgroundJob(downloadJob)) return
        void refresh()
    }, [downloadJob?.id, downloadJob?.status, refresh, tauri])

    const download = useCallback(async () => {
        if (demoMissing) {
            setError("UI確認モードではモデルを取得しません。デスクトップ版で実行してください。")
            return
        }
        if (!tauri) return
        setError(null)
        const outcome = await runDownloadJob({
            kind: "whisper-download",
            label: "字幕モデルの取得",
            eventName: "whisper-model-progress",
            download: commands.downloadWhisperModel,
        })
        if (outcome.result) {
            const next = outcome.result
            setStatus(next)
        } else {
            setError(outcome.error)
            try {
                setStatus(await commands.getWhisperModelStatus())
            } catch {
                // 元の取得エラーを優先して表示する。
            }
        }
    }, [demoMissing, tauri])

    const cancel = useCallback(async () => {
        if (!tauri) return
        await cancelDownloadJob("whisper-download", commands.cancelWhisperModelDownload)
    }, [tauri])

    const remove = useCallback(async () => {
        if (!tauri) return
        setError(null)
        try {
            setStatus(await commands.removeDownloadedWhisperModel())
        } catch (reason) {
            setError(String(reason))
        }
    }, [tauri])

    const ready = !supported || status?.state === "ready"
    const visibleProgress = useMemo(() => {
        if (downloadJob && isActiveBackgroundJob(downloadJob)) {
            return {
                state: String(downloadJob.metrics.state ?? downloadJob.phase) as WhisperModelProgress["state"],
                downloadedBytes: Number(downloadJob.metrics.downloadedBytes ?? 0),
                totalBytes: Number(downloadJob.metrics.totalBytes ?? status?.expectedBytes ?? 0),
                progress: downloadJob.progress / 100,
                message: downloadJob.message,
            } satisfies WhisperModelProgress
        }
        if (!status || status.expectedBytes <= 0) return null
        return {
            state: status.state,
            downloadedBytes: status.downloadedBytes,
            totalBytes: status.expectedBytes,
            progress: status.downloadedBytes / status.expectedBytes,
            message: status.message,
        } satisfies WhisperModelProgress
    }, [downloadJob, status])

    return {
        supported,
        status,
        progress: visibleProgress,
        ready,
        isLoading,
        isDownloading,
        error,
        refresh,
        download,
        cancel,
        remove,
    }
}

export type WhisperModelController = ReturnType<typeof useWhisperModel>
