import { Check, FileJson, FileSpreadsheet, Subtitles } from "lucide-react"
import { useMemo, useState } from "react"
import { save } from "@tauri-apps/plugin-dialog"
import { buildRoughCutManifest, roughCutDocumentToSrt, roughCutManifestToCsv, roughCutManifestToEdl } from "@/lib/roughCut"
import { isTauriEnv } from "@/lib/utils"
import { useDocumentStore } from "@/stores/document"
import { commands } from "@/tauri/commands"

type HandoffFormat = "json" | "csv" | "edl" | "srt"

export function RoughCutHandoffPanel() {
    const inputPath = useDocumentStore((state) => state.inputPath)
    const videoInfo = useDocumentStore((state) => state.videoInfo)
    const timelineClips = useDocumentStore((state) => state.timelineClips)
    const subtitles = useDocumentStore((state) => state.subtitles)
    const document = useMemo(() => ({ inputPath, videoInfo, timelineClips, subtitles }), [inputPath, videoInfo, timelineClips, subtitles])
    const manifest = useMemo(() => buildRoughCutManifest(document), [document])
    const srt = useMemo(() => roughCutDocumentToSrt(document), [document])
    const [status, setStatus] = useState<string>("")
    const sourceStem = manifest.source.fileName.replace(/\.[^.]+$/, "") || "rough-cut"
    const canHandoff = manifest.entries.length > 0

    const exportText = async (format: HandoffFormat) => {
        const content = format === "json"
            ? JSON.stringify(manifest, null, 2) + "\n"
            : format === "csv"
                ? roughCutManifestToCsv(manifest)
                : format === "edl"
                    ? roughCutManifestToEdl(manifest)
                    : srt
        const fileName = `${sourceStem}_tateclip_roughcut.${format}`
        try {
            if (isTauriEnv()) {
                const path = await save({
                    defaultPath: fileName,
                    filters: [{ name: format.toUpperCase(), extensions: [format] }],
                })
                if (!path) return
                await commands.saveHandoffFile({ handoffPath: path, content })
            } else {
                const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }))
                const anchor = window.document.createElement("a")
                anchor.href = url
                anchor.download = fileName
                anchor.click()
                URL.revokeObjectURL(url)
            }
            setStatus(`${format.toUpperCase()}を書き出しました`)
        } catch (error) {
            console.error("Failed to export rough-cut handoff:", error)
            setStatus(`${format.toUpperCase()}の書き出しに失敗しました`)
        }
        window.setTimeout(() => setStatus(""), 2400)
    }

    return (
        <section className="rounded-2xl border border-violet-300/12 bg-violet-300/[0.035] p-3.5" data-testid="rough-cut-handoff-panel">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-[12px] font-semibold text-zinc-100">編集ソフトへ渡す</h3>
                    <p className="mt-1 text-[9px] leading-relaxed text-zinc-600">同じKEEP判断を、カット表・タイムライン・字幕として渡します。演出や仕上げは使い慣れた編集ソフトで行えます。</p>
                </div>
                <span className="rounded-full border border-violet-300/15 bg-violet-300/[0.07] px-2 py-1 text-[8px] font-semibold text-violet-100">NLE BRIDGE</span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
                <HandoffButton icon={<FileJson className="h-3.5 w-3.5" />} title="JSON" detail="完全なKEEPデータ" disabled={!canHandoff} onClick={() => exportText("json")} />
                <HandoffButton icon={<FileSpreadsheet className="h-3.5 w-3.5" />} title="CSV" detail="表計算・共有用" disabled={!canHandoff} onClick={() => exportText("csv")} />
                <HandoffButton icon={<FileSpreadsheet className="h-3.5 w-3.5" />} title="CMX 3600 EDL" detail="Premiere・DaVinci等" disabled={!canHandoff} onClick={() => exportText("edl")} />
                <HandoffButton icon={<Subtitles className="h-3.5 w-3.5" />} title="SRT字幕" detail={srt ? "ラフカット時間軸" : "字幕なし"} disabled={!canHandoff || !srt} onClick={() => exportText("srt")} />
            </div>
            {status && <p role="status" className="mt-2 flex items-center gap-1.5 text-[9px] text-emerald-200"><Check className="h-3 w-3" />{status}</p>}
            <p className="mt-3 border-t border-white/[0.05] pt-2.5 text-[8px] leading-relaxed text-zinc-600">{canHandoff ? "EDLは元動画への参照とIN／OUT、並び順を渡します。編集ソフト側で元動画を再リンクしてください。" : "KEEP区間を1つ以上作ると受け渡しデータを出力できます。"}</p>
        </section>
    )
}

function HandoffButton({ icon, title, detail, onClick, disabled = false }: { icon: React.ReactNode; title: string; detail: string; onClick: () => void; disabled?: boolean }) {
    return <button type="button" disabled={disabled} onClick={onClick} className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-black/15 px-3 py-2.5 text-left transition hover:border-violet-300/20 hover:bg-violet-300/[0.05] disabled:opacity-35"><span className="text-violet-200">{icon}</span><span><span className="block text-[10px] font-semibold text-zinc-200">{title}</span><span className="mt-0.5 block text-[8px] text-zinc-600">{detail}</span></span></button>
}
