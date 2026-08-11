import { useDocumentStore } from "@/stores/document"
import { commands } from "@/tauri/commands"

/** 字幕修正を、確定ゲームまたは現在のプロジェクトだけに保存する。 */
export function learnScopedSubtitleCorrection(originalText: string, correctedText: string) {
    const state = useDocumentStore.getState()
    const artifact = state.analysisArtifacts.find((item) => item.id === state.activeAnalysisId)
    const detectedGameId = artifact?.gameContext?.detectedId
    const selectedGameId = state.processing.analysisGameId
    const gameId = detectedGameId
        || (selectedGameId !== "auto" && selectedGameId !== "none" ? selectedGameId : null)

    return commands.learnSubtitleCorrection({
        originalText,
        correctedText,
        gameId,
        sourcePath: state.inputPath || null,
    })
}

