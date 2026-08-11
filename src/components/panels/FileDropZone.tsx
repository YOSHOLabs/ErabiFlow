import { FileVideo2, FolderOpen } from "lucide-react"
import { open } from "@tauri-apps/plugin-dialog"
import { hasBlockingBackgroundJob } from "@/lib/backgroundJob"
import { useBackgroundJobStore } from "@/stores/backgroundJobs"
import { useDocumentStore } from "@/stores/document"
import { useEditorStore } from "@/stores/editor"
import { createMediaAsset } from "@/lib/mediaLibrary"
import { isActiveAnalysisJob } from "@/lib/analysisJob"
import { useState } from "react"

export function FileDropZone() {
    const [error, setError] = useState<string | null>(null)
    const inputPath = useDocumentStore((state) => state.inputPath)
    const setInputPath = useDocumentStore((state) => state.setInputPath)
    const addMediaAssets = useDocumentStore((state) => state.addMediaAssets)
    const setWorkspace = useEditorStore((state) => state.setWorkspace)
    const isAnalyzing = useDocumentStore((state) => {
        const active = state.analysisJobs.find((job) => job.id === state.activeAnalysisJobId)
        return isActiveAnalysisJob(active)
    })
    const isProcessing = useBackgroundJobStore((state) => hasBlockingBackgroundJob(state.jobs))
    const hasBackgroundOperation = isProcessing || isAnalyzing

    const handleSelect = async () => {
        if (hasBackgroundOperation) return
        setError(null)
        try {
            const file = await open({
                multiple: false,
                filters: [{ name: "Video", extensions: ["mp4", "mov", "avi", "mkv"] }],
            })
            if (file) {
                const path = file as string
                if (path === inputPath) return
                if (inputPath && !window.confirm("元動画を変更すると、現在のタイムライン、字幕、解析結果が削除されます。\n元動画を変更しますか？")) return
                const asset = createMediaAsset(path)
                if (asset) addMediaAssets([asset])
                setInputPath(path)
                setWorkspace("draft")
                // 素材変更を新しい編集履歴の起点にする。
                useDocumentStore.temporal.getState().clear()
            }
        } catch (error) {
            console.error("ファイル選択エラー:", error)
            setError("動画を開けませんでした。ファイル形式とアクセス権を確認してください。")
        }
    }

    if (inputPath) {
        return (
            <div>
                <div className="flex items-center gap-2.5 border-l-2 border-emerald-400/50 bg-emerald-400/[0.025] px-3 py-2.5 text-xs">
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-300">
                        {inputPath.split(/[\\/]/).pop()}
                    </span>
                    <button
                        type="button"
                        onClick={handleSelect}
                        disabled={hasBackgroundOperation}
                        title={hasBackgroundOperation ? "処理中は元動画を変更できません" : undefined}
                        className="flex-none text-[10px] text-zinc-600 transition hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                        変更
                    </button>
                </div>
                {error && <p role="alert" className="mt-2 text-[11px] leading-5 text-red-300">{error}</p>}
            </div>
        )
    }

    return (
        <div>
            <button
                type="button"
                onClick={handleSelect}
                disabled={hasBackgroundOperation}
                className="group w-full rounded-xl border border-dashed border-white/[0.16] bg-black/15 p-6 text-center transition-all hover:-translate-y-0.5 hover:border-cyan-300/40 hover:bg-cyan-300/[0.025] hover:shadow-xl hover:shadow-cyan-950/20 focus:outline-none focus:ring-2 focus:ring-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
                <div className="flex min-h-[236px] flex-col items-center justify-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/[0.07] text-cyan-200 transition-transform group-hover:scale-105">
                        <FileVideo2 className="h-5 w-5" />
                    </div>
                    <p className="mt-5 text-[15px] font-semibold text-zinc-100">動画を選択して始める</p>
                    <p className="mt-2 text-[11px] leading-5 text-zinc-500">
                        解析する元動画を読み込みます<br />MP4 · MOV · AVI · MKV
                    </p>
                    <span className="mt-6 inline-flex w-fit items-center gap-2 rounded-lg bg-cyan-300 px-5 py-2.5 text-[12px] font-semibold text-cyan-950 shadow-lg shadow-cyan-950/20 transition-colors group-hover:bg-cyan-200">
                        <FolderOpen className="h-3.5 w-3.5" />
                        ファイルを開く
                    </span>
                </div>
            </button>
            {error && <p role="alert" className="mt-2 text-[11px] leading-5 text-red-300">{error}</p>}
        </div>
    )
}
