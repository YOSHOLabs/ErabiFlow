import { open } from "@tauri-apps/plugin-dialog"
import { useDocumentStore } from "@/stores/document"
import { SectionHeader } from "@/components/ui/controls"
import { Button } from "@/components/ui/button"
import { Trash2, Plus, Volume2, Clock } from "lucide-react"

export function SeSettings({ allowAdd = true }: { allowAdd?: boolean }) {
    const seSlots = useDocumentStore((s) => s.seSlots)
    const addSeSlot = useDocumentStore((s) => s.addSeSlot)
    const removeSeSlot = useDocumentStore((s) => s.removeSeSlot)
    const updateSeSlot = useDocumentStore((s) => s.updateSeSlot)
    const videoInfo = useDocumentStore((s) => s.videoInfo)

    const handleAddSlot = async () => {
        if (seSlots.length >= 8) return
        try {
            const file = await open({
                multiple: false,
                filters: [{ name: "Audio", extensions: ["mp3", "wav", "m4a", "ogg", "flac"] }],
            })
            if (file) {
                const name = (file as string).split("\\").pop() || "SE"
                addSeSlot({
                    id: `se_${Date.now()}`,
                    path: file as string,
                    volume: 0.8,
                    triggerTime: 0,
                    label: name,
                })
            }
        } catch (err) {
            console.error(err)
        }
    }

    const canAdd = seSlots.length < 8

    return (
        <section className="space-y-5">
            <SectionHeader>SE（効果音）</SectionHeader>

            {/* SEスロット一覧 */}
            {seSlots.length > 0 && (
                <div className="space-y-3">
                    {seSlots.map((slot: any, index: number) => (
                        <div
                            key={slot.id}
                            className="rounded-xl bg-zinc-900/40 border border-zinc-800/60 p-3.5 space-y-3"
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-5 h-5 rounded-md bg-zinc-800 flex items-center justify-center flex-shrink-0">
                                        <span className="text-[10px] text-zinc-400 font-mono font-medium">{(index + 1).toString().padStart(2, "0")}</span>
                                    </div>
                                    <span className="text-xs text-zinc-300 truncate font-medium">
                                        {slot.label}
                                    </span>
                                </div>
                                <button
                                    onClick={() => removeSeSlot(slot.id)}
                                    className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>

                            <div className="space-y-4 pt-1 border-t border-zinc-800/60">
                                <div className="space-y-1.5">
                                    <div className="flex justify-between items-center text-[10px] text-zinc-400">
                                        <div className="flex items-center gap-1.5">
                                            <Clock className="w-3.5 h-3.5" />
                                            <span>開始位置</span>
                                        </div>
                                        <span className="font-mono bg-zinc-950 px-1.5 py-0.5 rounded text-zinc-300">
                                            {Number(slot.triggerTime).toFixed(2)}s
                                        </span>
                                    </div>
                                    <input
                                        type="range"
                                        min={0}
                                        max={videoInfo?.duration || 100}
                                        step={0.1}
                                        value={slot.triggerTime}
                                        onChange={(e) => updateSeSlot(slot.id, { triggerTime: parseFloat(e.target.value) })}
                                        className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <div className="flex justify-between items-center text-[10px] text-zinc-400">
                                        <div className="flex items-center gap-1.5">
                                            <Volume2 className="w-3.5 h-3.5" />
                                            <span>音量</span>
                                        </div>
                                        <span className="font-mono">{Math.round(slot.volume * 100)}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        min={0}
                                        max={2}
                                        step={0.05}
                                        value={slot.volume}
                                        onChange={(e) => updateSeSlot(slot.id, { volume: parseFloat(e.target.value) })}
                                        className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {allowAdd ? (
                <Button
                    variant="outline"
                    disabled={!canAdd}
                    onClick={handleAddSlot}
                    className="w-full h-10 border-dashed border-zinc-700/60 bg-transparent hover:bg-zinc-800/40 text-xs text-zinc-400 hover:text-zinc-200 group"
                >
                    <Plus className="w-4 h-4 mr-2 opacity-70 group-hover:opacity-100 transition-opacity" />
                    {canAdd ? "SE素材を追加" : "上限 (8個) に達しています"}
                </Button>
            ) : seSlots.length === 0 ? (
                <p className="rounded-xl border border-dashed border-zinc-700/50 bg-zinc-900/30 p-3 text-[10px] text-zinc-500">
                    SEの追加は「素材」タブにまとめています。
                </p>
            ) : null}
        </section>
    )
}
