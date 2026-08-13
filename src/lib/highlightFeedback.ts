import { isTauriEnv } from "./utils.ts"
import { commands } from "../tauri/commands.ts"
import type { HighlightFeedbackSummary } from "../tauri/commands.ts"
import {
    createHighlightFeedbackEvent,
    type HighlightFeedbackInput,
} from "./highlightFeedbackEvent.ts"
import { createSerialTaskQueue } from "./serialTaskQueue.ts"
import { persistHighlightFeedbackEnabled, readHighlightFeedbackEnabled } from "./highlightFeedbackPreference.ts"

export {
    createHighlightFeedbackEvent,
    type HighlightFeedbackAction,
    type HighlightFeedbackEvent,
    type HighlightFeedbackInput,
    type HighlightFeedbackRange,
    type MissedHighlightCategory,
    shouldRecordHighlightShown,
} from "./highlightFeedbackEvent.ts"

const ENABLED_KEY = "erabiflow.highlightFeedback.enabled"
export const HIGHLIGHT_FEEDBACK_CHANGED_EVENT = "erabiflow:highlight-feedback-changed"
export const HIGHLIGHT_FEEDBACK_RESET_EVENT = "erabiflow:highlight-feedback-reset"

export interface HighlightFeedbackStatus {
    bytes: number
    previousBytes: number
}

export type { HighlightFeedbackSummary }

let enabledCache: boolean | undefined
let feedbackEpoch = 0
const operationQueue = createSerialTaskQueue()

export function isHighlightFeedbackEnabled(): boolean {
    if (enabledCache !== undefined) return enabledCache
    if (typeof window === "undefined") return true
    enabledCache = readHighlightFeedbackEnabled(() => window.localStorage.getItem(ENABLED_KEY))
    return enabledCache
}

export async function setHighlightFeedbackEnabled(enabled: boolean): Promise<{ persisted: boolean }> {
    enabledCache = enabled
    feedbackEpoch += 1
    let persisted = true
    if (typeof window === "undefined") return { persisted }
    persisted = persistHighlightFeedbackEnabled(enabled, (value) => window.localStorage.setItem(ENABLED_KEY, value))
    window.dispatchEvent(new CustomEvent(HIGHLIGHT_FEEDBACK_CHANGED_EVENT, { detail: enabled }))
    // 停止完了を表示する前に、既にnativeへ渡った追記が終わるのを待つ。
    await operationQueue.enqueue(async () => undefined)
    if (enabled) window.dispatchEvent(new Event(HIGHLIGHT_FEEDBACK_RESET_EVENT))
    return { persisted }
}

/** 収集失敗が採用・編集・書き出しを失敗させない best-effort 記録。 */
export async function recordHighlightFeedback(input: HighlightFeedbackInput): Promise<void> {
    if (!isHighlightFeedbackEnabled() || !isTauriEnv()) return
    const epoch = feedbackEpoch
    const event = createHighlightFeedbackEvent(input)
    return operationQueue.enqueue(async () => {
        if (!isHighlightFeedbackEnabled() || epoch !== feedbackEpoch) return
        try {
            await commands.appendHighlightFeedback({ event })
        } catch (error) {
            if (import.meta.env.DEV) console.warn("ローカル編集履歴を記録できませんでした", error)
        }
    })
}

export async function recordHighlightFeedbackBatch(inputs: readonly HighlightFeedbackInput[]): Promise<void> {
    if (inputs.length === 0 || !isHighlightFeedbackEnabled() || !isTauriEnv()) return
    const epoch = feedbackEpoch
    const events = inputs.map(createHighlightFeedbackEvent)
    return operationQueue.enqueue(async () => {
        if (!isHighlightFeedbackEnabled() || epoch !== feedbackEpoch) return
        try {
            await commands.appendHighlightFeedbackBatch({ events })
        } catch (error) {
            if (import.meta.env.DEV) console.warn("ローカル編集履歴を一括記録できませんでした", error)
        }
    })
}

export async function getHighlightFeedbackStatus(): Promise<HighlightFeedbackStatus | null> {
    if (!isTauriEnv()) return null
    return operationQueue.enqueue(() => commands.getHighlightFeedbackStatus())
}

export async function getHighlightFeedbackSummary(): Promise<HighlightFeedbackSummary | null> {
    if (!isTauriEnv()) return null
    return operationQueue.enqueue(() => commands.getHighlightFeedbackSummary())
}

export async function clearHighlightFeedback(): Promise<void> {
    feedbackEpoch += 1
    if (isTauriEnv()) await operationQueue.enqueue(() => commands.clearHighlightFeedback())
    if (typeof window !== "undefined") window.dispatchEvent(new Event(HIGHLIGHT_FEEDBACK_RESET_EVENT))
}
