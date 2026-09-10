import { AlertTriangle, CheckCircle2, CloudDownload, Pause, RefreshCw, ShieldCheck, Trash2 } from "lucide-react"
import type { WhisperModelController } from "@/hooks/useWhisperModel"

function formatBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB"
    const gib = bytes / 1024 / 1024 / 1024
    if (gib >= 1) return `${gib.toFixed(2)} GB`
    return `${Math.round(bytes / 1024 / 1024)} MB`
}

export function WhisperModelSetupCard({ model }: { model: WhisperModelController }) {
    if (!model.supported || model.status?.state === "ready") return null

    const status = model.status
    const progress = model.progress
    const isCorrupt = status?.state === "corrupt"
    const isPaused = status?.state === "paused"
    const percent = Math.max(0, Math.min(100, Math.round((progress?.progress ?? 0) * 100)))

    return (
        <section
            data-testid="whisper-model-setup"
            className={`rounded-2xl border p-3.5 ${
                isCorrupt
                    ? "border-red-400/20 bg-red-400/[0.045]"
                    : "border-cyan-300/18 bg-cyan-300/[0.04]"
            }`}
        >
            <div className="flex items-start gap-2.5">
                <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-xl ${
                    isCorrupt ? "bg-red-400/10 text-red-200" : "bg-cyan-300/10 text-cyan-200"
                }`}>
                    {isCorrupt ? <AlertTriangle className="h-4 w-4" /> : <CloudDownload className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                    <h2 className="text-[12px] font-semibold text-zinc-100">
                        {isCorrupt ? "字幕モデルを再取得してください" : "AI字幕の初回準備"}
                    </h2>
                    <p className="mt-1 text-[9px] leading-relaxed text-zinc-500">
                        whisper.cpp公式の large-v3-turbo（{formatBytes(status?.expectedBytes ?? 1_624_555_275)}）を取得します。
                        動画や音声はPC外へ送信しません。
                    </p>
                </div>
            </div>

            {(model.isDownloading || isPaused) && progress && (
                <div className="mt-3 rounded-xl border border-white/[0.06] bg-black/15 p-2.5">
                    <div className="flex items-center justify-between gap-2 text-[9px]">
                        <span className="truncate text-zinc-400">
                            {progress.state === "verifying" ? "安全性を検証中" : isPaused ? "中断済み・再開できます" : "取得中"}
                        </span>
                        <span className="flex-none font-mono text-cyan-200">{percent}%</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <div className="h-full rounded-full bg-cyan-300 transition-[width]" style={{ width: `${percent}%` }} />
                    </div>
                    <p className="mt-1.5 text-[8px] text-zinc-600">
                        {formatBytes(progress.downloadedBytes)} / {formatBytes(progress.totalBytes)}
                    </p>
                </div>
            )}

            {model.error && (
                <p className="mt-2 break-words rounded-lg border border-red-400/15 bg-red-400/[0.04] p-2 text-[9px] leading-relaxed text-red-200">
                    {model.error}
                </p>
            )}

            <div className="mt-3 flex gap-2">
                {model.isDownloading ? (
                    <button
                        type="button"
                        onClick={() => void model.cancel()}
                        disabled={!model.canCancel}
                        className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] text-[10px] font-semibold text-amber-100 hover:bg-amber-300/[0.1] disabled:cursor-wait disabled:opacity-50"
                    >
                        {model.canCancel ? <Pause className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                        {model.canCancel ? "中断する" : "開始中..."}
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => void model.download()}
                        disabled={model.isLoading}
                        className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-cyan-300 text-[10px] font-semibold text-cyan-950 hover:bg-cyan-200 disabled:opacity-50"
                    >
                        {model.isLoading
                            ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            : isPaused
                                ? <RefreshCw className="h-3.5 w-3.5" />
                                : <CloudDownload className="h-3.5 w-3.5" />}
                        {isPaused ? "続きから再開" : "字幕モデルを取得"}
                    </button>
                )}
                {isCorrupt && !model.isDownloading && (
                    <button
                        type="button"
                        onClick={() => void model.remove()}
                        className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] px-3 text-[9px] font-semibold text-zinc-400 hover:text-red-200"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                        削除
                    </button>
                )}
            </div>

            <div className="mt-2.5 flex items-center gap-1.5 text-[8px] text-zinc-600">
                {isPaused ? <Pause className="h-3 w-3" /> : isCorrupt ? <AlertTriangle className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                <span>中断・再開対応 · 完了時にSHA-256を照合 · 保存先はアプリデータ内</span>
                {status?.state === "ready" && <CheckCircle2 className="h-3 w-3 text-emerald-300" />}
            </div>
        </section>
    )
}
