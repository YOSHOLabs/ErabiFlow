export type RuntimeCheckSeverity = "ok" | "warning" | "error"

export interface RuntimeCheckItem {
    id: string
    severity: RuntimeCheckSeverity
    title: string
    detail: string
}

export interface RuntimeReadinessSummary {
    canRunAi: boolean
    canExport: boolean
    items: RuntimeCheckItem[]
    counts: Record<RuntimeCheckSeverity, number>
}

export interface RuntimeReadinessInput {
    isTauri: boolean
    daemon?: {
        status?: string
        engine_loaded?: boolean
        device?: string
        hardware_gpu?: string
    } | null
    daemonError?: string | null
    whisperModel?: {
        state?: string
        source?: string
        downloadedBytes?: number
        expectedBytes?: number
        message?: string
    } | null
    whisperModelError?: string | null
    ffmpegRuntime?: {
        state?: string
        source?: string
        downloadedBytes?: number
        expectedBytes?: number
        message?: string
    } | null
    ffmpegRuntimeError?: string | null
}

function counts(items: RuntimeCheckItem[]): Record<RuntimeCheckSeverity, number> {
    return {
        ok: items.filter((item) => item.severity === "ok").length,
        warning: items.filter((item) => item.severity === "warning").length,
        error: items.filter((item) => item.severity === "error").length,
    }
}

export function computeRuntimeReadiness(input: RuntimeReadinessInput): RuntimeReadinessSummary {
    const items: RuntimeCheckItem[] = []

    if (!input.isTauri) {
        items.push({
            id: "desktop-runtime",
            severity: "warning",
            title: "ブラウザプレビューで実行中",
            detail: "UI確認はできますが、AI解析やFFmpeg書き出しはデスクトップアプリで確認してください。",
        })
    } else {
        items.push({
            id: "desktop-runtime",
            severity: "ok",
            title: "デスクトップ実行環境",
            detail: "Tauri環境で実行されています。",
        })
    }

    if (input.daemonError) {
        items.push({
            id: "daemon",
            severity: "error",
            title: "AIデーモンに接続できません",
            detail: input.daemonError,
        })
    } else if (!input.daemon) {
        items.push({
            id: "daemon",
            severity: input.isTauri ? "warning" : "warning",
            title: "AIデーモン未確認",
            detail: "環境チェックを実行すると、AI解析プロセスの状態を確認できます。",
        })
    } else if (input.daemon.status === "healthy") {
        items.push({
            id: "daemon",
            severity: "ok",
            title: "AIデーモン接続OK",
            detail: `device=${input.daemon.device ?? "unknown"} / GPU=${input.daemon.hardware_gpu ?? "unknown"}`,
        })
    } else {
        items.push({
            id: "daemon",
            severity: "warning",
            title: "AIデーモンの状態が不明です",
            detail: `status=${input.daemon.status ?? "unknown"}`,
        })
    }

    if (input.isTauri) {
        if (input.ffmpegRuntimeError) {
            items.push({
                id: "ffmpeg-runtime",
                severity: "error",
                title: "動画エンジンを確認できません",
                detail: input.ffmpegRuntimeError,
            })
        } else if (!input.ffmpegRuntime) {
            items.push({
                id: "ffmpeg-runtime",
                severity: "warning",
                title: "動画エンジン未確認",
                detail: "再チェックすると、FFmpegの準備状態を確認できます。",
            })
        } else if (input.ffmpegRuntime.state === "ready") {
            items.push({
                id: "ffmpeg-runtime",
                severity: "ok",
                title: "動画エンジン準備OK",
                detail: `FFmpeg LGPL / ${input.ffmpegRuntime.source ?? "local"}`,
            })
        } else {
            const percent = input.ffmpegRuntime.expectedBytes
                ? Math.round(((input.ffmpegRuntime.downloadedBytes ?? 0) / input.ffmpegRuntime.expectedBytes) * 100)
                : 0
            items.push({
                id: "ffmpeg-runtime",
                severity: input.ffmpegRuntime.state === "corrupt" ? "error" : "warning",
                title: input.ffmpegRuntime.state === "corrupt" ? "動画エンジンが破損しています" : "動画エンジンの初回準備が必要です",
                detail: input.ffmpegRuntime.message || `起動画面からFFmpegを取得してください（${percent}%）。`,
            })
        }

        if (input.whisperModelError) {
            items.push({
                id: "whisper-model",
                severity: "error",
                title: "字幕モデルを確認できません",
                detail: input.whisperModelError,
            })
        } else if (!input.whisperModel) {
            items.push({
                id: "whisper-model",
                severity: "warning",
                title: "字幕モデル未確認",
                detail: "再チェックすると、AI字幕モデルの準備状態を確認できます。",
            })
        } else if (input.whisperModel.state === "ready") {
            items.push({
                id: "whisper-model",
                severity: "ok",
                title: "AI字幕モデル準備OK",
                detail: `large-v3-turbo / ${input.whisperModel.source ?? "local"}`,
            })
        } else {
            const percent = input.whisperModel.expectedBytes
                ? Math.round(((input.whisperModel.downloadedBytes ?? 0) / input.whisperModel.expectedBytes) * 100)
                : 0
            items.push({
                id: "whisper-model",
                severity: input.whisperModel.state === "corrupt" ? "error" : "warning",
                title: input.whisperModel.state === "corrupt" ? "字幕モデルが破損しています" : "AI字幕の初回準備が必要です",
                detail: input.whisperModel.message || `AI初稿画面から字幕モデルを取得してください（${percent}%）。`,
            })
        }
    }

    const total = counts(items)
    const daemonOk = items.find((item) => item.id === "daemon")?.severity === "ok"
    const whisperModelOk = !input.isTauri
        || items.find((item) => item.id === "whisper-model")?.severity === "ok"
    const ffmpegRuntimeOk = !input.isTauri
        || items.find((item) => item.id === "ffmpeg-runtime")?.severity === "ok"

    return {
        canRunAi: input.isTauri && daemonOk && whisperModelOk && ffmpegRuntimeOk,
        canExport: input.isTauri && ffmpegRuntimeOk,
        items,
        counts: total,
    }
}
