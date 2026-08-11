import { ArrowRight, Check, CircleAlert, Download, Redo2, Scissors, Sparkles, Undo2 } from "lucide-react"
import { useStore } from "zustand"
import type { WorkflowWorkspaceId, WorkflowWorkspaceState } from "@/lib/workflow"
import { useDocumentStore } from "@/stores/document"
import { useEditorStore, useWorkspaceLock } from "@/stores/editor"
import { useWorkflowPresentation } from "./WorkflowContext"
import { HighlightFeedbackControl } from "@/components/HighlightFeedbackControl"

function stateLabel(state: WorkflowWorkspaceState, workspaceId: string, isCurrent = false) {
    if (state === "complete") return workspaceId === "export" ? "完了" : "準備OK"
    if (state === "attention") return "要確認"
    return isCurrent ? "作業中" : "未着手"
}

const WORKSPACE_ICON: Record<WorkflowWorkspaceId, typeof Sparkles> = {
    draft: Sparkles,
    edit: Scissors,
    export: Download,
}

export function WorkflowNavigator() {
    const workspace = useEditorStore((state) => state.workspace)
    const setWorkspace = useEditorStore((state) => state.setWorkspace)
    const hasSource = useDocumentStore((state) => Boolean(state.inputPath))
    const workspaceLock = useWorkspaceLock()
    const canUndo = useStore(useDocumentStore.temporal, (state) => state.pastStates.length > 0)
    const canRedo = useStore(useDocumentStore.temporal, (state) => state.futureStates.length > 0)
    const presentation = useWorkflowPresentation()
    const current = presentation.workspaces.find((item) => item.id === workspace) ?? presentation.workspaces[0]

    return (
        <header
            className="tc-workflow-bar flex h-[68px] flex-none items-stretch border-b border-white/[0.08] bg-[#0c1118]"
            data-testid="workflow-bar"
        >
            <nav aria-label="制作工程" className="tc-workflow-nav flex min-w-0 flex-1 items-center px-4">
                <div className="grid w-full max-w-[780px] grid-cols-3 gap-2">
                    {presentation.workspaces.map((step) => {
                        const Icon = WORKSPACE_ICON[step.id]
                        const isCurrent = workspace === step.id
                        const isLocked = (!hasSource && step.id !== "draft") || Boolean(workspaceLock && workspaceLock.workspace !== step.id)
                        const status = !hasSource
                            ? step.id === "draft" ? "素材待ち" : "未着手"
                            : stateLabel(step.state, step.id, isCurrent)
                        return (
                            <button
                                key={step.id}
                                type="button"
                                onClick={() => setWorkspace(step.id)}
                                disabled={isLocked}
                                aria-label={`${step.number} ${step.title} ${step.description} ${status} ${step.metric}`}
                                aria-pressed={isCurrent}
                                aria-current={isCurrent ? "step" : undefined}
                                className={`tc-workflow-step group flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-35 ${
                                    isCurrent
                                        ? "border-cyan-300/25 bg-cyan-300/[0.08] text-zinc-50"
                                        : "border-transparent text-zinc-400 hover:border-white/[0.07] hover:bg-white/[0.035] hover:text-zinc-100"
                                }`}
                                title={isLocked ? workspaceLock?.reason ?? "動画を選択すると移動できます" : step.description}
                            >
                                <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg border ${
                                    isCurrent
                                        ? "border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-200"
                                        : "border-white/[0.07] bg-black/10 text-zinc-500 group-hover:text-zinc-300"
                                }`}>
                                    <Icon className="h-3.5 w-3.5" />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-1.5">
                                        <span className="font-mono text-[9px] text-zinc-600">{step.number}</span>
                                        <span className="truncate text-[12px] font-semibold">{step.title}</span>
                                    </span>
                                    <span className="tc-workflow-step-status mt-0.5 flex items-center gap-1.5 text-[9px]">
                                        <span aria-hidden="true" className={`tc-workflow-state-dot h-1.5 w-1.5 flex-none rounded-full ${
                                            step.state === "complete" ? "bg-emerald-300" : step.state === "attention" ? "bg-amber-300" : "bg-zinc-600"
                                        }`} />
                                        <span className={step.state === "complete" ? "text-emerald-200" : step.state === "attention" ? "text-amber-200" : "text-zinc-500"}>{status}</span>
                                        <span className="truncate text-zinc-600">· {step.metric}</span>
                                    </span>
                                </span>
                                {step.state === "complete" && <Check className="tc-workflow-complete-icon h-3.5 w-3.5 flex-none text-emerald-300" />}
                                {step.state === "attention" && <CircleAlert className="tc-workflow-attention-icon h-3.5 w-3.5 flex-none text-amber-300" />}
                            </button>
                        )
                    })}
                </div>
            </nav>

            <div className="tc-workflow-actions flex w-[300px] flex-none items-center justify-end gap-1 border-l border-white/[0.07] px-3">
                <div className="tc-workflow-progress mr-1 min-w-[42px] text-right">
                    <p className="font-mono text-[10px] text-zinc-300">{presentation.completedCount}/{presentation.workspaces.length}</p>
                    <p className="text-[8px] font-medium tracking-[0.08em] text-zinc-600">完了</p>
                </div>
                <HighlightFeedbackControl />
                <button
                    type="button"
                    disabled={!canUndo || Boolean(workspaceLock)}
                    onClick={() => useDocumentStore.temporal.getState().undo()}
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-100 disabled:text-zinc-700 disabled:hover:bg-transparent"
                    title={workspaceLock?.reason ?? "元に戻す (Ctrl+Z)"}
                    aria-label="元に戻す (Ctrl+Z)"
                >
                    <Undo2 className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    disabled={!canRedo || Boolean(workspaceLock)}
                    onClick={() => useDocumentStore.temporal.getState().redo()}
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-100 disabled:text-zinc-700 disabled:hover:bg-transparent"
                    title={workspaceLock?.reason ?? "やり直す (Ctrl+Shift+Z)"}
                    aria-label="やり直す (Ctrl+Shift+Z)"
                >
                    <Redo2 className="h-4 w-4" />
                </button>
                {current.nextId && current.nextLabel ? (
                    <button
                        type="button"
                        onClick={() => setWorkspace(current.nextId!)}
                        disabled={!hasSource || Boolean(workspaceLock)}
                        title={!hasSource ? "最初に動画を選択してください" : workspaceLock?.reason}
                        className="ml-1 flex h-9 min-w-[102px] items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-cyan-300 px-3 text-[11px] font-semibold text-[#071014] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <span className="tc-workflow-next-label">{hasSource ? current.nextLabel : "動画を選択"}</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                ) : (
                    <span className="ml-1 rounded-lg border border-emerald-300/15 bg-emerald-300/[0.06] px-2.5 py-2 text-[10px] font-semibold text-emerald-200">
                        最終確認
                    </span>
                )}
            </div>
        </header>
    )
}
