/**
 * useDaemonProgress — バックエンドの daemon-progress イベントをリッスンし、
 * 進捗(0〜1)とメッセージをReact stateとして提供するフック。
 */
import { useState, useEffect } from "react"
import { listen } from "@tauri-apps/api/event"
import { isTauriEnv } from "@/lib/utils"
import { useDocumentStore } from "@/stores/document"

/** daemon-progress イベントのペイロード型 */
interface DaemonProgressPayload {
    requestId?: string
    progress: number
    message?: string
}

/** フックの返り値 */
export interface DaemonProgressState {
    daemonProgress: number
    daemonMessage: string
    setDaemonProgress: React.Dispatch<React.SetStateAction<number>>
    setDaemonMessage: React.Dispatch<React.SetStateAction<string>>
}

export function useDaemonProgress(): DaemonProgressState {
    const [daemonProgress, setDaemonProgress] = useState(0)
    const [daemonMessage, setDaemonMessage] = useState("")
    const updateActiveAnalysisJobProgress = useDocumentStore((s) => s.updateActiveAnalysisJobProgress)

    const tauri = isTauriEnv()

    // 進捗リスナー登録
    useEffect(() => {
        if (!tauri) return

        let disposed = false
        let unlisten: (() => void) | undefined
        void listen("daemon-progress", (event: any) => {
                const payload = event.payload as DaemonProgressPayload
                setDaemonProgress(payload.progress)
                if (payload.message) {
                    setDaemonMessage(payload.message)
                }
                updateActiveAnalysisJobProgress({
                    progress: payload.progress,
                    message: payload.message,
                })
            })
            .then((cleanup) => {
                if (disposed) cleanup()
                else unlisten = cleanup
            })
            .catch((error) => {
                if (!disposed) console.error("daemon-progress listener registration failed:", error)
            })

        return () => {
            disposed = true
            unlisten?.()
        }
    }, [tauri, updateActiveAnalysisJobProgress])

    return { daemonProgress, daemonMessage, setDaemonProgress, setDaemonMessage }
}
