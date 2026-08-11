import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useShallow } from "zustand/react/shallow"
import {
    computeWorkflowPresentation,
    type WorkflowDocument,
    type WorkflowPresentation,
} from "@/lib/workflow"
import { useDocumentStore } from "@/stores/document"

const WorkflowContext = createContext<WorkflowPresentation | null>(null)

export function WorkflowProvider({ children }: { children: ReactNode }) {
    const document = useDocumentStore(useShallow((state): WorkflowDocument => ({
        inputPath: state.inputPath,
        videoInfo: state.videoInfo,
        mediaAssets: state.mediaAssets,
        timelineClips: state.timelineClips,
        subtitles: state.subtitles,
        recommendedCuts: state.recommendedCuts,
        analysisArtifacts: state.analysisArtifacts,
        agentThinking: state.agentThinking,
        publishing: state.publishing,
        text: state.text,
        bgmPath: state.bgmPath,
        seSlots: state.seSlots,
        processing: state.processing,
    })))
    const presentation = useMemo(() => computeWorkflowPresentation(document), [document])

    return (
        <WorkflowContext.Provider value={presentation}>
            {children}
        </WorkflowContext.Provider>
    )
}

export function useWorkflowPresentation() {
    const presentation = useContext(WorkflowContext)
    if (!presentation) {
        throw new Error("useWorkflowPresentation must be used inside WorkflowProvider")
    }
    return presentation
}
