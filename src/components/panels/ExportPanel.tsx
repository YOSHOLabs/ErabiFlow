import { FolderOpen } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { runSingleExport } from "@/controllers/backgroundJobs"
import { RoughCutHandoffPanel } from "@/features/delivery/RoughCutHandoffPanel"
import { isActiveBackgroundJob } from "@/lib/backgroundJob"
import { DEFAULT_EXPORT_SETTINGS, type ExportSettings } from "@/lib/exportParams"
import { computeExportPreflight } from "@/lib/preflight"
import { toRoughCutClips } from "@/lib/roughCut"
import { isTauriEnv } from "@/lib/utils"
import { useBackgroundJobStore } from "@/stores/backgroundJobs"
import { useDocumentStore } from "@/stores/document"
import { ExportPreflightPanel } from "./ExportPreflightPanel"

export function ExportPanel() {
    const inputPath = useDocumentStore((state) => state.inputPath)
    const videoInfo = useDocumentStore((state) => state.videoInfo)
    const gameLayoutMode = useDocumentStore((state) => state.game.layoutMode)
    const timelineClips = useDocumentStore((state) => state.timelineClips)
    const subtitles = useDocumentStore((state) => state.subtitles)
    const processing = useDocumentStore((state) => state.processing)
    const setGameLayoutMode = useDocumentStore((state) => state.setGameLayoutMode)
    const setTimelineClips = useDocumentStore((state) => state.setTimelineClips)
    const exportJob = useBackgroundJobStore((state) => state.jobs.export)
    const hasActiveMediaJob = useBackgroundJobStore((state) => isActiveBackgroundJob(state.jobs.export))
    const preflight = useMemo(() => computeExportPreflight({ inputPath, videoInfo, timelineClips, subtitles }), [inputPath, videoInfo, timelineClips, subtitles])
    const [settings, setSettings] = useState<ExportSettings>(() => {
        try {
            const saved = JSON.parse(localStorage.getItem("tateclip.exportSettings") ?? "{}")
            return {
                ...DEFAULT_EXPORT_SETTINGS,
                format: saved.format ?? "mp4",
                codec: saved.codec ?? "h264",
                bitrateKbps: saved.bitrateKbps ?? 12000,
                width: 0,
                height: 0,
                fps: 0,
            }
        } catch {
            return DEFAULT_EXPORT_SETTINGS
        }
    })
    const hiddenVideoRef = useRef<HTMLVideoElement>(null)

    useEffect(() => {
        localStorage.setItem("tateclip.exportSettings", JSON.stringify({ format: settings.format, codec: settings.codec, bitrateKbps: settings.bitrateKbps }))
    }, [settings.bitrateKbps, settings.codec, settings.format])

    const sourceWidth = videoInfo?.width ?? 1920
    const sourceHeight = videoInfo?.height ?? 1080
    const sourceFps = videoInfo?.fps ?? 30
    const videoUrl = useMemo(() => {
        if (gameLayoutMode === "source" || !inputPath || !processing.enableAutoReframe || !isTauriEnv()) return null
        const protocol = /Windows/i.test(navigator.userAgent) ? "http://vfocus.localhost" : "vfocus://"
        return `${protocol}/media/${encodeURIComponent(inputPath)}`
    }, [gameLayoutMode, inputPath, processing.enableAutoReframe])

    const switchToRoughCut = () => {
        setGameLayoutMode("source")
        setTimelineClips(toRoughCutClips(timelineClips))
        setSettings((current) => ({ ...current, width: 0, height: 0, fps: 0 }))
    }

    const isProcessing = isActiveBackgroundJob(exportJob)
    const progress = exportJob?.progress ?? processing.progress
    const phaseMessage = exportJob?.message ?? processing.phaseMessage
    const lastError = exportJob?.error ?? (exportJob ? null : processing.lastError)
    const lastOutputPath = exportJob?.outputPath ?? (exportJob ? null : processing.lastOutputPath)
    const canProcess = !hasActiveMediaJob && preflight.canExport

    return (
        <div className="space-y-4">
            {videoUrl && <video ref={hiddenVideoRef} src={videoUrl} crossOrigin="anonymous" className="hidden" preload="auto" />}
            <ExportPreflightPanel summary={preflight} />

            <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5">
                {gameLayoutMode !== "source" && <div className="mb-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-2.5 text-[9px] leading-relaxed text-amber-100/80">旧プロジェクトの構図と演出を維持しています。ラフカットへ切り替えると、元動画の画角・音声だけをKEEP順につなぎます。<button type="button" onClick={switchToRoughCut} className="mt-2 block rounded-md border border-amber-200/20 px-2 py-1 font-semibold text-amber-50 hover:bg-amber-200/[0.08]">クリーンなラフカットへ切り替える</button></div>}
                <div className="flex items-start justify-between gap-3">
                    <div><h3 className="text-[12px] font-semibold text-zinc-100">ラフカット動画</h3><p className="mt-1 text-[9px] text-zinc-600">元動画の画角とFPSを維持するのが既定です</p></div>
                    <span className="font-mono text-[9px] text-zinc-500">{sourceWidth}×{sourceHeight} · {Number(sourceFps).toFixed(2)}fps</span>
                </div>
                <div className="mt-3 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.035] px-3 py-2 text-[9px] leading-relaxed text-cyan-100/75">横・縦・正方形を自動判定し、そのまま出力します。縦横変換やリフレームは次の動画編集ソフトで行います。</div>
                <details className="mt-3">
                    <summary className="cursor-pointer text-[9px] font-semibold text-zinc-500">形式・品質を変更</summary>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="text-[9px] text-zinc-500">形式<select value={settings.format} onChange={(event) => setSettings((value) => ({ ...value, format: event.target.value as ExportSettings["format"] }))} className="mt-1 h-8 w-full rounded border border-white/[0.07] bg-[#151519] px-2 text-[10px] text-zinc-300"><option value="mp4">MP4</option><option value="mov">MOV</option></select></label>
                        <label className="text-[9px] text-zinc-500">コーデック<select value={settings.codec} onChange={(event) => setSettings((value) => ({ ...value, codec: event.target.value as ExportSettings["codec"] }))} className="mt-1 h-8 w-full rounded border border-white/[0.07] bg-[#151519] px-2 text-[10px] text-zinc-300"><option value="h264">H.264</option><option value="h265">H.265 / HEVC</option></select></label>
                        <label className="col-span-2 text-[9px] text-zinc-500">ビットレート<input type="number" min={256} max={100000} step={500} value={settings.bitrateKbps} onChange={(event) => setSettings((value) => ({ ...value, bitrateKbps: Number(event.target.value) }))} className="mt-1 h-8 w-full rounded border border-white/[0.07] bg-black/25 px-2 font-mono text-[10px] text-zinc-300" /></label>
                    </div>
                </details>
            </section>

            {isProcessing && <div className="space-y-2 rounded-xl border border-white/[0.07] bg-black/15 p-3"><div className="flex justify-between text-[10px] text-zinc-400"><span>{phaseMessage || "準備中..."}</span><span>{Math.round(progress)}%</span></div><Progress value={progress} /></div>}

            <Button data-testid="export-start-button" className="h-11 w-full rounded-md bg-cyan-500 text-[13px] font-semibold text-cyan-950 hover:bg-cyan-300 disabled:opacity-30" onClick={() => runSingleExport({ video: hiddenVideoRef.current, settings })} disabled={!canProcess}>
                {isProcessing ? "ラフカット動画を作成中..." : "ラフカット動画を書き出す"}
            </Button>

            {lastError && <div className="rounded-xl border border-red-300/15 bg-red-300/[0.05] p-3 text-[10px] text-red-200">{lastError}</div>}
            {lastOutputPath && !lastError && <section className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.05] p-3"><p className="text-[10px] font-semibold text-emerald-100">ラフカット動画を書き出しました</p><p className="mt-1 break-all font-mono text-[9px] text-emerald-100/60">{lastOutputPath}</p><button type="button" disabled={!isTauriEnv()} onClick={() => revealItemInDir(lastOutputPath.replace("%05d", "00001"))} className="mt-2 flex items-center gap-1.5 text-[9px] text-emerald-100 disabled:opacity-35"><FolderOpen className="h-3.5 w-3.5" />ファイルを表示</button></section>}

            <RoughCutHandoffPanel />
        </div>
    )
}
