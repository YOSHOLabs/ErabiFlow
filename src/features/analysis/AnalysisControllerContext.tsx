import { createContext, useContext, type ReactNode } from "react"
import { useDaemonProgress } from "./hooks/useDaemonProgress"
import { useHighlightAnalysis } from "./hooks/useHighlightAnalysis"

type AnalysisController = ReturnType<typeof useHighlightAnalysis>
    & ReturnType<typeof useDaemonProgress>

const AnalysisControllerContext = createContext<AnalysisController | null>(null)

export function AnalysisControllerProvider({ children }: { children: ReactNode }) {
    const progress = useDaemonProgress()
    const analysis = useHighlightAnalysis({
        setDaemonProgress: progress.setDaemonProgress,
        setDaemonMessage: progress.setDaemonMessage,
    })

    return (
        <AnalysisControllerContext.Provider value={{ ...progress, ...analysis }}>
            {children}
        </AnalysisControllerContext.Provider>
    )
}

export function useAnalysisController() {
    const controller = useContext(AnalysisControllerContext)
    if (!controller) {
        throw new Error("useAnalysisController must be used inside AnalysisControllerProvider")
    }
    return controller
}
