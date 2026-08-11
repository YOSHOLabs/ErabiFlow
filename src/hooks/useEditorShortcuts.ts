import { useEffect } from "react"
import { getSequenceDuration, sequenceTimeToMedia } from "@/lib/timeline"
import { useDocumentStore } from "@/stores/document"
import { getWorkspaceLock, useEditorStore } from "@/stores/editor"
import { copyTrackClipGroup, pasteTrackClipGroup } from "@/lib/multiTrack"

export const PROJECT_SAVE_EVENT = "vfocus:project-save"
export const PROJECT_SAVE_AS_EVENT = "vfocus:project-save-as"
export const PROJECT_OPEN_EVENT = "vfocus:project-open"

function isEditableTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false
    return target.isContentEditable || Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
}

/**
 * アプリ全体の編集コマンドを一か所で処理する。
 * タイムライン固有コンポーネントへ分散させないことで Ctrl+O などの衝突を防ぐ。
 */
export function useEditorShortcuts() {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (isEditableTarget(event.target)) return
            if (window.document.querySelector('[aria-modal="true"]')) return

            const key = event.key.toLowerCase()
            const command = event.ctrlKey || event.metaKey
            const document = useDocumentStore.getState()
            const editor = useEditorStore.getState()
            const workspaceLocked = Boolean(getWorkspaceLock())

            const mutatesDocument = command
                ? ["z", "y", "d", "v", "b"].includes(key)
                : ["delete", "backspace"].includes(key)
            if (workspaceLocked && mutatesDocument) {
                event.preventDefault()
                return
            }

            if (command) {
                if (key === "z") {
                    event.preventDefault()
                    if (event.shiftKey) useDocumentStore.temporal.getState().redo()
                    else useDocumentStore.temporal.getState().undo()
                    return
                }
                if (key === "y") {
                    event.preventDefault()
                    useDocumentStore.temporal.getState().redo()
                    return
                }
                if (key === "s") {
                    event.preventDefault()
                    window.dispatchEvent(new Event(event.shiftKey ? PROJECT_SAVE_AS_EVENT : PROJECT_SAVE_EVENT))
                    return
                }
                if (key === "o") {
                    event.preventDefault()
                    window.dispatchEvent(new Event(PROJECT_OPEN_EVENT))
                    return
                }
                if (key === "d" && editor.selection.type === "clip") {
                    event.preventDefault()
                    document.duplicateTimelineClip(editor.selection.id)
                    return
                }
                if (key === "d" && editor.selection.type === "trackClip") {
                    event.preventDefault()
                    const copied = copyTrackClipGroup(document.trackMediaClips, editor.selection.id)
                    document.addTrackMediaClips(pasteTrackClipGroup(copied, Math.max(...copied.map((clip) => clip.timelineEnd), editor.previewTime)))
                    return
                }
                if (key === "c" && editor.selection.type === "trackClip") {
                    event.preventDefault()
                    editor.setTrackClipboard(copyTrackClipGroup(document.trackMediaClips, editor.selection.id))
                    return
                }
                if (key === "v" && editor.trackClipboard.length > 0) {
                    event.preventDefault()
                    const pasted = pasteTrackClipGroup(editor.trackClipboard, editor.previewTime)
                    document.addTrackMediaClips(pasted)
                    if (pasted[0]) editor.select({ type: "trackClip", id: pasted[0].id })
                    return
                }
                if (key === "b" && editor.selection.type === "clip") {
                    const position = sequenceTimeToMedia(document.timelineClips, editor.previewTime)
                    if (position?.clip.id === editor.selection.id && !position.clip.isGap) {
                        event.preventDefault()
                        document.splitTimelineClip(editor.selection.id, position.mediaTime)
                    }
                    return
                }
                return
            }

            if (event.altKey) return

            const duration = getSequenceDuration(document.timelineClips) || document.videoInfo?.duration || 0
            const seek = (seconds: number) => {
                editor.setIsPlaying(false)
                editor.setPreviewTime(Math.max(0, Math.min(duration, editor.previewTime + seconds)))
            }

            switch (key) {
                case " ":
                case "k":
                    event.preventDefault()
                    editor.setIsPlaying(!editor.isPlaying)
                    break
                case "j":
                    event.preventDefault()
                    editor.setIsPlaying(false)
                    break
                case "l":
                    event.preventDefault()
                    editor.setIsPlaying(true)
                    break
                case "v":
                    editor.setActiveTool("selection")
                    break
                case "c":
                    editor.setActiveTool("razor")
                    break
                case "i":
                    editor.setWorkspaceIn(editor.previewTime)
                    break
                case "o":
                    editor.setWorkspaceOut(editor.previewTime)
                    break
                case "m":
                    event.preventDefault()
                    editor.togglePreviewMute()
                    break
                case "arrowleft":
                    event.preventDefault()
                    seek(event.shiftKey ? -5 : -1 / Math.max(1, document.videoInfo?.fps ?? 30))
                    break
                case "arrowright":
                    event.preventDefault()
                    seek(event.shiftKey ? 5 : 1 / Math.max(1, document.videoInfo?.fps ?? 30))
                    break
                case "home":
                    event.preventDefault()
                    editor.setIsPlaying(false)
                    editor.setPreviewTime(0)
                    break
                case "end":
                    event.preventDefault()
                    editor.setIsPlaying(false)
                    editor.setPreviewTime(duration)
                    break
                case "escape":
                    editor.clearSelection()
                    break
                case "delete":
                case "backspace": {
                    const selection = editor.selection
                    if (selection.type === "clip") document.removeTimelineClip(selection.id, true)
                    else if (selection.type === "trackClip") document.removeTrackMediaClip(selection.id, true)
                    else if (selection.type === "image" && selection.id) document.removeImage(selection.id)
                    else if (selection.type === "se" && selection.id) document.removeSeSlot(selection.id)
                    else if (selection.type === "subtitle" && selection.id) document.removeSubtitle(selection.id)
                    else return
                    event.preventDefault()
                    editor.clearSelection()
                    break
                }
            }
        }

        window.addEventListener("keydown", handleKeyDown)
        return () => window.removeEventListener("keydown", handleKeyDown)
    }, [])
}
