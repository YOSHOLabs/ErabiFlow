import React, { useRef, useCallback, useEffect, useMemo } from "react"
import { useDocumentStore } from "@/stores/document"
import { useEditorStore } from "@/stores/editor"
import { NleClip } from "./NleClip"
import { GenericClip } from "./GenericClip"
import { getSequenceDuration, getTimelineClipDuration, getTimelineClipSpeed, layoutTimelineClips, mediaRangeToSequenceRanges, sequenceTimeToMedia, shouldReplaceTimelineOnFirstAdoption, timelineClipLocalTimeToMedia } from "@/lib/timeline"
import { learnScopedSubtitleCorrection } from "@/lib/subtitleLearning"
import type { AgentHighlight } from "@/lib/types"
import { getEffectiveBgmEnd } from "@/lib/bgm"
import { getEditorTimelineDuration } from "@/lib/multiTrack"

interface NleTimelineProps {
    pps: number
    setPps: (fn: (prev: number) => number) => void
    ppsMin: number
    ppsMax: number
    viewportWidth: number
    roughCutOnly?: boolean
}

export function NleTimeline({ pps, setPps, ppsMin, ppsMax, viewportWidth, roughCutOnly = false }: NleTimelineProps) {
    const clips = useDocumentStore(s => s.timelineClips)
    const setTimelineClips = useDocumentStore(s => s.setTimelineClips)
    const videoDuration = useDocumentStore(s => s.videoInfo?.duration ?? 0)
    
    const splitTimelineClip = useDocumentStore(s => s.splitTimelineClip)
    const updateTimelineClip = useDocumentStore(s => s.updateTimelineClip)
    
    // Secondary tracks
    const subtitles = useDocumentStore(s => s.subtitles)
    const updateSubtitle = useDocumentStore(s => s.updateSubtitle)
    const images = useDocumentStore(s => s.images)
    const updateImage = useDocumentStore(s => s.updateImage)
    const seSlots = useDocumentStore(s => s.seSlots)
    const updateSeSlot = useDocumentStore(s => s.updateSeSlot)
    const bgmPath = useDocumentStore(s => s.bgmPath)
    const bgmStart = useDocumentStore(s => s.bgmStart ?? 0)
    const bgmEnd = useDocumentStore(s => s.bgmEnd ?? null)
    const bgmTrimStart = useDocumentStore(s => s.bgmTrimStart ?? 0)
    const bgmSourceDuration = useDocumentStore(s => s.bgmSourceDuration ?? null)
    const setBgmTiming = useDocumentStore(s => s.setBgmTiming)
    const editorTracks = useDocumentStore(s => s.editorTracks)
    const trackMediaClips = useDocumentStore(s => s.trackMediaClips)
    const updateTrackMediaClipTiming = useDocumentStore(s => s.updateTrackMediaClipTiming)
    
    // AI Analysis data
    const excitementGraph = useDocumentStore(s => s.excitementGraph)
    const recommendedCuts = useDocumentStore(s => s.recommendedCuts)
    const setAgentThinking = useDocumentStore(s => s.setAgentThinking)

    const setPreviewTime = useEditorStore(s => s.setPreviewTime)
    const setIsPlaying = useEditorStore(s => s.setIsPlaying)
    const activeTool = useEditorStore(s => s.activeTool)
    const workspaceIn = useEditorStore(s => s.workspaceIn)
    const workspaceOut = useEditorStore(s => s.workspaceOut)

    const editorSelection = useEditorStore(s => s.selection)
    const selectEditorItem = useEditorStore(s => s.select)
    const selectedClipId = "id" in editorSelection ? editorSelection.id ?? null : null
    
    const containerRef = useRef<HTMLDivElement>(null)
    const rulerRef = useRef<HTMLDivElement>(null)
    const playheadRef = useRef<HTMLDivElement>(null)

    // 再生中はクリップ群をReact再描画せず、再生ヘッドのDOMだけを動かす。
    useEffect(() => {
        const movePlayhead = (time: number) => {
            if (playheadRef.current) {
                playheadRef.current.style.transform = `translateX(${Math.max(0, time) * pps}px)`
            }
        }
        movePlayhead(useEditorStore.getState().previewTime)
        return useEditorStore.subscribe((state, previous) => {
            if (state.previewTime !== previous.previewTime) {
                movePlayhead(state.previewTime)
            }
        })
    }, [pps])

    // Layout Calculation
    const layoutClips = useMemo(() => layoutTimelineClips(clips), [clips])

    // Subtitles Sequence Mapping
    const sequenceSubtitles = useMemo(() => {
        const result: { id: string; clipId: string; sub: any; seqStart: number; seqEnd: number }[] = []
        subtitles.forEach(sub => {
            mediaRangeToSequenceRanges(clips, sub.start, sub.end).forEach((range) => {
                result.push({
                    id: `${sub.id}_${range.clipId}`,
                    clipId: range.clipId,
                    sub,
                    seqStart: range.sequenceStart,
                    seqEnd: range.sequenceEnd,
                })
            })
        })
        return result
    }, [subtitles, clips])

    const sequenceRecommendedCuts = useMemo(() => {
        return recommendedCuts.flatMap((cut, cutIndex) =>
            mediaRangeToSequenceRanges(clips, cut.start, cut.end).map((range) => ({
                ...cut,
                key: `${cutIndex}_${range.clipId}`,
                sequenceStart: range.sequenceStart,
                sequenceEnd: range.sequenceEnd,
            }))
        )
    }, [recommendedCuts, clips])

    const excitementMoments = useMemo(() => {
        if (sequenceRecommendedCuts.length > 0) {
            return sequenceRecommendedCuts.map((cut) => ({
                key: `cut_${cut.key}`,
                sequenceStart: cut.sequenceStart,
                sequenceEnd: cut.sequenceEnd,
                score: cut.excitement,
                label: cut.label,
                cut,
            }))
        }

        const mediaMoments: { start: number; end: number; score: number }[] = []
        let active: { start: number; end: number; score: number } | null = null
        excitementGraph.forEach((score, second) => {
            if (score >= 60) {
                if (!active) active = { start: second, end: second + 1, score }
                else {
                    active.end = second + 1
                    active.score = Math.max(active.score, score)
                }
            } else if (active) {
                mediaMoments.push(active)
                active = null
            }
        })
        if (active) mediaMoments.push(active)

        return mediaMoments.flatMap((moment, index) =>
            mediaRangeToSequenceRanges(clips, moment.start, moment.end).map((range) => ({
                key: `graph_${index}_${range.clipId}`,
                sequenceStart: range.sequenceStart,
                sequenceEnd: range.sequenceEnd,
                score: moment.score,
                label: "盛り上がり",
                cut: null,
            }))
        )
    }, [clips, excitementGraph, sequenceRecommendedCuts])

    const totalDuration = Math.max(getSequenceDuration(clips), getEditorTimelineDuration(trackMediaClips))
    const effectiveBgmEnd = getEffectiveBgmEnd({
        sequenceDuration: totalDuration,
        start: bgmStart,
        end: bgmEnd,
        trimStart: bgmTrimStart,
        sourceDuration: bgmSourceDuration,
    })
    const timelineWidthPx = Math.max(totalDuration * pps + 64, viewportWidth)

    // --- Snap Points Calculation ---
    const snapPoints = useMemo(() => {
        const points = new Set<number>()
        points.add(0)
        if (workspaceIn !== null) points.add(workspaceIn)
        if (workspaceOut !== null) points.add(workspaceOut)
        
        layoutClips.forEach(c => {
            points.add(c.sequenceStart)
            points.add(c.sequenceStart + c.duration)
        })
        if (bgmPath) {
            points.add(bgmStart)
            points.add(effectiveBgmEnd)
        }
        trackMediaClips.forEach((clip) => {
            points.add(clip.timelineStart)
            points.add(clip.timelineEnd)
        })
        return Array.from(points)
    }, [workspaceIn, workspaceOut, layoutClips, bgmPath, bgmStart, effectiveBgmEnd, trackMediaClips])

    const updateBgmClip = (_id: string, nextStart: number, nextEnd: number) => {
        const previousDuration = effectiveBgmEnd - bgmStart
        const nextDuration = nextEnd - nextStart
        const movedWholeClip = Math.abs(previousDuration - nextDuration) < 0.05

        if (movedWholeClip) {
            setBgmTiming({ start: nextStart, end: nextEnd })
            return
        }

        const leftEdgeMoved = Math.abs(nextStart - bgmStart) > 0.001
        if (leftEdgeMoved) {
            const requestedTrimStart = bgmTrimStart + (nextStart - bgmStart)
            const availableExtension = Math.min(bgmTrimStart, Math.max(0, bgmStart - nextStart))
            const clampedStart = requestedTrimStart < 0 ? bgmStart - availableExtension : nextStart
            setBgmTiming({
                start: clampedStart,
                end: nextEnd,
                trimStart: Math.max(0, requestedTrimStart),
            })
            return
        }

        setBgmTiming({ end: nextEnd })
    }

    // --- Playhead Scrub ---
    const handleRulerPointerDown = (e: React.PointerEvent) => {
        if (!rulerRef.current) return
        e.preventDefault()
        const el = e.currentTarget as HTMLElement
        el.setPointerCapture(e.pointerId)
        
        setIsPlaying(false)

        const updateTime = (clientX: number) => {
            const rect = rulerRef.current!.getBoundingClientRect()
            // rect.leftには既にスクロール分が含まれているので、単純に引くだけで要素内のX座標になる
            const x = clientX - rect.left
            const time = Math.max(0, x / pps)
            // Snap Playhead to workspace markings or clips when Shift is held? (Enhancement)
            setPreviewTime(time)
        }

        updateTime(e.clientX)

        const onMove = (ev: PointerEvent) => updateTime(ev.clientX)
        const onUp = (ev: PointerEvent) => {
            el.removeEventListener("pointermove", onMove)
            el.removeEventListener("pointerup", onUp)
            el.releasePointerCapture(e.pointerId)
        }
        
        el.addEventListener("pointermove", onMove)
        el.addEventListener("pointerup", onUp)
    }

    // --- Zoom Playhead Centering ---
    const prevPpsRef = useRef(pps)
    React.useLayoutEffect(() => {
        if (prevPpsRef.current !== pps) {
            const currentPps = prevPpsRef.current
            const nextPps = pps
            prevPpsRef.current = nextPps

            let viewport: HTMLElement | null = containerRef.current
            while (viewport) {
                if (viewport.scrollWidth > viewport.clientWidth && getComputedStyle(viewport).overflowX !== 'visible') {
                    break
                }
                viewport = viewport.parentElement
            }
            if (viewport) {
                const playheadSec = useEditorStore.getState().previewTime
                const currentPlayheadPx = playheadSec * currentPps
                const nextPlayheadPx = playheadSec * nextPps
                
                // Playheadの画面上の相対位置（左端からの距離）
                const playheadScreenX = currentPlayheadPx - viewport.scrollLeft
                
                // 次のPlayheadのピクセル位置から、画面上の相対位置を引いた値が新しいscrollLeft
                viewport.scrollLeft = Math.max(0, nextPlayheadPx - playheadScreenX)
            }
        }
    }, [pps])

    // --- Alt + Wheel Zoom ---
    const handleWheel = useCallback((e: React.WheelEvent) => {
        if (!e.altKey) return
        e.preventDefault() // prevent normal scroll
        
        const zoomSens = 0.005
        const delta = -e.deltaY * zoomSens
        
        setPps(current => {
            const next = current * (1 + delta)
            return Math.max(ppsMin, Math.min(ppsMax, next))
        })
    }, [setPps, ppsMin, ppsMax])

    // --- Drag & Drop Resequence ---
    const handleClipDrop = (sourceId: string, dropTime: number) => {
        const sourceIdx = clips.findIndex(c => c.id === sourceId)
        if (sourceIdx < 0) return
        
        const arr = [...clips]
        const [source] = arr.splice(sourceIdx, 1)

        let currentDropAcc = 0
        let targetIdx = arr.length
        for (let i = 0; i < arr.length; i++) {
            const d = getTimelineClipDuration(arr[i])
            const mid = currentDropAcc + (d / 2)
            if (dropTime < mid) {
                targetIdx = i
                break
            }
            currentDropAcc += d
        }

        arr.splice(targetIdx, 0, source)
        setTimelineClips(arr)
    }

    const isSameMediaRange = (cut: Pick<AgentHighlight, "start" | "end">, clip: { mediaStart: number; mediaEnd: number; isGap?: boolean }) => {
        return !clip.isGap && Math.abs(clip.mediaStart - cut.start) < 0.1 && Math.abs(clip.mediaEnd - cut.end) < 0.1
    }

    const toggleAdoptCandidate = (cut: AgentHighlight) => {
        const adopted = clips.some((clip) => isSameMediaRange(cut, clip))

        if (adopted) {
            setTimelineClips(clips.filter((clip) => !isSameMediaRange(cut, clip)))
            setAgentThinking(`候補の採用を解除しました: ${cut.label}`)
            return
        }

        const nextClip = {
            id: crypto.randomUUID(),
            mediaStart: cut.start,
            mediaEnd: cut.end,
            label: `AI: ${cut.label.substring(0, 30)}`,
        }
        setTimelineClips(shouldReplaceTimelineOnFirstAdoption(clips, videoDuration) ? [nextClip] : [...clips, nextClip])
        setAgentThinking(`候補をタイムラインに採用しました: ${cut.label}`)
    }

    // --- Razor Tool Split ---
    const handleRazorClick = (sequenceTime: number) => {
        // 対象のクリップを探す
        const target = layoutClips.find(c => sequenceTime > c.sequenceStart && sequenceTime < c.sequenceStart + c.duration)
        if (target && !target.isGap) {
            // SequenceTimeをMediaTimeに変換
            const splitMediaTime = timelineClipLocalTimeToMedia(target, sequenceTime - target.sequenceStart)
            splitTimelineClip(target.id, splitMediaTime)
        }
    }

    // --- Rendering ---
    const renderRulerTicks = () => {
        const ticks = []
        // 目盛り間隔を pps (ピクセル/秒) に応じて動的に計算（約100ピクセル間隔を目指す）
        const targetPixels = 100
        const targetSeconds = targetPixels / pps
        
        // きりの良い秒数を定義
        const niceIntervals = [0.1, 0.5, 1, 5, 10, 30, 60, 300, 600, 1800, 3600]
        let majorInterval = niceIntervals[0]
        for (let i = 0; i < niceIntervals.length; i++) {
            majorInterval = niceIntervals[i]
            if (majorInterval >= targetSeconds) break
        }

        const count = Math.ceil(Math.max(totalDuration, 60) / majorInterval) + 5
        
        for (let i = 0; i <= count; i++) {
            const time = i * majorInterval
            
            // 時間のフォーマット (例: 01:30、10s、00:00.5)
            let label = ""
            if (majorInterval >= 1) {
                const m = Math.floor(time / 60)
                const s = Math.floor(time % 60)
                label = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
            } else {
                const m = Math.floor(time / 60)
                const s = Math.floor(time % 60)
                const ms = Math.floor((time % 1) * 100)
                label = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
            }

            ticks.push(
                <div key={time} className="absolute top-0 bottom-0 border-l border-zinc-700/50 flex flex-col items-start px-0.5" style={{ left: time * pps }}>
                    <span className="text-[10px] font-mono text-zinc-400 select-none leading-none pt-[5px] pl-[2px]">{label}</span>
                </div>
            )
        }
        return ticks
    }

    return (
        <div 
            ref={containerRef}
            className="w-full h-full relative"
            onWheel={handleWheel}
        >
            <div className="relative min-h-full" style={{ width: timelineWidthPx }}>
                
                {/* Ruler Header Area */}
                <div 
                    ref={rulerRef}
                    className="sticky top-0 h-[34px] bg-[#1a1a1c] border-b border-black z-30 cursor-crosshair hover:bg-[#202022]"
                    onPointerDown={handleRulerPointerDown}
                >
                    {renderRulerTicks()}
                    <div className="absolute bottom-0 w-full border-b border-zinc-800" />
                    
                    {/* Workspace In/Out Bar */}
                    {(workspaceIn !== null || workspaceOut !== null) && (
                        <div 
                            className="absolute bottom-0 h-2 bg-blue-500/50 border-t border-blue-400/80 z-20 pointer-events-none"
                            style={{ 
                                left: (workspaceIn || 0) * pps, 
                                width: ((workspaceOut || totalDuration) - (workspaceIn || 0)) * pps 
                            }}
                        >
                            {/* In point handle visual */}
                            {workspaceIn !== null && <div className="absolute left-0 top-[-8px] w-0 h-0 border-l-[6px] border-l-blue-500 border-b-[8px] border-b-transparent" />}
                            {/* Out point handle visual */}
                            {workspaceOut !== null && <div className="absolute right-0 top-[-8px] w-0 h-0 border-r-[6px] border-r-blue-500 border-b-[8px] border-b-transparent" />}
                        </div>
                    )}
                </div>

                {/* Grid Lines Overlay */}
                <div className="absolute top-[34px] bottom-0 w-full pointer-events-none z-0 mix-blend-overlay">
                    <div className="w-full h-full bg-[linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:50px_100%]" />
                </div>

                {/* Tracks Area Container */}
                <div className="relative mt-0 z-10 w-full">
                    {excitementMoments.length > 0 && (
                        <div className="relative h-[28px] w-full border-b border-amber-300/10 bg-amber-300/[0.018]">
                            {excitementMoments.map((moment) => {
                                const adopted = moment.cut ? clips.some((clip) => isSameMediaRange(moment.cut!, clip)) : false
                                const width = Math.max(12, (moment.sequenceEnd - moment.sequenceStart) * pps)

                                return (
                                    <button
                                        key={moment.key}
                                        type="button"
                                        className={`absolute top-[5px] h-[18px] overflow-hidden rounded-md border px-1.5 text-left text-[9px] font-medium transition ${
                                            adopted
                                                ? "border-emerald-300/35 bg-emerald-400/[0.14] text-emerald-100"
                                                : "border-amber-200/25 bg-amber-300/[0.09] text-amber-100/85 hover:bg-amber-300/[0.14]"
                                        }`}
                                        style={{ left: moment.sequenceStart * pps, width }}
                                        title={moment.cut
                                            ? `${adopted ? "採用済み。ダブルクリックで解除" : "ダブルクリックで採用"}: ${moment.label}`
                                            : `${moment.label}の可能性 · スコア ${moment.score}`}
                                        onClick={() => {
                                            setIsPlaying(false)
                                            setPreviewTime(moment.sequenceStart)
                                        }}
                                        onDoubleClick={(event) => {
                                            event.stopPropagation()
                                            if (moment.cut) toggleAdoptCandidate(moment.cut)
                                        }}
                                    >
                                        <span className="flex items-center gap-1 truncate">
                                            <span className="h-1.5 w-1.5 flex-none rounded-full bg-amber-300/80" />
                                            {adopted ? "採用済み" : "盛り上がり"} {moment.score} · {moment.label}
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                    
                    {/* Track Layout Container (V1 and A1) */}
                    <div className="relative w-full h-[138px]">
                        {clips.length === 0 && (
                            <div className="absolute inset-2 flex items-center justify-center rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] text-center text-[11px] text-zinc-600">
                                <div>
                                    <p className="font-semibold text-zinc-400">KEEP区間はまだありません</p>
                                    <p className="mt-1">AI候補をKEEPにするか、手動で区間を追加してください。</p>
                                </div>
                            </div>
                        )}

                        {layoutClips.map((c) => (
                            <NleClip
                                key={c.id}
                                clip={c as any}
                                index={c.index}
                                pixelsPerSecond={pps}
                                totalDuration={useDocumentStore.getState().videoInfo?.duration || 1000}
                                isSelected={selectedClipId === c.id}
                                onSelect={() => selectEditorItem({ type: "clip", id: c.id })}
                                onSeek={(time) => setPreviewTime(time)}
                                sequenceStart={c.sequenceStart}
                                onCommitUpdate={(partial) => updateTimelineClip(c.id, partial)}
                                onDragStart={() => {}}
                                onDragEnd={(dropSeqTime) => handleClipDrop(c.id, dropSeqTime)}
                                snapPoints={snapPoints}
                                activeTool={activeTool}
                                onRazorClick={handleRazorClick}
                            />
                        ))}
                    </div> {/* end V1+A1 track container */}

                    {!roughCutOnly && editorTracks.map((track) => (
                        <div
                            key={track.id}
                            className={`relative mt-[8px] h-[34px] w-full border-y ${track.kind === "video" ? "border-violet-300/[0.08] bg-violet-300/[0.018]" : "border-emerald-300/[0.08] bg-emerald-300/[0.018]"} ${track.hidden || track.muted ? "opacity-55" : ""}`}
                            data-testid={`track-lane-${track.id}`}
                        >
                            {trackMediaClips.filter((clip) => clip.trackId === track.id).map((clip) => (
                                <GenericClip
                                    key={clip.id}
                                    id={clip.id}
                                    startTime={clip.timelineStart}
                                    endTime={clip.timelineEnd}
                                    label={`${clip.groupId ? "🔗 " : ""}${clip.label}`}
                                    colorClass={track.kind === "video"
                                        ? "bg-violet-900/70 border-violet-400/55 text-violet-50"
                                        : "bg-emerald-900/65 border-emerald-400/50 text-emerald-50"}
                                    pixelsPerSecond={pps}
                                    isSelected={editorSelection.type === "trackClip" && editorSelection.id === clip.id}
                                    onSelect={() => selectEditorItem({ type: "trackClip", id: clip.id })}
                                    onSeek={setPreviewTime}
                                    onUpdate={updateTrackMediaClipTiming}
                                    snapPoints={snapPoints}
                                    activeTool={activeTool}
                                    isDraggable={!track.locked}
                                    isResizable={!track.locked}
                                />
                            ))}
                        </div>
                    ))}

                    {/* Secondary Tracks */}
                    {!roughCutOnly && bgmPath && effectiveBgmEnd > bgmStart && (
                        <div className="relative mt-[8px] h-[34px] w-full border-y border-purple-300/[0.06] bg-purple-300/[0.018]">
                            <GenericClip
                                id="bgm-track"
                                startTime={bgmStart}
                                endTime={effectiveBgmEnd}
                                label={`BGM · ${bgmPath.split(/[\\/]/).pop() ?? "音楽"}`}
                                colorClass="bg-purple-900/65 border-purple-400/50 text-purple-50"
                                pixelsPerSecond={pps}
                                isSelected={editorSelection.type === "audio"}
                                onSelect={() => selectEditorItem({ type: "audio" })}
                                onSeek={setPreviewTime}
                                onUpdate={updateBgmClip}
                                snapPoints={snapPoints}
                                activeTool={activeTool}
                            />
                        </div>
                    )}

                    {!roughCutOnly && images.length > 0 && (
                        <div className="relative w-full h-[32px] mt-[8px]">
                            {images.map(img => (
                                <GenericClip
                                    key={img.id}
                                    id={img.id}
                                    startTime={img.startTime}
                                    endTime={img.endTime}
                                    label={img.label || "Image"}
                                    colorClass="bg-fuchsia-900/60 border-fuchsia-500/50 text-fuchsia-100"
                                    pixelsPerSecond={pps}
                                    isSelected={selectedClipId === img.id}
                                    onSelect={() => selectEditorItem({ type: "image", id: img.id })}
                                    onSeek={setPreviewTime}
                                    onUpdate={(id, start, end) => updateImage(id, { startTime: start, endTime: end })}
                                    snapPoints={snapPoints}
                                    activeTool={activeTool}
                                />
                            ))}
                        </div>
                    )}

                    {!roughCutOnly && sequenceSubtitles.length > 0 && (
                        <div className="relative w-full h-[32px] mt-[8px]">
                            {sequenceSubtitles.map(seqSub => (
                                <GenericClip
                                    key={seqSub.id}
                                    id={seqSub.id}
                                    startTime={seqSub.seqStart}
                                    endTime={seqSub.seqEnd}
                                    label={seqSub.sub.text}
                                    colorClass="bg-sky-900/55 border-sky-400/45 text-sky-50"
                                    pixelsPerSecond={pps}
                                    isSelected={selectedClipId === seqSub.sub.id}
                                    onSelect={() => {
                                        selectEditorItem({ type: "subtitle", id: seqSub.sub.id })
                                        setIsPlaying(false)
                                        setPreviewTime(seqSub.seqStart)
                                    }}
                                    onSeek={setPreviewTime}
                                    onUpdate={(_id, start, end) => {
                                        const startPosition = sequenceTimeToMedia(clips, start)
                                        const endPosition = sequenceTimeToMedia(clips, Math.max(start, end - 0.001))
                                        if (!startPosition || !endPosition || startPosition.clip.isGap || endPosition.clip.isGap) {
                                            setAgentThinking("字幕は映像クリップがある範囲へ移動してください。")
                                            return
                                        }

                                        // 複数クリップをまたぐ場合は、元動画側も連続している区間だけ許可する。
                                        if (startPosition.clipIdx !== endPosition.clipIdx) {
                                            const crossed = clips.slice(startPosition.clipIdx, endPosition.clipIdx + 1)
                                            const isContinuous = crossed.every((clip, index) => {
                                                if (clip.isGap) return false
                                                if (index === 0) return true
                                                return Math.abs(crossed[index - 1].mediaEnd - clip.mediaStart) < 0.02
                                            })
                                            if (!isContinuous) {
                                                setAgentThinking("カット境界をまたぐ字幕は、1つの映像クリップ内へ移動してください。")
                                                return
                                            }
                                        }

                                        const mediaStart = startPosition.mediaTime
                                        const mediaEnd = Math.min(
                                            endPosition.clip.mediaEnd,
                                            endPosition.mediaTime + 0.001,
                                        )
                                        updateSubtitle(seqSub.sub.id, {
                                            start: Number(mediaStart.toFixed(3)),
                                            end: Number(Math.max(mediaStart + 0.05, mediaEnd).toFixed(3)),
                                        })
                                    }}
                                    snapPoints={snapPoints}
                                    activeTool={activeTool}
                                    isDraggable={true}
                                    isResizable={true}
                                    isEditable={true}
                                    onTextChange={(_id, newText) => {
                                        updateSubtitle(seqSub.sub.id, { text: newText })
                                        learnScopedSubtitleCorrection(seqSub.sub.text, newText).catch(console.error)
                                    }}
                                />
                            ))}
                        </div>
                    )}

                    {!roughCutOnly && seSlots.length > 0 && (
                        <div className="relative w-full h-[32px] mt-[8px]">
                            {seSlots.map(se => (
                                <GenericClip
                                    key={se.id}
                                    id={se.id}
                                    startTime={se.triggerTime}
                                    endTime={se.triggerTime + 2} // default visual dur for SE
                                    label={se.label || "SE"}
                                    colorClass="bg-orange-900/60 border-orange-500/50 text-orange-100"
                                    pixelsPerSecond={pps}
                                    isSelected={selectedClipId === se.id}
                                    onSelect={() => selectEditorItem({ type: "se", id: se.id })}
                                    onSeek={setPreviewTime}
                                    onUpdate={(id, start, end) => updateSeSlot(id, { triggerTime: start })}
                                    snapPoints={snapPoints}
                                    activeTool={activeTool}
                                    isResizable={false} // SE is instant trigger
                                />
                            ))}
                        </div>
                    )}
                </div>
                
                {/* Playhead (Red Line) */}
                <div 
                    ref={playheadRef}
                    className="absolute top-[16px] bottom-0 w-[1px] bg-red-500 z-40 pointer-events-none"
                    style={{ left: 0, transform: `translateX(${useEditorStore.getState().previewTime * pps}px)` }}
                >
                    <div className="absolute top-0 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[10px] border-t-red-500" />
                    <div className="absolute top-[10px] -translate-x-1/2 w-2 h-[8px] bg-red-500/80 rounded-sm shadow-sm" />
                </div>

            </div>
        </div>
    )
}
