import { useDocumentStore } from "@/stores/document"
import { open } from "@tauri-apps/plugin-dialog"
import { SliderRow, SectionHeader } from "@/components/ui/controls"
import { Button } from "@/components/ui/button"
import { Trash2, Plus, Move, ZoomIn, Clock } from "lucide-react"

export function ImageSettings({ allowAdd = true }: { allowAdd?: boolean }) {
    const images = useDocumentStore((s) => s.images)
    const addImage = useDocumentStore((s) => s.addImage)
    const removeImage = useDocumentStore((s) => s.removeImage)
    const updateImage = useDocumentStore((s) => s.updateImage)
    const videoInfo = useDocumentStore((s) => s.videoInfo)

    const handleAddImage = async () => {
        try {
            const file = await open({
                multiple: false,
                filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }],
            })
            if (file) {
                const name = (file as string).split("\\").pop() || "Image"
                addImage({
                    id: `img_${Date.now()}`,
                    path: file as string,
                    position: { x: 0.5, y: 0.5 },
                    scale: 0.3,
                    startTime: 0,
                    endTime: videoInfo?.duration ?? 10,
                    label: name,
                })
            }
        } catch (err) {
            console.error(err)
        }
    }

    return (
        <section className="space-y-5">
            <SectionHeader>画像オーバーレイ</SectionHeader>

            {images.length > 0 && (
                <div className="space-y-3">
                    {images.map((img, index) => (
                        <div
                            key={img.id}
                            className="rounded-xl bg-zinc-900/40 border border-zinc-800/60 p-3.5 space-y-3"
                        >
                            {/* ヘッダー行 */}
                            <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-md bg-cyan-900/40 border border-cyan-700/30 flex items-center justify-center flex-shrink-0">
                                    <span className="text-[10px] font-bold text-cyan-400">{index + 1}</span>
                                </div>
                                <p className="text-xs text-zinc-300 truncate flex-1 font-medium" title={img.label}>
                                    {img.label}
                                </p>
                                <button
                                    onClick={async () => {
                                        try {
                                            const file = await open({
                                                multiple: false,
                                                filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }],
                                            })
                                            if (file) {
                                                const name = (file as string).split("\\").pop() || "Image"
                                                updateImage(img.id, { path: file as string, label: name })
                                            }
                                        } catch {}
                                    }}
                                    className="text-xs text-zinc-500 hover:text-zinc-200 transition-colors px-1"
                                >
                                    変更
                                </button>
                                <button
                                    onClick={() => removeImage(img.id)}
                                    className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            {/* スケール */}
                            <div className="flex items-center gap-2">
                                <ZoomIn className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                                <SliderRow
                                    label="サイズ"
                                    value={img.scale}
                                    min={0.05} max={1.0} step={0.01}
                                    display={`${Math.round(img.scale * 100)}`}
                                    unit="%"
                                    accent="accent-cyan-500"
                                    onChange={(v) => updateImage(img.id, { scale: v })}
                                />
                            </div>

                            {/* 位置（ドラッグでも設定可能の案内） */}
                            <div className="flex items-center gap-2">
                                <Move className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                                <span className="text-[10px] text-zinc-600">
                                    プレビュー上でドラッグして位置調整
                                </span>
                            </div>

                            {/* 時間範囲 */}
                            <div className="flex items-center gap-2">
                                <Clock className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                                <div className="flex items-center gap-2 flex-1">
                                    <input
                                        type="number"
                                        min="0"
                                        max={img.endTime}
                                        step="0.1"
                                        value={img.startTime}
                                        onChange={(e) => updateImage(img.id, { startTime: parseFloat(e.target.value) || 0 })}
                                        className="bg-zinc-800/80 border border-zinc-700/60 rounded focus:border-zinc-500 focus:outline-none px-2 py-1 text-sm text-zinc-200 w-16 text-right"
                                    />
                                    <span className="text-[10px] text-zinc-600">〜</span>
                                    <input
                                        type="number"
                                        min={img.startTime}
                                        max={videoInfo?.duration ?? 9999}
                                        step="0.1"
                                        value={img.endTime}
                                        onChange={(e) => updateImage(img.id, { endTime: parseFloat(e.target.value) || 0 })}
                                        className="bg-zinc-800/80 border border-zinc-700/60 rounded focus:border-zinc-500 focus:outline-none px-2 py-1 text-sm text-zinc-200 w-16 text-right"
                                    />
                                    <span className="text-[10px] text-zinc-500">秒</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* 追加ボタン */}
            {allowAdd ? (
                <button
                    onClick={handleAddImage}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl
                        border border-dashed border-zinc-700/60 bg-zinc-800/20
                        text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800/40
                        transition-all text-sm"
                >
                    <Plus className="w-4 h-4" />
                    画像を追加
                </button>
            ) : images.length === 0 ? (
                <p className="rounded-xl border border-dashed border-zinc-700/50 bg-zinc-900/30 p-3 text-[10px] text-zinc-500">
                    画像の追加は「素材」タブにまとめています。
                </p>
            ) : null}
        </section>
    )
}
