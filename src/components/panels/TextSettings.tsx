import { useDocumentStore } from "@/stores/document"
import { SliderRow, SectionHeader } from "@/components/ui/controls"
import { COLOR_PRESETS } from "@/lib/constants"
import { FontPicker } from "@/components/ui/FontPicker"
import { TEXT_STYLE_PRESETS } from "@/lib/textPresets"

export function TextSettings() {
    const text = useDocumentStore((s) => s.text)
    const avatar = useDocumentStore((s) => s.avatar)
    const setText = useDocumentStore((s) => s.setText)
    const setTextPosition = useDocumentStore((s) => s.setTextPosition)

    const handleAutoPosition = () => {
        const safeY = avatar.position.y > 0.5 ? 0.15 : 0.85
        setTextPosition({ x: 0.5, y: safeY })
    }

    return (
        <section className="space-y-5">
            <div>
                <SectionHeader>画面テキスト</SectionHeader>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
                    冒頭に表示する画面テキストです。投稿メモの説明文とは別の項目です。空欄なら映像に表示しません。
                </p>
            </div>

            <textarea
                value={text.content}
                onChange={(e) => setText({ content: e.target.value })}
                aria-label="画面テキスト"
                placeholder="動画内に表示するテキスト（Enterで改行）"
                rows={2}
                className="
                    w-full px-3 py-2.5 rounded-xl
                    bg-zinc-800/60 border border-zinc-700/40
                    text-zinc-100 placeholder:text-zinc-600
                    focus:outline-none focus:ring-2 focus:ring-purple-600/50 focus:border-purple-600/50
                    text-sm transition-shadow resize-y min-h-[44px]
                "
            />

            <div className="rounded-xl border border-white/[0.06] bg-zinc-900/40 p-3">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <div className="text-[10px] font-semibold text-zinc-300">表示タイミング</div>
                        <div className="mt-0.5 text-[9px] text-zinc-600">冒頭だけにすると本編の画面を広く使えます。</div>
                    </div>
                    <div className="flex rounded-lg border border-white/[0.06] bg-black/15 p-0.5">
                        <button type="button" onClick={() => setText({ startTime: 0, endTime: 3 })} className={`rounded-md px-2 py-1 text-[8px] font-semibold ${text.endTime !== null ? "bg-pink-300/10 text-pink-100" : "text-zinc-600"}`}>冒頭</button>
                        <button type="button" onClick={() => setText({ startTime: 0, endTime: null })} className={`rounded-md px-2 py-1 text-[8px] font-semibold ${text.endTime === null ? "bg-white/[0.07] text-zinc-300" : "text-zinc-600"}`}>常時</button>
                    </div>
                </div>
                {text.endTime !== null && (
                    <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-3">
                        <input type="range" min={1} max={10} step={0.5} value={text.endTime} onChange={(event) => setText({ endTime: Number(event.target.value) })} className="w-full accent-pink-400" aria-label="画面テキスト表示終了" />
                        <span className="font-mono text-[9px] text-pink-100">0–{text.endTime.toFixed(1)}s</span>
                    </div>
                )}
            </div>

            <div className="space-y-4 p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/60">
                <SectionHeader>外観</SectionHeader>

                <div className="grid grid-cols-3 gap-1.5">
                    {TEXT_STYLE_PRESETS.map((preset) => (
                        <button key={preset.id} type="button" title={preset.description} onClick={() => setText(preset.title)} className="rounded-lg border border-white/[0.07] bg-black/15 px-1.5 py-2 text-[9px] font-medium text-zinc-400 transition hover:border-pink-300/20 hover:bg-pink-300/[0.06] hover:text-pink-100">
                            {preset.label}
                        </button>
                    ))}
                </div>

                <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-zinc-400">フォント</label>
                    <FontPicker value={text.font} onChange={(font) => setText({ font })} />
                </div>

                <SliderRow
                    label="サイズ" value={text.size} min={12} max={500} step={1}
                    unit="px"
                    onChange={(v) => setText({ size: v })}
                />
                <SliderRow
                    label="行間" value={text.lineHeight} min={1.0} max={3.0} step={0.1}
                    display={text.lineHeight.toFixed(1)}
                    onChange={(v) => setText({ lineHeight: v })}
                />
                <SliderRow
                    label="字間" value={text.letterSpacing} min={0} max={100} step={1}
                    unit="px"
                    onChange={(v) => setText({ letterSpacing: v })}
                />
            </div>

            <div className="space-y-4 p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/60">
                <SectionHeader>カラー</SectionHeader>

                <div className="space-y-2">
                    <label className="text-[11px] font-medium text-zinc-400">文字色</label>
                    <div className="flex items-center gap-2 flex-wrap">
                        {COLOR_PRESETS.map((c) => (
                            <button
                                key={c}
                                onClick={() => setText({ color: c })}
                                className={`
                                    w-7 h-7 rounded-lg border-2 transition-transform
                                    hover:scale-110
                                    ${text.color === c
                                        ? "border-white scale-110 shadow-md"
                                        : "border-transparent"
                                    }
                                `}
                                style={{ backgroundColor: c }}
                            />
                        ))}
                        <input
                            type="color"
                            value={text.color}
                            onChange={(e) => setText({ color: e.target.value })}
                            className="w-7 h-7 rounded-lg cursor-pointer bg-transparent border-0"
                            title="カスタムカラー"
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-[11px] font-medium text-zinc-400">縁取り</label>
                        <input
                            type="color"
                            value={text.strokeColor}
                            onChange={(e) => setText({ strokeColor: e.target.value })}
                            className="w-6 h-6 rounded cursor-pointer bg-transparent border-0"
                        />
                    </div>
                    <SliderRow
                        label="" value={text.strokeWidth} min={0} max={15}
                        unit="px"
                        onChange={(v) => setText({ strokeWidth: v })}
                    />
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-[11px] font-medium text-zinc-400">シャドウ</label>
                        <input
                            type="color"
                            value={text.shadowColor}
                            onChange={(e) => setText({ shadowColor: e.target.value })}
                            className="w-6 h-6 rounded cursor-pointer bg-transparent border-0"
                        />
                    </div>
                    <SliderRow
                        label="" value={text.shadowBlur} min={0} max={50}
                        unit="px" accent="accent-zinc-500"
                        onChange={(v) => setText({ shadowBlur: v })}
                    />
                </div>
            </div>

            <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-500">
                    位置: <span className="font-mono text-zinc-300">
                        {Math.round(text.position.x * 100)}%, {Math.round(text.position.y * 100)}%
                    </span>
                </span>
                <div className="flex gap-3">
                    <button
                        onClick={handleAutoPosition}
                        className="text-purple-400 hover:text-purple-300 transition-colors"
                    >
                        自動配置
                    </button>
                    <button
                        onClick={() => setTextPosition({ x: 0.5, y: 0.15 })}
                        className="text-zinc-600 hover:text-zinc-400 transition-colors"
                    >
                        リセット
                    </button>
                </div>
            </div>
        </section>
    )
}
