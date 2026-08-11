/**
 * processingSlice — エクスポート処理の状態とアクション
 */
import type { ProcessingState } from "../../lib/types.ts"
import { DEFAULT_PROCESSING } from "../../lib/types.ts"

export const createProcessingSlice = (set: any) => ({
    // --- 初期値 ---
    processing: DEFAULT_PROCESSING,

    // --- アクション ---
    setProcessing: (partial: Partial<ProcessingState>) =>
        set((s: any) => {
            Object.assign(s.processing, partial)
        }),
    resetProgress: () =>
        set((s: any) => {
            s.processing.isProcessing = false
            s.processing.progress = 0
            s.processing.phase = ""
            s.processing.status = ""
            s.processing.phaseMessage = ""
            s.processing.lastError = null
            s.processing.lastOutputPath = null
            s.processing.lastStartedAt = null
            s.processing.lastFinishedAt = null
        }),
})
