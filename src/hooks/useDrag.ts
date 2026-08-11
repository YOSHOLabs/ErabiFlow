/**
 * useDrag.ts
 *
 * Canvas 上の要素をドラッグして Position (0–1 正規化座標) を更新する汎用フック。
 *
 * 使い方:
 *   const { onMouseDown, onMouseMove, onMouseUp, onMouseLeave, dragTarget, hoveredTarget } =
 *     useDrag({ regions, onPositionChange })
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { Position } from "@/lib/types"
import { useDocumentStore } from "@/stores/document"

export type DragTarget = string | null

export interface DragRegion {
    /** この領域の識別キー */
    key: string
    /** Canvas 座標（ピクセル）での領域 */
    region: () => { x: number; y: number; w: number; h: number } | null
    /** 現在の位置を返す */
    getPosition: () => Position
    /** 位置変更コールバック */
    onPositionChange: (pos: Position) => void
}

interface UseDragOptions {
    canvasRef: React.RefObject<HTMLCanvasElement | null>
    regions: DragRegion[]
}

interface UseDragReturn {
    dragTarget: DragTarget
    hoveredTarget: DragTarget
    onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void
    onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void
    onMouseUp: () => void
    onMouseLeave: () => void
}

export function useDrag({ canvasRef, regions }: UseDragOptions): UseDragReturn {
    const [dragTarget, setDragTarget] = useState<DragTarget>(null)
    const [hoveredTarget, setHoveredTarget] = useState<DragTarget>(null)
    const dragStartRef = useRef<{
        startX: number
        startY: number
        origPos: Position
        lastPos: Position
        key: string
        pausedHistory: boolean
    } | null>(null)

    /** マウス座標をキャンバス比率（0–1）に変換する */
    const toCanvasRatio = useCallback(
        (e: React.MouseEvent<HTMLCanvasElement>) => {
            const canvas = canvasRef.current
            if (!canvas) return null
            const rect = canvas.getBoundingClientRect()
            return {
                x: (e.clientX - rect.left) / rect.width,
                y: (e.clientY - rect.top) / rect.height,
            }
        },
        [canvasRef]
    )

    /** 正規化座標（0–1）に対してヒットテストを行い、対応するキーを返す */
    const hitTest = useCallback(
        (rx: number, ry: number): DragTarget => {
            const canvas = canvasRef.current
            if (!canvas) return null
            const cw = canvas.width
            const ch = canvas.height
            const px = rx * cw
            const py = ry * ch
            const PAD = 12

            for (const r of regions) {
                const reg = r.region()
                if (!reg) continue
                if (
                    px >= reg.x - PAD &&
                    px <= reg.x + reg.w + PAD &&
                    py >= reg.y - PAD &&
                    py <= reg.y + reg.h + PAD
                ) {
                    return r.key
                }
            }
            return null
        },
        [canvasRef, regions]
    )

    const onMouseDown = useCallback(
        (e: React.MouseEvent<HTMLCanvasElement>) => {
            const pos = toCanvasRatio(e)
            if (!pos) return
            const key = hitTest(pos.x, pos.y)
            if (!key) return
            e.preventDefault()
            const region = regions.find((r) => r.key === key)
            if (!region) return
            const temporal = useDocumentStore.temporal.getState()
            const pausedHistory = temporal.isTracking
            if (pausedHistory) temporal.pause()
            const originalPosition = region.getPosition()
            setDragTarget(key)
            dragStartRef.current = {
                startX: pos.x,
                startY: pos.y,
                origPos: originalPosition,
                lastPos: originalPosition,
                key,
                pausedHistory,
            }
        },
        [toCanvasRatio, hitTest, regions]
    )

    const onMouseMove = useCallback(
        (e: React.MouseEvent<HTMLCanvasElement>) => {
            const pos = toCanvasRatio(e)
            if (!pos) return

            if (dragTarget && dragStartRef.current) {
                const { startX, startY, origPos, key } = dragStartRef.current
                const newPos: Position = {
                    x: Math.max(0.02, Math.min(0.98, origPos.x + (pos.x - startX))),
                    y: Math.max(0.02, Math.min(0.98, origPos.y + (pos.y - startY))),
                }
                dragStartRef.current.lastPos = newPos
                regions.find((r) => r.key === key)?.onPositionChange(newPos)
            } else {
                setHoveredTarget(hitTest(pos.x, pos.y))
            }
        },
        [toCanvasRatio, dragTarget, hitTest, regions]
    )

    const finishDrag = useCallback(() => {
        const session = dragStartRef.current
        if (session?.pausedHistory) {
            const temporal = useDocumentStore.temporal.getState()
            const region = regions.find((item) => item.key === session.key)
            if (region) {
                // 中間mousemoveは履歴化せず、開始位置→終了位置だけを1操作として保存する。
                region.onPositionChange(session.origPos)
                temporal.resume()
                region.onPositionChange(session.lastPos)
            } else {
                temporal.resume()
            }
        }
        setDragTarget(null)
        dragStartRef.current = null
    }, [regions])

    const onMouseUp = useCallback(() => {
        finishDrag()
    }, [finishDrag])

    const onMouseLeave = useCallback(() => {
        finishDrag()
        setHoveredTarget(null)
    }, [finishDrag])

    useEffect(() => () => {
        if (dragStartRef.current?.pausedHistory && !useDocumentStore.temporal.getState().isTracking) {
            useDocumentStore.temporal.getState().resume()
        }
    }, [])

    return { dragTarget, hoveredTarget, onMouseDown, onMouseMove, onMouseUp, onMouseLeave }
}
