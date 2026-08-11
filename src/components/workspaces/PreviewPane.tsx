import { FastForward, MonitorPlay, Pause, Play, Rewind, SlidersHorizontal, Volume2, VolumeX } from "lucide-react"
import { VideoPreview } from "@/components/VideoPreview"
import { getSequenceDuration } from "@/lib/timeline"
import { useDocumentStore } from "@/stores/document"
import { useEditorStore } from "@/stores/editor"

function formatTransportTime(seconds: number) {
    const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
    const minutes = Math.floor(safeSeconds / 60)
    const rest = Math.floor(safeSeconds % 60).toString().padStart(2, "0")
    return `${minutes}:${rest}`
}

function PreviewTransport() {
    const previewTime = useEditorStore((state) => state.previewTime)
    const sourcePreviewTime = useEditorStore((state) => state.sourcePreviewTime)
    const isPlaying = useEditorStore((state) => state.isPlaying)
    const timelineClips = useDocumentStore((state) => state.timelineClips)
    const sourceDuration = useDocumentStore((state) => state.videoInfo?.duration ?? 0)
    const setPreviewTime = useEditorStore((state) => state.setPreviewTime)
    const setIsPlaying = useEditorStore((state) => state.setIsPlaying)
    const volume = useEditorStore((state) => state.volume)
    const setVolume = useEditorStore((state) => state.setVolume)
    const togglePreviewMute = useEditorStore((state) => state.togglePreviewMute)
    const previewMainVolume = useEditorStore((state) => state.previewMainVolume)
    const previewBgmVolume = useEditorStore((state) => state.previewBgmVolume)
    const previewTrackVolume = useEditorStore((state) => state.previewTrackVolume)
    const setPreviewMainVolume = useEditorStore((state) => state.setPreviewMainVolume)
    const setPreviewBgmVolume = useEditorStore((state) => state.setPreviewBgmVolume)
    const setPreviewTrackVolume = useEditorStore((state) => state.setPreviewTrackVolume)
    const bgmPath = useDocumentStore((state) => state.bgmPath)
    const hasAdditionalAudio = useDocumentStore((state) => state.trackMediaClips.some((clip) => clip.hasAudio))
    const roughCutMode = useDocumentStore((state) => state.game.layoutMode === "source")
    const duration = getSequenceDuration(timelineClips) || sourceDuration
    const rangeMax = Math.max(0.01, duration)
    const currentTime = Math.min(previewTime, rangeMax)

    const seekBy = (seconds: number) => {
        setIsPlaying(false)
        setPreviewTime(Math.max(0, Math.min(duration, previewTime + seconds)))
    }

    return (
        <div className="flex-none border-t border-white/[0.07] bg-[#0b1017] px-4 py-3">
            <input
                type="range"
                min={0}
                max={rangeMax}
                step={0.05}
                value={currentTime}
                disabled={duration <= 0}
                onChange={(event) => {
                    setIsPlaying(false)
                    setPreviewTime(Number(event.target.value))
                }}
                aria-label="再生位置"
                className="tc-preview-range block h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
            />
            <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className="min-w-0 font-mono text-[11px] tabular-nums text-zinc-300">
                    {sourcePreviewTime !== null ? `元動画 ${formatTransportTime(sourcePreviewTime)}` : formatTransportTime(previewTime)}
                    <span className="text-zinc-700"> / {formatTransportTime(duration)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => seekBy(-5)}
                        disabled={duration <= 0}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-zinc-500 transition hover:border-white/[0.08] hover:bg-white/[0.05] hover:text-zinc-100 disabled:opacity-30"
                        title="5秒戻る"
                        aria-label="5秒戻る"
                    >
                        <Rewind className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsPlaying(!isPlaying)}
                        disabled={duration <= 0}
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-100/50 bg-cyan-200 text-[#071014] shadow-[0_8px_24px_rgba(34,211,238,0.14)] transition hover:bg-cyan-100 disabled:opacity-30"
                        title={isPlaying ? "一時停止" : "再生"}
                        aria-label={isPlaying ? "一時停止" : "再生"}
                    >
                        {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
                    </button>
                    <button
                        type="button"
                        onClick={() => seekBy(5)}
                        disabled={duration <= 0}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-zinc-500 transition hover:border-white/[0.08] hover:bg-white/[0.05] hover:text-zinc-100 disabled:opacity-30"
                        title="5秒進む"
                        aria-label="5秒進む"
                    >
                        <FastForward className="h-4 w-4" />
                    </button>
                </div>
                <div className="flex items-center justify-self-end gap-1.5" title="プレビュー音量（書き出しには影響しません）">
                    <button
                        type="button"
                        onClick={togglePreviewMute}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/[0.05] hover:text-zinc-100"
                        aria-label={volume > 0 ? "プレビューをミュート" : "プレビューのミュートを解除"}
                        title={volume > 0 ? "ミュート [M]" : "ミュート解除 [M]"}
                    >
                        {volume > 0 ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                    </button>
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={volume}
                        onChange={(event) => {
                            const next = Number(event.target.value)
                            setVolume(next)
                        }}
                        onWheel={(event) => {
                            event.preventDefault()
                            setVolume(volume + (event.deltaY < 0 ? 0.05 : -0.05))
                        }}
                        aria-label="プレビュー音量"
                        aria-valuetext={`${Math.round(volume * 100)}%`}
                        className="h-1.5 w-20 cursor-pointer appearance-none rounded-full bg-zinc-800 accent-cyan-300"
                    />
                    <button type="button" onClick={() => setVolume(1)} className="w-8 text-right font-mono text-[9px] tabular-nums text-zinc-600 hover:text-zinc-200" title="100%へ戻す">{Math.round(volume * 100)}%</button>
                    <details className="group relative">
                        <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-100 [&::-webkit-details-marker]:hidden" aria-label="簡易オーディオミキサー" title="簡易ミキサー">
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                        </summary>
                        <div className="absolute bottom-10 right-0 z-50 w-64 rounded-xl border border-white/10 bg-[#111821] p-3 shadow-2xl">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-[10px] font-semibold text-zinc-200">プレビュー簡易ミキサー</span>
                                <button type="button" onClick={() => { setPreviewMainVolume(1); setPreviewBgmVolume(1); setPreviewTrackVolume(1) }} className="text-[8px] text-zinc-600 hover:text-zinc-200">リセット</button>
                            </div>
                            {([
                                ["元動画", previewMainVolume, setPreviewMainVolume, false],
                                ["BGM", previewBgmVolume, setPreviewBgmVolume, roughCutMode || !bgmPath],
                                ["追加音声", previewTrackVolume, setPreviewTrackVolume, roughCutMode || !hasAdditionalAudio],
                            ] as const).map(([label, value, setter, disabled]) => (
                                <label key={label} className={`grid grid-cols-[48px_1fr_32px] items-center gap-2 py-1.5 text-[9px] ${disabled ? "opacity-35" : ""}`}>
                                    <span className="text-zinc-500">{label}</span>
                                    <input type="range" min={0} max={1} step={0.01} value={value} disabled={disabled} onChange={(event) => setter(Number(event.target.value))} aria-label={`${label}のプレビュー音量`} className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-cyan-300" />
                                    <span className="text-right font-mono text-zinc-600">{Math.round(value * 100)}%</span>
                                </label>
                            ))}
                            <p className="mt-2 border-t border-white/[0.05] pt-2 text-[8px] leading-relaxed text-zinc-600">試聴専用です。書き出し音量は各クリップ・BGM設定で調整します。</p>
                        </div>
                    </details>
                </div>
            </div>
        </div>
    )
}

export function PreviewPane({ title, detail }: { title: string; detail: string }) {
    const videoInfo = useDocumentStore((state) => state.videoInfo)
    const sourcePreviewTime = useEditorStore((state) => state.sourcePreviewTime)
    return (
        <section className="tc-preview-pane flex h-full min-h-0 flex-col border-l border-white/[0.07] bg-[#070a0f]">
            <div className="flex h-14 flex-none items-center justify-between border-b border-white/[0.06] bg-[#0e141c] px-4">
                <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-cyan-300/10 bg-cyan-300/[0.05] text-cyan-200">
                        <MonitorPlay className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                        <h2 className="truncate text-[12px] font-semibold text-zinc-100">{title}</h2>
                        {import.meta.env.DEV && <p className="mt-0.5 truncate text-[9px] text-zinc-500">{detail}</p>}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {sourcePreviewTime !== null && <span data-testid="source-preview-indicator" className="rounded-md border border-violet-300/15 bg-violet-300/[0.06] px-2 py-1 text-[9px] text-violet-100">候補 · 元動画 {formatTransportTime(sourcePreviewTime)}</span>}
                    {videoInfo && <span className="flex-none rounded-md border border-white/[0.07] bg-black/15 px-2 py-1 font-mono text-[9px] text-zinc-500">{videoInfo.width}×{videoInfo.height}</span>}
                </div>
            </div>
            <div className="tc-preview-stage min-h-0 flex-1 bg-[radial-gradient(circle_at_50%_42%,rgba(34,211,238,0.035),transparent_55%)]">
                <VideoPreview />
            </div>
            <PreviewTransport />
        </section>
    )
}
