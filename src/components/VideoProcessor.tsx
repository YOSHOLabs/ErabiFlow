import { lazy, Suspense, useEffect, type ComponentType } from "react"
import { useDemoProject } from "@/demo/useDemoProject"
import { useVideoInfo } from "@/hooks/useVideoInfo"
import { isTauriEnv } from "@/lib/utils"
import { commands } from "@/tauri/commands"
import { useDocumentStore } from "@/stores/document"
import { useEditorStore, type EditorWorkspace } from "@/stores/editor"
import { WorkflowNavigator } from "@/components/workflow/WorkflowNavigator"
import { WorkflowProvider, useWorkflowPresentation } from "@/components/workflow/WorkflowContext"
import { AnalysisControllerProvider } from "@/features/analysis/AnalysisControllerContext"
import { WorkspaceErrorBoundary } from "@/components/workspaces/WorkspaceErrorBoundary"

type WorkspaceModule = { default: ComponentType }
type WorkspaceLoader = () => Promise<WorkspaceModule>

const workspaceLoaders: Record<EditorWorkspace, WorkspaceLoader> = {
    draft: () => import("@/components/workspaces/DraftWorkspace"),
    edit: () => import("@/components/workspaces/EditWorkspace"),
    export: () => import("@/components/workspaces/ExportWorkspace"),
}

const workspaceComponents: Record<EditorWorkspace, ReturnType<typeof lazy>> = {
    draft: lazy(workspaceLoaders.draft),
    edit: lazy(workspaceLoaders.edit),
    export: lazy(workspaceLoaders.export),
}

const EmptyWorkspace = lazy(() => import("@/components/workspaces/EmptyWorkspace"))

function WorkspaceLoading({ label }: { label: string }) {
    return (
        <div
            role="status"
            className="flex h-full items-center justify-center bg-[#101216] text-[11px] text-zinc-600"
        >
            <span className="mr-2 h-1.5 w-1.5 animate-pulse bg-cyan-300" />
            {label}を準備しています
        </div>
    )
}

function WorkspaceSurface() {
    const inputPath = useDocumentStore((state) => state.inputPath)
    const workspace = useEditorStore((state) => state.workspace)
    const presentation = useWorkflowPresentation()
    const current = presentation.workspaces.find((item) => item.id === workspace) ?? presentation.workspaces[0]
    const ActiveWorkspace = workspaceComponents[workspace]
    const nextWorkspaceId = current.nextId

    useEffect(() => {
        if (!inputPath || !nextWorkspaceId) return
        const loadNextWorkspace = workspaceLoaders[nextWorkspaceId]
        const timer = window.setTimeout(() => {
            void loadNextWorkspace().catch(() => {
                // 先読みは最適化に留め、実際の遷移時はErrorBoundaryで回復経路を出す。
            })
        }, 700)
        return () => window.clearTimeout(timer)
    }, [inputPath, nextWorkspaceId])

    return (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1">
                <WorkspaceErrorBoundary resetKey={inputPath ? workspace : "empty"}>
                    <Suspense fallback={<WorkspaceLoading label={inputPath ? current.title : "新規プロジェクト"} />}>
                        {inputPath
                            ? <ActiveWorkspace />
                            : <EmptyWorkspace />}
                    </Suspense>
                </WorkspaceErrorBoundary>
            </div>
        </div>
    )
}

export function VideoProcessor() {
    useVideoInfo()
    useDemoProject()

    const setProcessing = useDocumentStore((state) => state.setProcessing)

    useEffect(() => {
        const detect = async () => {
            if (!isTauriEnv()) {
                setProcessing({ gpuType: "CPU" })
                return
            }
            try {
                setProcessing({ gpuType: await commands.detectGpu() })
            } catch {
                setProcessing({ gpuType: "CPU" })
            }
        }
        void detect()
    }, [setProcessing])

    return (
        <AnalysisControllerProvider>
            <WorkflowProvider>
                <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#090d12]">
                    <WorkflowNavigator />
                    <WorkspaceSurface />
                </div>
            </WorkflowProvider>
        </AnalysisControllerProvider>
    )
}
