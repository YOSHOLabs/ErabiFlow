import { useDocumentStore } from "@/stores/document"
import { useEditorStore } from "@/stores/editor"
import { commands } from "@/tauri/commands"
import { useState, useCallback, useEffect, useRef } from "react"
import { NleTimeline } from "./NleTimeline"
import { Maximize2, MousePointer2, Scissors, StepBack, StepForward, ZoomIn, ZoomOut } from "lucide-react"
import { createClipsExcludingRanges, getSequenceDuration } from "@/lib/timeline"

export function TimelinePanel() {
    const videoInfo = useDocumentStore((s) => s.videoInfo)
    const inputPath = useDocumentStore((s) => s.inputPath)
    
    // Timeline state
    const setPreviewTime = useEditorStore((s) => s.setPreviewTime)
    const isPlaying = useEditorStore((s) => s.isPlaying)
    const setIsPlaying = useEditorStore((s) => s.setIsPlaying)
    const activeTool = useEditorStore((s) => s.activeTool)
    const setActiveTool = useEditorStore((s) => s.setActiveTool)

    // Silence detection items
    const silenceSegments = useDocumentStore((s) => s.silenceSegments)
    const setSilenceSegments = useDocumentStore((s) => s.setSilenceSegments)
    const enableJumpCut = useDocumentStore((s) => s.processing.enableJumpCut)
    const jumpCutConfig = useDocumentStore((s) => s.processing.jumpCutConfig)

    // Sequence clips
    const timelineClips = useDocumentStore((s) => s.timelineClips)
    const setTimelineClips = useDocumentStore((s) => s.setTimelineClips)

    const recommendedCuts = useDocumentStore((s) => s.recommendedCuts)
    const excitementGraph = useDocumentStore((s) => s.excitementGraph)
    const hasExcitementLane = recommendedCuts.length > 0 || excitementGraph.some((score) => score >= 60)

    const [isDetecting, setIsDetecting] = useState(false)
    const { duration } = videoInfo || { duration: 0 }
    const sequenceDuration = getSequenceDuration(timelineClips) || duration
    const timelineViewportRef = useRef<HTMLDivElement>(null)
    const didInitialFitRef = useRef(false)
    const lastFitDurationRef = useRef(0)
    const [viewportWidth, setViewportWidth] = useState(0)

    // 最小倍率は現在のシーケンス全体が表示領域へ収まる値。
    const fitPps = Math.max(0.5, sequenceDuration > 0 && viewportWidth > 0 ? (viewportWidth - 64) / sequenceDuration : 1)
    const PPS_MIN = Math.min(200, fitPps)
    const PPS_MAX = 200
    const zoomRatio = Math.max(1.0001, PPS_MAX / PPS_MIN)
    const [pps, setPps] = useState(10)

    useEffect(() => {
        const element = timelineViewportRef.current
        if (!element) return

        const updateWidth = () => setViewportWidth(element.clientWidth)
        updateWidth()
        const observer = new ResizeObserver(updateWidth)
        observer.observe(element)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        if (viewportWidth <= 0 || sequenceDuration <= 0) return
        const previousDuration = lastFitDurationRef.current
        const durationRatio = previousDuration > 0
            ? Math.max(previousDuration, sequenceDuration) / Math.min(previousDuration, sequenceDuration)
            : 1

        if (!didInitialFitRef.current || durationRatio >= 1.5) {
            setPps(PPS_MIN)
            didInitialFitRef.current = true
            lastFitDurationRef.current = sequenceDuration
        }
    }, [PPS_MIN, sequenceDuration, viewportWidth])

    // 再生ヘッドが表示範囲から出る前に、タイムライン側を追従させる。
    // 再生中は右側に少し先読み領域を残し、停止中のシークでは必要な時だけ移動する。
    useEffect(() => {
        const viewport = timelineViewportRef.current
        if (!viewport || viewport.clientWidth <= 0) return

        const followPlayhead = (time: number) => {
            const playheadX = Math.max(0, Math.min(sequenceDuration, time)) * pps
            const left = viewport.scrollLeft
            const width = viewport.clientWidth
            const playing = useEditorStore.getState().isPlaying
            const safeLeft = left + Math.min(56, width * 0.12)
            const safeRight = left + width * (playing ? 0.78 : 0.94)

            if (playheadX < safeLeft || playheadX > safeRight) {
                const anchor = playing ? width * 0.28 : width * 0.5
                viewport.scrollLeft = Math.max(0, playheadX - anchor)
            }
        }

        followPlayhead(useEditorStore.getState().previewTime)
        return useEditorStore.subscribe((state, previous) => {
            if (state.previewTime !== previous.previewTime) {
                followPlayhead(state.previewTime)
            }
        })
    }, [isPlaying, pps, sequenceDuration])

    const stepFrame = useCallback((direction: -1 | 1) => {
        const fps = Math.max(1, videoInfo?.fps ?? 30)
        const previewTime = useEditorStore.getState().previewTime
        setIsPlaying(false)
        setPreviewTime(Math.max(0, Math.min(sequenceDuration, previewTime + direction / fps)))
    }, [sequenceDuration, setIsPlaying, setPreviewTime, videoInfo?.fps])

    // Detect Silence
    const handleDetectSilence = useCallback(async () => {
        if (!inputPath || isDetecting || !videoInfo) return
        setIsDetecting(true)
        try {
            if (typeof window === "undefined" || (!(window as any).__TAURI_INTERNALS__ && !(window as any).__TAURI__)) {
                setIsDetecting(false); return
            }
            const result = await commands.detectSilenceSegments({
                inputPath,
                trimStart: null,
                trimDuration: null,
                thresholdDb: jumpCutConfig.thresholdDb,
                minDuration: jumpCutConfig.minDuration,
                padding: jumpCutConfig.padding,
            })
            
            if (result.length > 0) {
                setTimelineClips(createClipsExcludingRanges(duration, result))
            }
            setSilenceSegments(result)
        } catch (err) {
            console.error("Silence detection failed:", err)
        } finally {
            setIsDetecting(false)
        }
    }, [inputPath, duration, isDetecting, setSilenceSegments, setTimelineClips, videoInfo, jumpCutConfig])

    if (!videoInfo || videoInfo.duration === 0) return null

    return (
        <div className="flex flex-col w-full h-full text-xs overflow-hidden select-none bg-[#111113] border-t border-zinc-900 shadow-inner">
            
            {/* ====== TOP TOOLBAR ====== */}
            <div className="flex-none h-11 border-b border-zinc-800/80 bg-zinc-900 flex items-center px-3 justify-between shadow-sm z-20">
                {/* Left: Tools */}
                <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex items-center gap-1.5 border border-zinc-800 rounded bg-zinc-950 p-0.5">
                        <button 
                            onClick={() => setActiveTool("selection")}
                            className={`w-8 h-7 flex items-center justify-center rounded-sm transition-colors ${activeTool === 'selection' ? 'bg-indigo-600 shadow-sm text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}`}
                            title="選択ツール [V]"
                        >
                            <MousePointer2 className="w-4 h-4" />
                        </button>
                        <button 
                            onClick={() => setActiveTool("razor")}
                            className={`w-8 h-7 flex items-center justify-center rounded-sm transition-colors ${activeTool === 'razor' ? 'bg-red-600 shadow-sm text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}`}
                            title="分割ツール [C]"
                        >
                            <Scissors className="w-4 h-4" />
                        </button>
                    </div>
                    <span className="truncate text-[11px] font-semibold text-zinc-300">タイムライン</span>
                    <span className="hidden font-mono text-[9px] text-zinc-600 xl:inline">{formatTime(sequenceDuration)}</span>
                    <div className="hidden items-center gap-0.5 rounded border border-zinc-800 bg-zinc-950/70 p-0.5 md:flex">
                        <button
                            type="button"
                            onClick={() => stepFrame(-1)}
                            className="flex h-6 w-6 items-center justify-center rounded-sm text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                            title="1フレーム戻る [←]"
                        >
                            <StepBack className="h-3.5 w-3.5" />
                        </button>
                        <span className="min-w-12 text-center font-mono text-[9px] text-zinc-500">
                            {Math.round(videoInfo.fps ?? 30)} FPS
                        </span>
                        <button
                            type="button"
                            onClick={() => stepFrame(1)}
                            className="flex h-6 w-6 items-center justify-center rounded-sm text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                            title="1フレーム進む [→]"
                        >
                            <StepForward className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>

                {/* Right: AI & Sub Actions */}
                <div className="flex items-center gap-3">
                    {enableJumpCut && (
                        <button
                            onClick={handleDetectSilence}
                            disabled={isDetecting}
                            className="h-7 px-3 flex items-center gap-1.5 rounded bg-zinc-800/60 hover:bg-zinc-700/80 border border-zinc-700/50 text-zinc-300 transition-all disabled:opacity-50"
                        >
                            {isDetecting ? (
                                <div className="w-3.5 h-3.5 border-2 border-zinc-500/40 border-t-zinc-300 rounded-full animate-spin" />
                            ) : (
                                <Scissors className="w-3.5 h-3.5" />
                            )}
                            <span className="font-medium text-[11px]">{silenceSegments.length > 0 ? `${silenceSegments.length} CUTS` : "AUTO CUT"}</span>
                        </button>
                    )}

                    {/* Zoom Controls — 対数スケールスライダー */}
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={() => setPps(PPS_MIN)}
                            className="w-6 h-6 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                            title="全体を表示"
                        >
                            <Maximize2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setPps(p => Math.max(PPS_MIN, p * 0.7))}
                            className="w-6 h-6 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                            title="ズームアウト">
                            <ZoomOut className="w-3.5 h-3.5" />
                        </button>
                        <input
                            type="range" min="0" max="100" step="1"
                            value={Math.round(Math.log(Math.max(pps, PPS_MIN) / PPS_MIN) / Math.log(zoomRatio) * 100)}
                            onChange={(e) => {
                                const t = Number(e.target.value) / 100
                                setPps(PPS_MIN * Math.pow(PPS_MAX / PPS_MIN, t))
                            }}
                            className="w-24 h-1 appearance-none bg-zinc-700 rounded-full cursor-pointer
                                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-400
                                [&::-webkit-slider-thumb]:hover:bg-indigo-300 [&::-webkit-slider-thumb]:transition-colors"
                            title={`ズーム: ${pps.toFixed(1)}px/s`}
                        />
                        <button onClick={() => setPps(p => Math.min(PPS_MAX, p * 1.4))}
                            className="w-6 h-6 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                            title="ズームイン">
                            <ZoomIn className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </div>

            {/* ====== TIMELINE MAIN AREA ====== */}
            <div className="flex-1 flex overflow-y-auto bg-[#0c0c0e] custom-scrollbar">
                
                {/* Track Headers (Left Fix Panel) */}
                <div className="w-[132px] flex-none border-r border-zinc-800 bg-[#161618] flex flex-col z-10 shadow-md">
                    
                    {/* Time Ruler Header Spacing */}
                    <div className="h-[34px] border-b border-zinc-800/70 bg-[#1e1e20]" />

                    {hasExcitementLane && (
                        <div className="flex h-[28px] items-center border-l-4 border-l-amber-400/60 bg-[#202022] pl-2">
                            <span className="text-[10px] font-semibold text-amber-100/70">盛り上がり候補</span>
                        </div>
                    )}
                    
                    {/* Tracks Definition */}
                    <div className="flex flex-1 flex-col pl-1 pr-0">
                        <div className="mt-[2px] flex h-[138px] items-center border-l-4 border-l-cyan-500/80 bg-[#222225] pl-2 shadow-sm">
                            <div><span className="text-[12px] font-bold text-zinc-300/80">KEEP</span><p className="mt-1 text-[8px] leading-relaxed text-zinc-600">映像＋元音声</p></div>
                        </div>
                    </div>
                </div>

                {/* Timeline Tracks Area (Scrollable horizontal) */}
                <div ref={timelineViewportRef} className="flex-1 overflow-x-auto overflow-y-visible custom-scrollbar relative">
                    <NleTimeline
                        pps={pps}
                        setPps={setPps}
                        ppsMin={PPS_MIN}
                        ppsMax={PPS_MAX}
                        viewportWidth={viewportWidth}
                        roughCutOnly
                    />
                </div>
            </div>
        </div>
    )
}

function formatTime(sec: number): string {
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    const ms = Math.floor((sec % 1) * 100)
    return `${m}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`
}
