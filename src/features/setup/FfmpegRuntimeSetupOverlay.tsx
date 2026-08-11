import { AlertTriangle, CheckCircle2, Clapperboard, CloudDownload, Loader2, Pause, RefreshCw, ShieldCheck, Trash2 } from "lucide-react"
import type { FfmpegRuntimeController } from "@/hooks/useFfmpegRuntime"

function formatBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB"
    return `${Math.round(bytes / 1024 / 1024)} MB`
}

export function FfmpegRuntimeSetupOverlay({ runtime }: { runtime: FfmpegRuntimeController }) {
    if (!runtime.supported || runtime.ready) return null

    const status = runtime.status
    const progress = runtime.progress
    const isCorrupt = status?.state === "corrupt"
    const isPaused = status?.state === "paused"
    const isChecking = runtime.isLoading && !status
    const percent = Math.max(0, Math.min(100, Math.round((progress?.progress ?? 0) * 100)))
    const phase = progress?.state === "verifying"
        ? "安全性を検証中"
        : progress?.state === "extracting"
            ? "検証済みファイルを展開中"
            : isPaused
                ? "中断済み・続きから再開できます"
                : "取得中"

    return (
        <div
            data-testid="ffmpeg-runtime-setup"
            className="fixed inset-0 z-[200] flex items-center justify-center bg-[#08090b]/95 px-5"
        >
            <section className="w-full max-w-lg overflow-hidden rounded border border-white/[0.09] bg-[#111318]">
                <div className="border-b border-white/[0.06] px-6 py-5">
                    <div className="flex items-start gap-3.5">
                        <span className={`flex h-11 w-11 flex-none items-center justify-center rounded-2xl ${
                            isCorrupt ? "bg-red-400/10 text-red-200" : "bg-cyan-300/10 text-cyan-200"
                        }`}>
                            {isChecking
                                ? <Loader2 className="h-5 w-5 animate-spin" />
                                : isCorrupt
                                    ? <AlertTriangle className="h-5 w-5" />
                                    : <Clapperboard className="h-5 w-5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-cyan-300/70">First launch setup</p>
                            <h1 className="mt-1.5 text-base font-semibold text-zinc-100">
                                {isChecking ? "動画エンジンを確認しています" : isCorrupt ? "動画エンジンを再取得してください" : "最初に動画エンジンを準備します"}
                            </h1>
                            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                                動画の読み込み・波形・カット・書き出しに使うFFmpegを、BtbN公式GitHubから取得します。
                                動画や音声が送信されることはありません。
                            </p>
                        </div>
                    </div>
                </div>

                <div className="space-y-4 px-6 py-5">
                    <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5">
                            <p className="text-[8px] uppercase tracking-[0.14em] text-zinc-700">Download</p>
                            <p className="mt-1 font-mono text-[11px] text-zinc-300">{formatBytes(status?.expectedBytes ?? 145_265_304)}</p>
                        </div>
                        <div className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5">
                            <p className="text-[8px] uppercase tracking-[0.14em] text-zinc-700">License</p>
                            <p className="mt-1 font-mono text-[11px] text-zinc-300">LGPL-3.0-or-later</p>
                        </div>
                    </div>

                    {(runtime.isDownloading || isPaused) && progress && (
                        <div className="rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.025] p-3.5">
                            <div className="flex items-center justify-between gap-2 text-[10px]">
                                <span className="truncate text-zinc-400">{phase}</span>
                                <span className="flex-none font-mono font-semibold text-cyan-200">{percent}%</span>
                            </div>
                            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                                <div className="h-full rounded-full bg-cyan-300 transition-[width]" style={{ width: `${percent}%` }} />
                            </div>
                            <p className="mt-2 font-mono text-[8px] text-zinc-600">
                                {formatBytes(progress.downloadedBytes)} / {formatBytes(progress.totalBytes)}
                            </p>
                        </div>
                    )}

                    {runtime.error && (
                        <p className="break-words rounded-xl border border-red-400/15 bg-red-400/[0.045] p-3 text-[10px] leading-relaxed text-red-200">
                            {runtime.error}
                        </p>
                    )}

                    {!isChecking && (
                        <div className="flex gap-2">
                            {runtime.isDownloading ? (
                                <button
                                    type="button"
                                    onClick={() => void runtime.cancel()}
                                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] text-[11px] font-semibold text-amber-100 hover:bg-amber-300/[0.1]"
                                >
                                    <Pause className="h-4 w-4" />
                                    中断する
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => void runtime.download()}
                                    disabled={runtime.isLoading}
                                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-300 text-[11px] font-semibold text-cyan-950 hover:bg-cyan-200 disabled:opacity-50"
                                >
                                    {isPaused ? <RefreshCw className="h-4 w-4" /> : <CloudDownload className="h-4 w-4" />}
                                    {isPaused ? "続きから再開" : "公式FFmpegを取得"}
                                </button>
                            )}
                            {isCorrupt && !runtime.isDownloading && (
                                <button
                                    type="button"
                                    onClick={() => void runtime.remove()}
                                    className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] px-4 text-[10px] font-semibold text-zinc-400 hover:text-red-200"
                                >
                                    <Trash2 className="h-4 w-4" />
                                    削除
                                </button>
                            )}
                        </div>
                    )}

                    <div className="flex items-start gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5 text-[9px] leading-relaxed text-zinc-600">
                        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-300/70" />
                        <span>中断・再開対応。公式ZIPと展開後EXEを別々にSHA-256照合し、一致したファイルだけを使用します。</span>
                        {status?.state === "ready" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />}
                    </div>
                </div>
            </section>
        </div>
    )
}
