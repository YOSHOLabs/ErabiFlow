import { useDocumentStore } from "@/stores/document"
import { SectionHeader } from "@/components/ui/controls"

export function ProcessingSettings() {
    const processing = useDocumentStore((s) => s.processing)
    const setProcessing = useDocumentStore((s) => s.setProcessing)

    return (
        <section className="space-y-5">
            <SectionHeader>エンコード設定</SectionHeader>

            {/* エンコーダー選択 */}
            <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-zinc-400">エンコーダー</label>
                <select
                    className="
                        w-full px-3 py-2 rounded-lg
                        bg-zinc-800/60 border border-zinc-700/40
                        text-zinc-200 text-sm
                        focus:outline-none focus:ring-2 focus:ring-purple-600/40
                    "
                    value={processing.gpuType}
                    onChange={(e) => setProcessing({ gpuType: e.target.value })}
                >
                    <option value="CPU">CPU (h264)</option>
                    <option value="NVIDIA">NVIDIA GPU (h264_nvenc)</option>
                    <option value="AMD">AMD GPU (h264_amf)</option>
                </select>
            </div>

        </section>
    )
}
