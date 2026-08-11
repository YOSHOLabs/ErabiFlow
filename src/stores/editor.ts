import { create } from "zustand"
import type { TrackMediaClip } from "../lib/types.ts"
import type { WorkflowWorkspaceId } from "../lib/workflow.ts"
import { hasBlockingBackgroundJob } from "../lib/backgroundJob.ts"
import { useBackgroundJobStore } from "./backgroundJobs.ts"

export type EditorWorkspace = WorkflowWorkspaceId
export type EditorSelection =
    | { type: "project" }
    | { type: "clip"; id: string }
    | { type: "subtitle"; id?: string }
    | { type: "image"; id?: string }
    | { type: "se"; id?: string }
    | { type: "text" }
    | { type: "avatar" }
    | { type: "game" }
    | { type: "composite" }
    | { type: "audio" }
    | { type: "trackClip"; id: string }

interface EditorUiState {
    workspace: EditorWorkspace
    selection: EditorSelection
    trackClipboard: TrackMediaClip[]
    timelineHeight: number
    previewTime: number
    /** Candidate review can inspect an absolute source time outside the KEEP sequence. */
    sourcePreviewTime: number | null
    isPlaying: boolean
    volume: number
    previewMainVolume: number
    previewBgmVolume: number
    previewTrackVolume: number
    lastAudibleVolume: number
    workspaceIn: number | null
    workspaceOut: number | null
    activeTool: "selection" | "razor"
    setWorkspace: (workspace: EditorWorkspace) => void
    select: (selection: EditorSelection) => void
    clearSelection: () => void
    setTrackClipboard: (clips: TrackMediaClip[]) => void
    setTimelineHeight: (height: number) => void
    setPreviewTime: (time: number) => void
    setSourcePreviewTime: (time: number | null) => void
    setIsPlaying: (playing: boolean) => void
    setVolume: (volume: number) => void
    setPreviewMainVolume: (volume: number) => void
    setPreviewBgmVolume: (volume: number) => void
    setPreviewTrackVolume: (volume: number) => void
    togglePreviewMute: () => void
    setWorkspaceIn: (time: number | null) => void
    setWorkspaceOut: (time: number | null) => void
    setActiveTool: (tool: "selection" | "razor") => void
    resetPlayback: () => void
}

export interface WorkspaceLock {
    workspace: EditorWorkspace
    reason: string
}

export function getWorkspaceLock(): WorkspaceLock | null {
    if (hasBlockingBackgroundJob(useBackgroundJobStore.getState().jobs)) {
        return {
            workspace: "export",
            reason: "書き出し中は出力工程から移動できません",
        }
    }
    return null
}

export function useWorkspaceLock(): WorkspaceLock | null {
    const isProcessing = useBackgroundJobStore((state) => hasBlockingBackgroundJob(state.jobs))
    return isProcessing
        ? {
            workspace: "export",
            reason: "書き出し中は出力工程から移動できません",
        }
        : null
}

export const useEditorStore = create<EditorUiState>((set) => ({
    workspace: "draft",
    selection: { type: "project" },
    trackClipboard: [],
    timelineHeight: typeof window === "undefined"
        ? 280
        : Math.round(Math.max(250, Math.min(360, window.innerHeight * 0.34))),
    previewTime: 0,
    sourcePreviewTime: null,
    isPlaying: false,
    volume: 1,
    previewMainVolume: 1,
    previewBgmVolume: 1,
    previewTrackVolume: 1,
    lastAudibleVolume: 1,
    workspaceIn: null,
    workspaceOut: null,
    activeTool: "selection",
    setWorkspace: (workspace) => set(() => {
        const lock = getWorkspaceLock()
        return lock && workspace !== lock.workspace ? {} : { workspace }
    }),
    select: (selection) => set(() => {
        const lock = getWorkspaceLock()
        return {
            selection,
            ...(lock && lock.workspace !== "edit" ? {} : { workspace: "edit" as const }),
        }
    }),
    clearSelection: () => set({ selection: { type: "project" } }),
    setTrackClipboard: (clips) => set({ trackClipboard: clips.map((clip) => ({ ...clip, transform: { ...clip.transform } })) }),
    setTimelineHeight: (timelineHeight) => set({ timelineHeight }),
    setPreviewTime: (previewTime) => set({
        previewTime: Math.max(0, Number.isFinite(previewTime) ? previewTime : 0),
        sourcePreviewTime: null,
    }),
    setSourcePreviewTime: (sourcePreviewTime) => set({
        sourcePreviewTime: sourcePreviewTime === null
            ? null
            : Math.max(0, Number.isFinite(sourcePreviewTime) ? sourcePreviewTime : 0),
        isPlaying: false,
    }),
    setIsPlaying: (isPlaying) => set({ isPlaying, ...(isPlaying ? { sourcePreviewTime: null } : {}) }),
    setVolume: (volume) => set((state) => {
        const next = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1))
        return { volume: next, ...(next > 0 ? { lastAudibleVolume: next } : { lastAudibleVolume: state.lastAudibleVolume }) }
    }),
    setPreviewMainVolume: (volume) => set({ previewMainVolume: Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1)) }),
    setPreviewBgmVolume: (volume) => set({ previewBgmVolume: Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1)) }),
    setPreviewTrackVolume: (volume) => set({ previewTrackVolume: Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1)) }),
    togglePreviewMute: () => set((state) => state.volume > 0
        ? { volume: 0, lastAudibleVolume: state.volume }
        : { volume: state.lastAudibleVolume || 1 }),
    setWorkspaceIn: (workspaceIn) => set({ workspaceIn }),
    setWorkspaceOut: (workspaceOut) => set({ workspaceOut }),
    setActiveTool: (activeTool) => set({ activeTool }),
    resetPlayback: () => set({
        previewTime: 0,
        sourcePreviewTime: null,
        isPlaying: false,
        volume: 1,
        previewMainVolume: 1,
        previewBgmVolume: 1,
        previewTrackVolume: 1,
        lastAudibleVolume: 1,
        workspaceIn: null,
        workspaceOut: null,
        activeTool: "selection",
    }),
}))
