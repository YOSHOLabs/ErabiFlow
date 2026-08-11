import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react"
import { RoughCutInspectorPanel } from "@/components/panels/RoughCutInspectorPanel"
import { TimelinePanel } from "@/components/panels/TimelinePanel"
import { useEditorStore } from "@/stores/editor"
import { PreviewPane } from "./PreviewPane"

type ResizeSession = {
    pointerId: number
    startY: number
    startHeight: number
    previousCursor: string
    previousUserSelect: string
}

export default function EditWorkspace() {
    const timelineHeight = useEditorStore((state) => state.timelineHeight)
    const setTimelineHeight = useEditorStore((state) => state.setTimelineHeight)
    const resizeSession = useRef<ResizeSession | null>(null)
    const resizeFrame = useRef<number | null>(null)
    const pendingHeight = useRef<number | null>(null)

    const heightBounds = () => {
        const workflowHeight = 68
        const workspaceHeight = window.innerHeight - 52 - workflowHeight
        return {
            min: 220,
            // 素材・プレビュー・Inspector側へ常に操作可能な高さを残す。
            max: Math.max(220, Math.min(560, workspaceHeight - 340)),
        }
    }

    const clampHeight = (height: number) => {
        const bounds = heightBounds()
        return Math.max(bounds.min, Math.min(bounds.max, height))
    }

    const restoreBodyInteraction = useCallback(() => {
        const session = resizeSession.current
        if (session) {
            document.body.style.cursor = session.previousCursor
            document.body.style.userSelect = session.previousUserSelect
            resizeSession.current = null
        }
        if (resizeFrame.current !== null) {
            cancelAnimationFrame(resizeFrame.current)
            resizeFrame.current = null
        }
        if (pendingHeight.current !== null) {
            setTimelineHeight(pendingHeight.current)
            pendingHeight.current = null
        }
    }, [setTimelineHeight])

    useEffect(() => restoreBodyInteraction, [restoreBodyInteraction])

    useEffect(() => {
        const clampToViewport = () => {
            const current = useEditorStore.getState().timelineHeight
            const { min, max } = heightBounds()
            const next = Math.max(min, Math.min(max, current))
            if (next !== current) setTimelineHeight(next)
        }
        window.addEventListener("resize", clampToViewport)
        clampToViewport()
        return () => window.removeEventListener("resize", clampToViewport)
    }, [setTimelineHeight])

    const beginTimelineResize = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || resizeSession.current) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        resizeSession.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startHeight: timelineHeight,
            previousCursor: document.body.style.cursor,
            previousUserSelect: document.body.style.userSelect,
        }
        document.body.style.cursor = "row-resize"
        document.body.style.userSelect = "none"
    }

    const resizeTimeline = (event: ReactPointerEvent<HTMLDivElement>) => {
        const session = resizeSession.current
        if (!session || session.pointerId !== event.pointerId) return
        pendingHeight.current = clampHeight(session.startHeight + session.startY - event.clientY)
        if (resizeFrame.current !== null) return
        resizeFrame.current = requestAnimationFrame(() => {
            resizeFrame.current = null
            if (pendingHeight.current === null) return
            setTimelineHeight(pendingHeight.current)
            pendingHeight.current = null
        })
    }

    const endTimelineResize = (event: ReactPointerEvent<HTMLDivElement>) => {
        const session = resizeSession.current
        if (!session || session.pointerId !== event.pointerId) return
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
        restoreBodyInteraction()
    }

    const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
        const bounds = heightBounds()
        const next = event.key === "ArrowUp"
            ? timelineHeight + 24
            : event.key === "ArrowDown"
                ? timelineHeight - 24
                : event.key === "Home"
                    ? bounds.min
                    : event.key === "End"
                        ? bounds.max
                        : null
        if (next === null) return
        event.preventDefault()
        setTimelineHeight(clampHeight(next))
    }

    return (
        <div
            className="tc-edit-workspace grid h-full min-h-0 grid-cols-[minmax(520px,1fr)_340px] overflow-hidden bg-[#090d12]"
            style={{ gridTemplateRows: `minmax(0, 1fr) ${timelineHeight}px` }}
            data-testid="edit-workspace"
        >
            <PreviewPane title="ラフカット確認" detail="KEEP区間のつながりを確認" />

            <aside aria-label="ラフカット判断" className="flex min-h-0 flex-col border-l border-white/[0.07] bg-[#0e141c]">
                <div className="flex h-14 flex-none items-center border-b border-white/[0.06] px-4">
                    <div>
                        <h2 className="text-[13px] font-semibold text-zinc-100">残す／削る</h2>
                        <p className="mt-0.5 text-[10px] text-zinc-500">演出ではなく内容を判断</p>
                    </div>
                </div>
                <div className="vf-workspace-surface custom-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
                    <RoughCutInspectorPanel />
                </div>
            </aside>

            <div className="col-span-2 row-start-2 flex min-h-0 flex-col border-t border-white/[0.06]">
                <div
                    role="separator"
                    aria-label="タイムラインの高さを変更"
                    aria-orientation="horizontal"
                    aria-valuemin={heightBounds().min}
                    aria-valuemax={heightBounds().max}
                    aria-valuenow={Math.round(timelineHeight)}
                    tabIndex={0}
                    onPointerDown={beginTimelineResize}
                    onPointerMove={resizeTimeline}
                    onPointerUp={endTimelineResize}
                    onPointerCancel={endTimelineResize}
                    onKeyDown={resizeWithKeyboard}
                    className="group flex h-1.5 flex-none touch-none cursor-row-resize items-center justify-center bg-[#0b0c0e] transition hover:bg-cyan-400/10 focus:bg-cyan-400/10 focus:outline-none"
                >
                    <span className="h-px w-12 bg-white/[0.08] transition group-hover:bg-cyan-300/40" />
                </div>
                <div className="min-h-0 flex-1">
                    <TimelinePanel />
                </div>
            </div>
        </div>
    )
}
