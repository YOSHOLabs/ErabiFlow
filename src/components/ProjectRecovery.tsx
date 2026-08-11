import { useEffect, useRef, useState } from "react"
import { AlertTriangle, RotateCcw, Trash2 } from "lucide-react"
import { collectProjectAssetReferences, deserializeProject, serializeProject } from "@/lib/project"
import { manualSaveRecoveryAction } from "@/lib/recoveryPolicy"
import { isTauriEnv } from "@/lib/utils"
import { commands, type RecoverySnapshot } from "@/tauri/commands"
import { useDocumentStore } from "@/stores/document"

const SAVE_DEBOUNCE_MS = 1500

function recoveryProjectName(snapshot: RecoverySnapshot) {
    try {
        const inputPath = JSON.parse(snapshot.projectJson)?.document?.inputPath
        return typeof inputPath === "string" && inputPath
            ? inputPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "前回のプロジェクト"
            : "前回のプロジェクト"
    } catch {
        return "前回のプロジェクト"
    }
}

export function ProjectRecovery() {
    const [candidate, setCandidate] = useState<RecoverySnapshot | null>(null)
    const [error, setError] = useState<string | null>(null)
    const readyRef = useRef(false)
    const lastSavedRef = useRef("")

    useEffect(() => {
        if (!isTauriEnv() || new URLSearchParams(window.location.search).has("demo")) return
        let disposed = false
        let unsubscribe: (() => void) | undefined
        let timer: ReturnType<typeof setTimeout> | null = null
        let recoveryTail: Promise<void> = Promise.resolve()

        const enqueueRecoveryWrite = (task: () => Promise<void>) => {
            recoveryTail = recoveryTail.then(task, task).catch((writeError) => {
                console.warn("[recovery] Failed to update recovery snapshot", writeError)
            })
        }

        const onManualSave = (event: Event) => {
            const savedProjectJson = event instanceof CustomEvent
                && typeof event.detail?.projectJson === "string"
                ? event.detail.projectJson
                : undefined
            enqueueRecoveryWrite(async () => {
                const currentProjectJson = serializeProject()
                const action = manualSaveRecoveryAction(
                    savedProjectJson,
                    currentProjectJson,
                    Boolean(useDocumentStore.getState().inputPath),
                )
                if (action.kind === "clear") {
                    await commands.clearRecoverySnapshot()
                } else {
                    await commands.saveRecoverySnapshot({ projectJson: action.projectJson })
                }
                lastSavedRef.current = action.lastSavedJson
            })
        }
        window.addEventListener("vfocus:manual-project-save", onManualSave)

        const startAutosave = () => {
            unsubscribe = useDocumentStore.subscribe(() => {
                if (!readyRef.current) return
                if (timer) clearTimeout(timer)
                timer = setTimeout(() => {
                    enqueueRecoveryWrite(async () => {
                        const state = useDocumentStore.getState()
                        if (!state.inputPath) {
                            lastSavedRef.current = ""
                            await commands.clearRecoverySnapshot()
                            return
                        }
                        const projectJson = serializeProject()
                        if (projectJson === lastSavedRef.current) return
                        await commands.saveRecoverySnapshot({ projectJson })
                        lastSavedRef.current = projectJson
                    })
                }, SAVE_DEBOUNCE_MS)
            })
        }

        void commands.getRecoverySnapshot()
            .then((snapshot) => {
                if (disposed) return
                if (snapshot && !useDocumentStore.getState().inputPath) {
                    setCandidate(snapshot)
                } else {
                    readyRef.current = true
                }
                startAutosave()
            })
            .catch((loadError) => {
                if (disposed) return
                setError(loadError instanceof Error ? loadError.message : String(loadError))
                readyRef.current = true
                startAutosave()
            })

        return () => {
            disposed = true
            window.removeEventListener("vfocus:manual-project-save", onManualSave)
            unsubscribe?.()
            if (timer) clearTimeout(timer)
        }
    }, [])

    const restore = async () => {
        if (!candidate) return
        try {
            await commands.authorizeProjectAssets({
                assets: collectProjectAssetReferences(candidate.projectJson),
            })
            deserializeProject(candidate.projectJson)
            lastSavedRef.current = candidate.projectJson
            readyRef.current = true
            setCandidate(null)
            setError(null)
        } catch (restoreError) {
            setError(restoreError instanceof Error ? restoreError.message : String(restoreError))
        }
    }

    const discard = async () => {
        try {
            await commands.clearRecoverySnapshot()
            lastSavedRef.current = ""
            readyRef.current = true
            setCandidate(null)
            setError(null)
        } catch (discardError) {
            setError(discardError instanceof Error ? discardError.message : String(discardError))
        }
    }

    if (!candidate && !error) return null

    return (
        <div className="flex min-h-10 flex-none items-center gap-3 border-b border-amber-300/15 bg-amber-300/[0.055] px-4 py-2">
            <AlertTriangle className="h-3.5 w-3.5 flex-none text-amber-300" />
            <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-semibold text-amber-100">
                    {candidate ? `前回の「${recoveryProjectName(candidate)}」を復元できます` : "自動復旧データを読み込めませんでした"}
                </p>
                <p className="truncate text-[8px] text-amber-200/55">
                    {candidate ? `自動保存 ${new Date(candidate.savedAt).toLocaleString("ja-JP")}` : error}
                </p>
            </div>
            {candidate && (
                <>
                    <button type="button" onClick={() => void restore()} className="flex items-center gap-1.5 rounded-lg bg-amber-300 px-3 py-1.5 text-[9px] font-bold text-amber-950 hover:bg-amber-200">
                        <RotateCcw className="h-3 w-3" />復元
                    </button>
                </>
            )}
            <button type="button" onClick={() => void discard()} className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] px-3 py-1.5 text-[9px] text-zinc-500 hover:text-zinc-100">
                <Trash2 className="h-3 w-3" />{candidate ? "破棄" : "削除"}
            </button>
        </div>
    )
}
