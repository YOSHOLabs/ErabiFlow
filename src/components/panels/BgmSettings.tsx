import { useDocumentStore } from "@/stores/document"
import { open } from "@tauri-apps/plugin-dialog"
import { Button } from "@/components/ui/button"
import { SliderRow, SectionHeader } from "@/components/ui/controls"
import { getEffectiveBgmEnd } from "@/lib/bgm"
import { getSequenceDuration } from "@/lib/timeline"

export function BgmSettings({ allowSourceSelection = true }: { allowSourceSelection?: boolean }) {
    const bgmPath = useDocumentStore((s) => s.bgmPath)
    const bgmVolume = useDocumentStore((s) => s.bgmVolume)
    const bgmStart = useDocumentStore((s) => s.bgmStart ?? 0)
    const bgmEnd = useDocumentStore((s) => s.bgmEnd ?? null)
    const bgmTrimStart = useDocumentStore((s) => s.bgmTrimStart ?? 0)
    const bgmSourceDuration = useDocumentStore((s) => s.bgmSourceDuration ?? null)
    const timelineClips = useDocumentStore((s) => s.timelineClips)
    const setBgmPath = useDocumentStore((s) => s.setBgmPath)
    const setBgmVolume = useDocumentStore((s) => s.setBgmVolume)
    const setBgmTiming = useDocumentStore((s) => s.setBgmTiming)

    const sequenceDuration = getSequenceDuration(timelineClips)
    const effectiveEnd = getEffectiveBgmEnd({
        sequenceDuration,
        start: bgmStart,
        end: bgmEnd,
        trimStart: bgmTrimStart,
        sourceDuration: bgmSourceDuration,
    })

    const handleSelect = async () => {
        try {
            const file = await open({
                multiple: false,
                filters: [{ name: "Audio", extensions: ["mp3", "wav", "m4a", "ogg", "flac"] }],
            })
            if (file) setBgmPath(file as string)
        } catch (err) {
            console.error(err)
        }
    }

    const handleClear = () => {
        setBgmPath("")
    }

    return (
        <section className="space-y-5">
            <div>
                <SectionHeader>BGM</SectionHeader>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
                    タイムラインのBGMクリップをドラッグして移動し、左右の端をドラッグしてカットできます。
                </p>
            </div>

            {bgmPath ? (
                <div className="space-y-4">
                    {/* ファイル情報行 */}
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/60">
                        <div className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700/50 flex items-center justify-center flex-shrink-0">
                            <svg className="w-5 h-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9 18V5l12-2v13" />
                                <circle cx="6" cy="18" r="3" />
                                <circle cx="18" cy="16" r="3" />
                            </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs text-zinc-200 truncate font-medium" title={bgmPath.split(/[\\/]/).pop() || ""}>
                                {bgmPath.split(/[\\/]/).pop()}
                            </p>
                        </div>
                        {allowSourceSelection && (
                            <button
                                onClick={handleSelect}
                                className="text-xs text-zinc-500 hover:text-zinc-200 transition-colors flex-shrink-0 px-2"
                            >
                                変更
                            </button>
                        )}
                    </div>

                    {/* 音量 */}
                    <SliderRow
                        label="音量"
                        value={bgmVolume}
                        min={0.0} max={1.0} step={0.05}
                        display={`${Math.round(bgmVolume * 100)}`}
                        unit="%"
                        accent="accent-blue-500"
                        onChange={setBgmVolume}
                    />

                    <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/[0.06] bg-black/15 p-3">
                        <TimeInput
                            label="動画内の開始"
                            value={bgmStart}
                            max={Math.max(0, sequenceDuration - 0.1)}
                            onChange={(start) => setBgmTiming({ start })}
                        />
                        <TimeInput
                            label="動画内の終了"
                            value={effectiveEnd}
                            min={bgmStart + 0.1}
                            max={sequenceDuration}
                            onChange={(end) => setBgmTiming({ end })}
                        />
                        <TimeInput
                            label="曲の読み始め"
                            value={bgmTrimStart}
                            max={bgmSourceDuration !== null ? Math.max(0, bgmSourceDuration - 0.1) : undefined}
                            onChange={(trimStart) => setBgmTiming({ trimStart })}
                        />
                    </div>

                    {/* 解除 */}
                    <button
                        onClick={handleClear}
                        className="text-[11px] text-red-500/80 hover:text-red-400 transition-colors"
                    >
                        BGMを削除
                    </button>
                </div>
            ) : allowSourceSelection ? (
                <Button
                    variant="outline"
                    onClick={handleSelect}
                    className="w-full h-12 border-zinc-700/60 bg-zinc-800/40 hover:bg-zinc-700/60 hover:text-white text-sm rounded-xl"
                >
                    BGMファイルを選択
                </Button>
            ) : (
                <p className="rounded-xl border border-dashed border-zinc-700/50 bg-zinc-900/30 p-3 text-[10px] text-zinc-500">
                    BGMの追加は「素材」タブにまとめています。
                </p>
            )}
        </section>
    )
}

function TimeInput({
    label,
    value,
    min = 0,
    max,
    onChange,
}: {
    label: string
    value: number
    min?: number
    max?: number
    onChange: (value: number) => void
}) {
    return (
        <label className="min-w-0 space-y-1.5">
            <span className="block truncate text-[9px] text-zinc-500" title={label}>{label}</span>
            <div className="flex items-center gap-1">
                <input
                    type="number"
                    min={min}
                    max={max}
                    step={0.1}
                    value={Number(value.toFixed(2))}
                    onChange={(event) => onChange(Number(event.target.value) || 0)}
                    className="h-8 min-w-0 w-full rounded-md border border-zinc-700/60 bg-zinc-800/80 px-2 text-right font-mono text-[10px] text-zinc-200 outline-none focus:border-cyan-400/40"
                />
                <span className="text-[9px] text-zinc-600">秒</span>
            </div>
        </label>
    )
}
