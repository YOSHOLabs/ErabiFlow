import React, { useRef, useCallback, useState } from "react"

interface GenericClipProps {
    id: string
    startTime: number
    endTime: number
    label: string
    colorClass: string       // e.g. "bg-orange-600/80 border-orange-400 text-orange-100"
    pixelsPerSecond: number
    isSelected: boolean
    onSelect: () => void
    onSeek: (mediaTime: number) => void
    onUpdate: (id: string, start: number, end: number) => void
    snapPoints: readonly number[]
    activeTool: 'selection' | 'razor'
    heightClass?: string     // e.g. "h-[30px]"
    isDraggable?: boolean
    isResizable?: boolean
    isEditable?: boolean
    onTextChange?: (id: string, newText: string) => void
}

const SNAP_THRESHOLD_PX = 10

export function GenericClip({
    id,
    startTime,
    endTime,
    label,
    colorClass,
    pixelsPerSecond,
    isSelected,
    onSelect,
    onSeek,
    onUpdate,
    snapPoints,
    activeTool,
    heightClass = "h-[28px]",
    isDraggable = true,
    isResizable = true,
    isEditable = false,
    onTextChange,
}: GenericClipProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [localDrag, setLocalDrag] = useState<{ dx: number, dt: number } | null>(null)
    const [localTrim, setLocalTrim] = useState<{ start: number, end: number } | null>(null)
    const [isEditing, setIsEditing] = useState(false)
    const [editValue, setEditValue] = useState(label)

    // Sync label to editValue if it changes externally while not editing
    React.useEffect(() => {
        if (!isEditing) setEditValue(label)
    }, [label, isEditing])

    const dur = endTime - startTime
    const actStart = localTrim ? localTrim.start : startTime
    const actEnd = localTrim ? localTrim.end : endTime
    const actDur = actEnd - actStart

    const leftPx = actStart * pixelsPerSecond
    const widthPx = actDur * pixelsPerSecond

    const calculateSnap = (targetTimeSec: number): number => {
        const thresholdSec = SNAP_THRESHOLD_PX / pixelsPerSecond
        let bestPoint = targetTimeSec
        let minDiff = thresholdSec
        for (const p of snapPoints) {
            const diff = Math.abs(p - targetTimeSec)
            if (diff < minDiff) {
                minDiff = diff
                bestPoint = p
            }
        }
        return bestPoint
    }

    // --- Resize (Trim) ---
    const handleEdgeDrag = useCallback((edge: 'left' | 'right', e: React.PointerEvent) => {
        if (!isResizable || activeTool === 'razor') return
        e.stopPropagation()
        const handle = e.currentTarget as HTMLElement
        handle.setPointerCapture(e.pointerId)
        
        onSelect()

        let currentStart = startTime
        let currentEnd = endTime
        let startX = e.clientX

        const onMove = (ev: PointerEvent) => {
            const dx = ev.clientX - startX
            
            if (edge === 'left') {
                const rawTime = currentStart + (dx / pixelsPerSecond)
                const snapped = calculateSnap(rawTime)
                const ns = Math.min(snapped, currentEnd - 0.1) // min 0.1s
                setLocalTrim({ start: ns, end: currentEnd })
                onSeek(ns)
            } else {
                const rawTime = currentEnd + (dx / pixelsPerSecond)
                const snapped = calculateSnap(rawTime)
                const ne = Math.max(snapped, currentStart + 0.1)
                setLocalTrim({ start: currentStart, end: ne })
                onSeek(currentEnd)
            }
        }

        const onUp = () => {
            handle.removeEventListener("pointermove", onMove)
            handle.removeEventListener("pointerup", onUp)
            handle.releasePointerCapture(e.pointerId)
            
            setLocalTrim(current => {
                if (current) onUpdate(id, current.start, current.end)
                return null
            })
        }

        handle.addEventListener("pointermove", onMove)
        handle.addEventListener("pointerup", onUp)
    }, [id, startTime, endTime, pixelsPerSecond, onSelect, onUpdate, onSeek, isResizable, activeTool, calculateSnap])

    // --- Drag ---
    const handleBodyDrag = useCallback((e: React.PointerEvent) => {
        if (!isDraggable || activeTool === 'razor') return
        if ((e.target as HTMLElement).closest('.trim-paddle')) return
        e.stopPropagation()
        
        const el = e.currentTarget as HTMLElement
        el.setPointerCapture(e.pointerId)

        onSelect()

        let startX = e.clientX
        
        const onMove = (ev: PointerEvent) => {
            const dx = ev.clientX - startX
            const rawHeadTime = startTime + (dx / pixelsPerSecond)
            const snappedHeadTime = calculateSnap(rawHeadTime)
            const snappedDx = (snappedHeadTime - startTime) * pixelsPerSecond
            const dt = snappedDx / pixelsPerSecond

            setLocalDrag({ dx: snappedDx, dt })
        }

        const onUp = () => {
            el.removeEventListener("pointermove", onMove)
            el.removeEventListener("pointerup", onUp)
            el.releasePointerCapture(e.pointerId)
            
            setLocalDrag(current => {
                if (current) {
                    const dropStart = Math.max(0, startTime + current.dt)
                    const dropEnd = dropStart + dur
                    onUpdate(id, dropStart, dropEnd)
                }
                return null
            })
        }

        el.addEventListener("pointermove", onMove)
        el.addEventListener("pointerup", onUp)
    }, [id, startTime, dur, pixelsPerSecond, onSelect, onUpdate, isDraggable, activeTool, calculateSnap])

    const translateStr = localDrag ? `translateX(${localDrag.dx}px)` : 'none'
    const zIndex = isSelected || localDrag ? 25 : 15

    return (
        <div
            ref={containerRef}
            role="button"
            tabIndex={0}
            aria-label={`タイムライン ${label}`}
            title={isEditable ? "クリックで選択・ダブルクリックで字幕を編集" : label}
            className={`absolute flex flex-col group rounded-[3px] border overflow-hidden select-none shadow-sm transition-colors duration-75 ${heightClass} ${colorClass}`}
            style={{ 
                left: leftPx, 
                width: widthPx, 
                transform: translateStr, 
                zIndex,
                cursor: localDrag ? 'grabbing' : (isDraggable ? 'grab' : 'default'),
                opacity: localDrag ? 0.8 : 1.0,
                backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(0,0,0,0) 100%)'
            }}
            onPointerDown={handleBodyDrag}
            onClick={() => {
                onSelect()
                onSeek(startTime)
            }}
            onDoubleClick={(event) => {
                if (!isEditable) return
                event.stopPropagation()
                setIsEditing(true)
            }}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    onSelect()
                }
            }}
        >
            <div 
                className="flex-1 px-1.5 py-0.5 pointer-events-none truncate flex items-center"
                style={{ pointerEvents: isEditable ? 'auto' : 'none' }}
            >
                {isEditing ? (
                    <input
                        autoFocus
                        className="w-full text-[10px] bg-black/50 text-white outline-none border border-white/20 rounded px-1"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => {
                            setIsEditing(false)
                            if (editValue !== label && onTextChange) {
                                onTextChange(id, editValue)
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.currentTarget.blur()
                            }
                            e.stopPropagation()
                        }}
                        onPointerDown={e => e.stopPropagation()}
                    />
                ) : (
                    <span className={`text-[10px] font-bold tracking-wide truncate ${isSelected ? 'text-white' : ''}`}>
                        {label}
                    </span>
                )}
            </div>

            {/* Left Trim Paddle */}
            {isResizable && activeTool !== 'razor' && (
                <div 
                    className="trim-paddle absolute left-0 top-0 bottom-0 w-[6px] hover:w-[10px] bg-black/0 hover:bg-white/20 cursor-w-resize z-30 transition-all flex items-center justify-center border-r border-[#ffffff15]"
                    onPointerDown={(e) => handleEdgeDrag('left', e)}
                >
                    <div className="w-[1px] h-3 bg-white/70 opacity-0 group-hover:opacity-100 rounded-full" />
                </div>
            )}

            {/* Right Trim Paddle */}
            {isResizable && activeTool !== 'razor' && (
                <div 
                    className="trim-paddle absolute right-0 top-0 bottom-0 w-[6px] hover:w-[10px] bg-black/0 hover:bg-white/20 cursor-e-resize z-30 transition-all flex items-center justify-center border-l border-[#ffffff15]"
                    onPointerDown={(e) => handleEdgeDrag('right', e)}
                >
                    <div className="w-[1px] h-3 bg-white/70 opacity-0 group-hover:opacity-100 rounded-full" />
                </div>
            )}
        </div>
    )
}
