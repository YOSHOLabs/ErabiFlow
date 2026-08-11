import { useCallback, useEffect, useMemo, useState } from "react"
import { cancelDownloadJob, runDownloadJob } from "@/controllers/backgroundDownloads"
import { isActiveBackgroundJob } from "@/lib/backgroundJob"
import { isTauriEnv } from "@/lib/utils"
import { useBackgroundJobStore } from "@/stores/backgroundJobs"
import {
    commands,
    type FfmpegRuntimeProgress,
    type FfmpegRuntimeStatus,
} from "@/tauri/commands"

const EXPECTED_BYTES = 145_265_304

function demoStatus(): FfmpegRuntimeStatus {
    return {
        state: "missing",
        source: "downloaded",
        bytes: 0,
        expectedBytes: EXPECTED_BYTES,
        downloadedBytes: 0,
        archiveName: "ffmpeg-N-125365-g9a01c1cb6a-win64-lgpl.zip",
        archiveSha256: "75cb786fa14299eb1c1cacc2542a15c8da690e551ab41858383dc425c605b8ab",
        executableSha256: "b1ebb2a19864de271d8539cc15934ff31719d184d3cbbcdb50dd16d68aa5db64",
        downloadUrl: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-06-30-13-34/ffmpeg-N-125365-g9a01c1cb6a-win64-lgpl.zip",
        releaseUrl: "https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-06-30-13-34",
        message: "動画の読み込み・編集・書き出しには動画エンジンの初回準備が必要です。",
    }
}

export function useFfmpegRuntime() {
    const tauri = isTauriEnv()
    const demoMissing = import.meta.env.DEV
        && typeof window !== "undefined"
        && new URLSearchParams(window.location.search).get("ffmpeg") === "missing"
    const supported = tauri || demoMissing
    const [status, setStatus] = useState<FfmpegRuntimeStatus | null>(() => demoMissing ? demoStatus() : null)
    const [isLoading, setIsLoading] = useState(tauri)
    const [error, setError] = useState<string | null>(null)
    const downloadJob = useBackgroundJobStore((state) => state.jobs["ffmpeg-download"])
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
            setStatus(await commands.getFfmpegRuntimeStatus())
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
            setError("UI確認モードでは取得しません。デスクトップ版で実行してください。")
            return
        }
        if (!tauri) return
        setError(null)
        const outcome = await runDownloadJob({
            kind: "ffmpeg-download",
            label: "動画エンジンの取得",
            eventName: "ffmpeg-runtime-progress",
            download: commands.downloadFfmpegRuntime,
        })
        if (outcome.result) {
            const next = outcome.result
            setStatus(next)
            if (next.state === "ready") {
                window.dispatchEvent(new CustomEvent("vfocus:ffmpeg-runtime-ready"))
            }
        } else {
            setError(outcome.error)
            try {
                setStatus(await commands.getFfmpegRuntimeStatus())
            } catch {
                // 元の取得エラーを優先する。
            }
        }
    }, [demoMissing, tauri])

    const cancel = useCallback(async () => {
        if (!tauri) return
        await cancelDownloadJob("ffmpeg-download", commands.cancelFfmpegRuntimeDownload)
    }, [tauri])

    const remove = useCallback(async () => {
        if (!tauri) return
        setError(null)
        try {
            setStatus(await commands.removeDownloadedFfmpegRuntime())
        } catch (reason) {
            setError(String(reason))
        }
    }, [tauri])

    const ready = !supported || status?.state === "ready"
    const visibleProgress = useMemo(() => {
        if (downloadJob && isActiveBackgroundJob(downloadJob)) {
            return {
                state: String(downloadJob.metrics.state ?? downloadJob.phase) as FfmpegRuntimeProgress["state"],
                downloadedBytes: Number(downloadJob.metrics.downloadedBytes ?? 0),
                totalBytes: Number(downloadJob.metrics.totalBytes ?? status?.expectedBytes ?? 0),
                progress: downloadJob.progress / 100,
                message: downloadJob.message,
            } satisfies FfmpegRuntimeProgress
        }
        if (!status || status.expectedBytes <= 0) return null
        return {
            state: status.state,
            downloadedBytes: status.downloadedBytes,
            totalBytes: status.expectedBytes,
            progress: status.downloadedBytes / status.expectedBytes,
            message: status.message,
        } satisfies FfmpegRuntimeProgress
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

export type FfmpegRuntimeController = ReturnType<typeof useFfmpegRuntime>
