import React, { useRef, useCallback, useState, useEffect } from "react"
import { TimelineClip } from "@/lib/types"
import { useDocumentStore } from "@/stores/document"
import { getTimelineClipDuration, getTimelineClipSpeed } from "@/lib/timeline"

interface NleClipProps {
    clip: TimelineClip
    index: number
    pixelsPerSecond: number
    totalDuration: number
    isSelected: boolean
    onSelect: () => void
    onSeek: (sequenceTime: number) => void
    onCommitUpdate: (updates: Partial<TimelineClip>) => void
    onDragStart: () => void
    onDragEnd: (dropSeqTime: number) => void
    sequenceStart: number
    snapPoints: readonly number[]
    activeTool: 'selection' | 'razor'
    onRazorClick?: (sequenceTime: number) => void
}

const SNAP_THRESHOLD_PX = 10

export function NleClip({ 
    clip, pixelsPerSecond, totalDuration, isSelected, onSelect, onSeek, 
    onCommitUpdate, onDragStart, onDragEnd, sequenceStart, snapPoints,
    activeTool, onRazorClick
}: NleClipProps) {
    const isGap = clip.isGap
    const waveformData = useDocumentStore(s => s.waveformData)

    const [localDragOverlay, setLocalDragOverlay] = useState<{ x: number, deltaSec: number } | null>(null)
    const [localTrim, setLocalTrim] = useState<{ start: number, end: number, visualStartOffsetPx?: number, visualEndOffsetPx?: number } | null>(null)
    const localDragOverlayRef = useRef<{ x: number, deltaSec: number } | null>(null)
    const localTrimRef = useRef<{ start: number, end: number, visualStartOffsetPx?: number, visualEndOffsetPx?: number } | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const canvasContainerRef = useRef<HTMLDivElement>(null)

    const speed = getTimelineClipSpeed(clip)
    const baseDur = getTimelineClipDuration(clip)
    const actStart = localTrim ? localTrim.start : clip.mediaStart
    const actEnd = localTrim ? localTrim.end : clip.mediaEnd
    const actDur = isGap ? baseDur : (actEnd - actStart) / speed

    const trimOffsetLeftPx = localTrim?.visualStartOffsetPx || 0
    const leftPx = (sequenceStart * pixelsPerSecond) + trimOffsetLeftPx
    const widthPx = actDur * pixelsPerSecond

    const calculateSnap = (targetTimeSec: number): number => {
        const thresholdSec = SNAP_THRESHOLD_PX / pixelsPerSecond
        let bestPoint = targetTimeSec
        let minDiff = thresholdSec
        for (const p of snapPoints) {
            const diff = Math.abs(p - targetTimeSec)
            if (diff < minDiff) { minDiff = diff; bestPoint = p }
        }
        return bestPoint
    }

    // === トリム (端ドラッグ) ===
    const handleEdgeDrag = useCallback((edge: 'left' | 'right', e: React.PointerEvent) => {
        if (isGap || activeTool === 'razor') return
        e.stopPropagation()
        const handle = e.currentTarget as HTMLElement
        handle.setPointerCapture(e.pointerId)
        onSelect()

        let currentStart = clip.mediaStart
        let currentEnd = clip.mediaEnd
        let startX = e.clientX

        const onMove = (ev: PointerEvent) => {
            const dx = ev.clientX - startX
            if (edge === 'left') {
                const rawSeqTime = sequenceStart + (dx / pixelsPerSecond)
                const snappedSeqTime = calculateSnap(rawSeqTime)
                const snappedDx = (snappedSeqTime - sequenceStart) * pixelsPerSecond
                let ns = currentStart + (snappedDx / pixelsPerSecond) * speed
                ns = Math.max(0, Math.min(ns, currentEnd - 0.2))
                const next = { start: ns, end: currentEnd, visualStartOffsetPx: ((ns - currentStart) / speed) * pixelsPerSecond }
                localTrimRef.current = next
                setLocalTrim(next)
                onSeek(sequenceStart + (ns - currentStart) / speed)
            } else {
                const rawSeqTime = sequenceStart + ((currentEnd - currentStart) / speed) + (dx / pixelsPerSecond)
                const snappedSeqTime = calculateSnap(rawSeqTime)
                const snappedDx = (snappedSeqTime - (sequenceStart + (currentEnd - currentStart) / speed)) * pixelsPerSecond
                let ne = currentEnd + (snappedDx / pixelsPerSecond) * speed
                ne = Math.min(totalDuration, Math.max(ne, currentStart + 0.2))
                const next = { start: currentStart, end: ne }
                localTrimRef.current = next
                setLocalTrim(next)
                onSeek(sequenceStart + (ne - currentStart) / speed)
            }
        }
        const onUp = () => {
            handle.removeEventListener("pointermove", onMove)
            handle.removeEventListener("pointerup", onUp)
            handle.releasePointerCapture(e.pointerId)
            const current = localTrimRef.current
            localTrimRef.current = null
            setLocalTrim(null)
            if (current) onCommitUpdate({ mediaStart: current.start, mediaEnd: current.end })
        }
        handle.addEventListener("pointermove", onMove)
        handle.addEventListener("pointerup", onUp)
    }, [clip, pixelsPerSecond, totalDuration, onSelect, onCommitUpdate, onSeek, isGap, activeTool, sequenceStart, calculateSnap, speed])

    // --- 警告回避のための遅延実行 ---
    const [pendingRazorTime, setPendingRazorTime] = useState<number | null>(null)

    useEffect(() => {
        if (pendingRazorTime !== null && onRazorClick) {
            onRazorClick(pendingRazorTime)
            setPendingRazorTime(null)
        }
    }, [pendingRazorTime, onRazorClick])

    // === 本体ドラッグ ===
    const handleBodyPointerDown = useCallback((e: React.PointerEvent) => {
        if (isGap) return
        if (activeTool === 'razor') {
            if (!containerRef.current || !onRazorClick) return
            const rect = containerRef.current.getBoundingClientRect()
            const offsetX = e.clientX - rect.left
            const clickedSeqTime = sequenceStart + (offsetX / pixelsPerSecond)
            // Reactの警告（Cannot update a component while rendering a different component）を回避するため、
            // 状態更新をuseEffect内に遅延させる
            setPendingRazorTime(calculateSnap(clickedSeqTime))
            return
        }
        if ((e.target as HTMLElement).closest('.trim-paddle')) return
        e.stopPropagation()
        const el = e.currentTarget as HTMLElement
        el.setPointerCapture(e.pointerId)
        onSelect()
        onDragStart()

        let startX = e.clientX
        const originalStartSeqSec = sequenceStart
        const onMove = (ev: PointerEvent) => {
            const dx = ev.clientX - startX
            const rawTargetHeadTime = originalStartSeqSec + (dx / pixelsPerSecond)
            const snappedHeadTime = calculateSnap(rawTargetHeadTime)
            const snappedDx = (snappedHeadTime - originalStartSeqSec) * pixelsPerSecond
            const next = { x: snappedDx, deltaSec: snappedDx / pixelsPerSecond }
            localDragOverlayRef.current = next
            setLocalDragOverlay(next)
        }
        const onUp = () => {
            el.removeEventListener("pointermove", onMove)
            el.removeEventListener("pointerup", onUp)
            el.releasePointerCapture(e.pointerId)
            const current = localDragOverlayRef.current
            localDragOverlayRef.current = null
            setLocalDragOverlay(null)
            if (current) onDragEnd(sequenceStart + current.deltaSec)
            else onDragEnd(sequenceStart)
        }
        el.addEventListener("pointermove", onMove)
        el.addEventListener("pointerup", onUp)
    }, [isGap, pixelsPerSecond, onSelect, onDragStart, onDragEnd, sequenceStart, activeTool, onRazorClick, calculateSnap])

    // === Canvas 波形描画（タイル分割方式） ===
    // ブラウザのCanvas最大幅上限を回避しつつボヤケを防ぐため、4000px幅のタイルCanvasに分割して描画する
    const CHUNK_WIDTH = 4000
    const numChunks = isGap ? 0 : Math.max(1, Math.ceil(widthPx / CHUNK_WIDTH))

    useEffect(() => {
        if (isGap || !canvasContainerRef.current) return
        const container = canvasContainerRef.current
        const canvases = container.querySelectorAll("canvas")
        if (canvases.length !== numChunks) return // Reactのレンダリング待ち

        const dpr = window.devicePixelRatio || 1
        const h = 60
        
        // waveformDataの実際のSPSを動画の全長から逆算する
        const actualSps = totalDuration > 0 ? waveformData.length / totalDuration : 0
        if (actualSps <= 0) return

        const startSample = Math.floor(actStart * actualSps)
        const endSample = Math.min(Math.ceil(actEnd * actualSps), waveformData.length)
        const clipSamples = waveformData.slice(startSample, endSample)

        canvases.forEach((canvas, i) => {
            const ctx = canvas.getContext("2d")
            if (!ctx) return
            
            // このタイルの幅 (最後のタイルは端数になる)
            const isLast = i === numChunks - 1
            const chunkW = isLast ? (widthPx - i * CHUNK_WIDTH) : CHUNK_WIDTH
            const w = Math.max(1, Math.floor(chunkW))

            canvas.width = w * dpr
            canvas.height = h * dpr
            canvas.style.width = `${w}px`
            canvas.style.height = `${h}px`
            ctx.scale(dpr, dpr)
            ctx.clearRect(0, 0, w, h)

            if (clipSamples.length === 0) {
                ctx.strokeStyle = "rgba(52, 211, 153, 0.3)"
                ctx.lineWidth = 1
                ctx.beginPath()
                ctx.moveTo(0, h / 2)
                ctx.lineTo(w, h / 2)
                ctx.stroke()
                return
            }



            // ミラー波形描画（シャープな垂直バー方式）
            // 動画編集ソフト標準のドットパーフェクトな描画。アンチエイリアスのボヤケが発生しない。
            const gradient = ctx.createLinearGradient(0, 0, 0, h)
            gradient.addColorStop(0, "rgba(52, 211, 153, 0.05)")
            gradient.addColorStop(0.3, "rgba(52, 211, 153, 0.8)")
            gradient.addColorStop(0.5, "rgba(52, 211, 153, 1)")
            gradient.addColorStop(0.7, "rgba(52, 211, 153, 0.8)")
            gradient.addColorStop(1, "rgba(52, 211, 153, 0.05)")
            ctx.fillStyle = gradient

            const centerY = Math.floor(h / 2)
            const maxAmplitude = centerY - 2
            
            const samplesPerPx = clipSamples.length / widthPx

            for (let px = 0; px < w; px++) {
                const globalPx = i * CHUNK_WIDTH + px
                const sIdx = Math.floor(globalPx * samplesPerPx)
                const eIdx = Math.min(Math.ceil((globalPx + 1) * samplesPerPx), clipSamples.length)
                let maxVal = 0
                
                if (sIdx >= eIdx) {
                    maxVal = clipSamples[Math.min(sIdx, clipSamples.length - 1)] || 0
                } else {
                    for (let j = sIdx; j < eIdx; j++) {
                        maxVal = Math.max(maxVal, clipSamples[j] || 0)
                    }
                }
                
                const barH = Math.max(1, Math.floor(maxVal * maxAmplitude))
                // 1px単位の正確な矩形描画でボヤけを完全排除
                ctx.fillRect(px, centerY - barH, 1, barH * 2)
            }
        })
    }, [isGap, widthPx, actStart, actEnd, waveformData, waveformData.length, totalDuration, numChunks])

    if (isGap) {
        return (
            <div 
                className="absolute top-[2px] h-[58px] rounded-sm"
                style={{ left: leftPx, width: widthPx, background: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,0.02) 10px, rgba(255,255,255,0.02) 20px)' }}
                onClick={activeTool === 'selection' ? onSelect : undefined}
            />
        )
    }

    const translateStr = localDragOverlay ? `translateX(${localDragOverlay.x}px)` : 'none'
    const zIndex = isSelected || localDragOverlay ? 20 : 10
    const isRazor = activeTool === 'razor'
    const cursorType = isRazor ? 'crosshair' : (localDragOverlay ? 'grabbing' : 'grab')

    return (
        <div ref={containerRef} className="absolute flex flex-col gap-[9px] top-0 group"
            style={{ left: leftPx, width: widthPx, transform: translateStr, zIndex }}>
            {/* V1 Track */}
            <div
                role="button"
                tabIndex={0}
                aria-label={`映像クリップ ${clip.label || "Clip"}`}
                className={`relative h-[60px] rounded-[3px] border overflow-hidden select-none shadow-sm transition-colors duration-75
                ${isSelected ? 'bg-cyan-700/80 border-cyan-400' : 'bg-[#185b7e] border-[#38bdf8]/40 hover:bg-[#1a6b98]'}`}
                style={{ cursor: cursorType, opacity: localDragOverlay ? 0.7 : 1.0, backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(0,0,0,0) 100%)' }}
                onPointerDown={handleBodyPointerDown}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        onSelect()
                    }
                }}
            >
                <div className="absolute inset-0 px-2 pt-1 pointer-events-none">
                    <span className={`text-[10px] font-bold truncate tracking-wide ${isSelected ? 'text-white' : 'text-zinc-100'}`}>
                        {clip.label || "Clip"} <span className="opacity-50 font-normal">[{actDur.toFixed(1)}s]</span>
                        {speed !== 1 && <span className="ml-1 rounded bg-black/20 px-1 text-[8px] text-cyan-100">{speed.toFixed(2)}x</span>}
                    </span>
                </div>
                {!isRazor && (
                    <div className="trim-paddle absolute left-0 top-0 bottom-0 w-[8px] hover:w-[12px] bg-black/0 hover:bg-white/20 cursor-w-resize z-30 transition-all flex items-center justify-center border-r border-[#ffffff10]"
                        onPointerDown={(e) => handleEdgeDrag('left', e)}>
                        <div className="w-[2px] h-4 bg-white/70 opacity-0 group-hover:opacity-100 rounded-full shadow-[0_0_2px_rgba(0,0,0,0.5)]" />
                    </div>
                )}
                {!isRazor && (
                    <div className="trim-paddle absolute right-0 top-0 bottom-0 w-[8px] hover:w-[12px] bg-black/0 hover:bg-white/20 cursor-e-resize z-30 transition-all flex items-center justify-center border-l border-[#ffffff10]"
                        onPointerDown={(e) => handleEdgeDrag('right', e)}>
                        <div className="w-[2px] h-4 bg-white/70 opacity-0 group-hover:opacity-100 rounded-full shadow-[0_0_2px_rgba(0,0,0,0.5)]" />
                    </div>
                )}
            </div>

            {/* A1 Track (Real Waveform) */}
            <div className={`relative h-[60px] rounded-[3px] border overflow-hidden select-none shadow-sm pointer-events-none
                ${isSelected ? 'bg-emerald-800/80 border-emerald-400' : 'bg-[#186a4e] border-emerald-500/40'}`}
                style={{ opacity: localDragOverlay ? 0.7 : 1.0 }}>
                <div className="absolute top-1 left-2 text-[9px] font-bold text-white/50 z-10 font-mono">
                    {clip.muted ? "Muted" : `Audio ${Math.round((clip.volume ?? 1) * 100)}%`}
                </div>
                {/* Content (Waveform) */}
                <div ref={canvasContainerRef} className="absolute inset-x-0 bottom-0 h-[60px] flex overflow-hidden pointer-events-none opacity-90 mix-blend-screen pointer-events-none">
                    {!isGap && Array.from({ length: numChunks }).map((_, i) => (
                        <canvas key={i} className="flex-none block" />
                    ))}
                </div>
            </div>
        </div>
    )
}
