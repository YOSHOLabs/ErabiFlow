import { ExportPanel } from "./ExportPanel"
import { ProcessingSettings } from "./ProcessingSettings"

export function ExportInspector() {
    return (
        <div className="space-y-5 pb-2">
            <div className="border-l-2 border-cyan-300 pl-3">
                <h2 className="text-sm font-semibold text-zinc-100">受け渡し</h2>
                <p className="text-[10px] text-zinc-600">横・縦・任意尺 · 動画／EDL／CSV／JSON／SRT</p>
            </div>
            <ExportPanel />
            <details className="group">
                <summary className="cursor-pointer list-none rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[11px] font-semibold text-zinc-300 transition hover:bg-white/[0.04]">
                    エンコード設定
                </summary>
                <div className="mt-3"><ProcessingSettings /></div>
            </details>
        </div>
    )
}
