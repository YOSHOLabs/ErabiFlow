import { save, open } from "@tauri-apps/plugin-dialog"
import { readTextFile } from "@tauri-apps/plugin-fs"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Copy, FilePlus2, FolderOpen, Save } from "lucide-react"
import { hasBlockingBackgroundJob } from "@/lib/backgroundJob"
import { collectProjectAssetReferences, serializeProject, deserializeProject } from "@/lib/project"
import { isActiveAnalysisJob } from "@/lib/analysisJob"
import { createSerialTaskQueue } from "@/lib/serialTaskQueue"
import { PROJECT_OPEN_EVENT, PROJECT_SAVE_AS_EVENT, PROJECT_SAVE_EVENT } from "@/hooks/useEditorShortcuts"
import { useDocumentStore } from "@/stores/document"
import { useBackgroundJobStore } from "@/stores/backgroundJobs"
import { useEditorStore } from "@/stores/editor"
import { commands } from "@/tauri/commands"

export function ProjectControls() {
    const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
    const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null)
    const [pendingSaveCount, setPendingSaveCount] = useState(0)
    const [isChoosingSavePath, setIsChoosingSavePath] = useState(false)
    const saveDialogOpen = useRef(false)
    const saveQueue = useRef(createSerialTaskQueue())
    const isProcessing = useBackgroundJobStore((state) => hasBlockingBackgroundJob(state.jobs))
    const isAnalyzing = useDocumentStore((state) => {
        const active = state.analysisJobs.find((job) => job.id === state.activeAnalysisJobId)
        return isActiveAnalysisJob(active)
    })
    const isSaving = pendingSaveCount > 0
    const hasBackgroundOperation = isProcessing || isAnalyzing
    const hasBlockingProjectOperation = hasBackgroundOperation || isSaving || isChoosingSavePath

    const showMsg = useCallback((text: string, ok: boolean) => {
        setMsg({ text, ok })
        setTimeout(() => setMsg(null), 3000)
    }, [])

    const writeProject = useCallback(async (filePath: string, message = "保存しました") => {
        // Capture now so repeated Ctrl+S requests are saved in request order. The latest
        // snapshot therefore cannot be overwritten by an older, slower native write.
        const json = serializeProject()
        setPendingSaveCount((count) => count + 1)
        try {
            await saveQueue.current.enqueue(async () => {
                await commands.saveProjectFile({ projectPath: filePath, projectJson: json })
                window.dispatchEvent(new CustomEvent("vfocus:manual-project-save", {
                    detail: { projectJson: json },
                }))
                setCurrentProjectPath(filePath)
                showMsg(message, true)
            })
        } finally {
            setPendingSaveCount((count) => Math.max(0, count - 1))
        }
    }, [showMsg])

    const chooseSavePath = useCallback(async (defaultPath: string) => {
        if (saveDialogOpen.current) return null
        saveDialogOpen.current = true
        setIsChoosingSavePath(true)
        try {
            return await save({
                filters: [{ name: "TateClip Project", extensions: ["vfocus"] }],
                defaultPath,
            })
        } finally {
            saveDialogOpen.current = false
            setIsChoosingSavePath(false)
        }
    }, [])

    const handleSave = useCallback(async () => {
        try {
            const filePath = currentProjectPath ?? await chooseSavePath("project.vfocus")
            if (!filePath) return
            await writeProject(filePath)
        } catch (e) {
            console.error(e)
            showMsg("保存に失敗しました", false)
        }
    }, [chooseSavePath, currentProjectPath, showMsg, writeProject])

    const handleSaveAs = useCallback(async () => {
        try {
            const defaultPath = currentProjectPath
                ? (/\.vfocus$/i.test(currentProjectPath)
                    ? currentProjectPath.replace(/\.vfocus$/i, "-copy.vfocus")
                    : `${currentProjectPath}-copy.vfocus`)
                : "project-copy.vfocus"
            const filePath = await chooseSavePath(defaultPath)
            if (!filePath) return
            await writeProject(filePath, "複製を作成しました")
        } catch (e) {
            console.error(e)
            showMsg("複製に失敗しました", false)
        }
    }, [chooseSavePath, currentProjectPath, showMsg, writeProject])

    const handleLoad = useCallback(async () => {
        if (hasBlockingProjectOperation) {
            showMsg("処理中は別のプロジェクトを開けません", false)
            return
        }
        try {
            const selected = await open({
                filters: [{ name: "TateClip Project", extensions: ["vfocus"] }],
                multiple: false,
            })
            if (!selected) return

            const state = useDocumentStore.getState()
            const hasWork = Boolean(state.inputPath || state.timelineClips.length || state.subtitles.length || state.images.length)
            if (hasWork && !window.confirm("現在の編集内容を閉じて、選択したプロジェクトを開きますか？\n未保存の変更は失われます。")) return

            const filePath = Array.isArray(selected) ? selected[0] : selected
            const json = await readTextFile(filePath)
            const assets = collectProjectAssetReferences(json)
            await commands.authorizeProjectAssets({ assets })
            deserializeProject(json)
            setCurrentProjectPath(filePath)
            showMsg("読み込みました", true)
        } catch (e) {
            console.error(e)
            showMsg("読み込みに失敗しました", false)
        }
    }, [hasBlockingProjectOperation, showMsg])

    const handleNew = useCallback(() => {
        if (hasBlockingProjectOperation) {
            showMsg("処理中は新規プロジェクトへ切り替えられません", false)
            return
        }
        const state = useDocumentStore.getState()
        const hasWork = Boolean(state.inputPath || state.timelineClips.length || state.subtitles.length || state.images.length)
        if (hasWork && !window.confirm("現在の編集内容を閉じて、新規プロジェクトを作成しますか？")) return

        state.resetDocument()
        useDocumentStore.temporal.getState().clear()
        const editor = useEditorStore.getState()
        editor.select({ type: "project" })
        editor.setWorkspace("draft")
        setCurrentProjectPath(null)
        window.dispatchEvent(new Event("vfocus:manual-project-save"))
        showMsg("新規プロジェクトを作成しました", true)
    }, [hasBlockingProjectOperation, showMsg])

    useEffect(() => {
        const saveProject = () => void handleSave()
        const saveProjectAs = () => void handleSaveAs()
        const openProject = () => void handleLoad()
        window.addEventListener(PROJECT_SAVE_EVENT, saveProject)
        window.addEventListener(PROJECT_SAVE_AS_EVENT, saveProjectAs)
        window.addEventListener(PROJECT_OPEN_EVENT, openProject)
        return () => {
            window.removeEventListener(PROJECT_SAVE_EVENT, saveProject)
            window.removeEventListener(PROJECT_SAVE_AS_EVENT, saveProjectAs)
            window.removeEventListener(PROJECT_OPEN_EVENT, openProject)
        }
    }, [handleLoad, handleSave, handleSaveAs])

    return (
        <div className="flex items-center gap-0.5">
            {msg && (
                <span role={msg.ok ? "status" : "alert"} aria-live="polite" className={`text-[11px] ${msg.ok ? "text-green-400" : "text-red-400"}`}>
                    {msg.text}
                </span>
            )}
            <Button
                variant="outline"
                size="sm"
                onClick={handleNew}
                disabled={hasBlockingProjectOperation}
                aria-label="新規"
                className="tc-project-action h-8 gap-1.5 rounded-lg border-transparent bg-transparent px-2.5 text-[11px] text-zinc-400 hover:border-white/[0.07] hover:bg-white/[0.05] hover:text-white"
            >
                <FilePlus2 className="h-3.5 w-3.5" />
                <span className="tc-project-action-label">新規</span>
            </Button>
            <Button
                variant="outline"
                size="sm"
                onClick={handleLoad}
                disabled={hasBlockingProjectOperation}
                aria-label="開く"
                className="tc-project-action h-8 gap-1.5 rounded-lg border-transparent bg-transparent px-2.5 text-[11px] text-zinc-400 hover:border-white/[0.07] hover:bg-white/[0.05] hover:text-white"
            >
                <FolderOpen className="h-3.5 w-3.5" />
                <span className="tc-project-action-label">開く</span>
            </Button>
            <Button
                variant="outline"
                size="sm"
                onClick={handleSave}
                disabled={isSaving || isChoosingSavePath}
                aria-label="保存"
                className="tc-project-action h-8 gap-1.5 rounded-lg border-transparent bg-transparent px-2.5 text-[11px] text-zinc-200 hover:border-cyan-300/15 hover:bg-cyan-300/[0.05] hover:text-white"
            >
                <Save className="h-3.5 w-3.5" />
                <span className="tc-project-action-label">保存</span>
            </Button>
            <Button
                variant="outline"
                size="sm"
                onClick={handleSaveAs}
                disabled={isSaving || isChoosingSavePath}
                title="別ファイルとして保存（Ctrl+Shift+S）"
                aria-label="複製"
                className="tc-project-action h-8 gap-1.5 rounded-lg border-transparent bg-transparent px-2.5 text-[11px] text-zinc-400 hover:border-white/[0.07] hover:bg-white/[0.05] hover:text-white"
            >
                <Copy className="h-3.5 w-3.5" />
                <span className="tc-project-action-label">複製</span>
            </Button>
        </div>
    )
}
