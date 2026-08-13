/**
 * document.ts — ErabiFlow 統一プロジェクトドキュメント (Single Source of Truth)
 *
 * 7つの旧ストア (project, timeline, text, avatar, processing, se, image) の
 * 全データを1つの Zustand ストアに統合する。
 *
 * 設計原理:
 *   - すべての状態が JSON-serializable な 1 オブジェクトに収まる
 *   - Immer で不変更新を簡潔に記述
 *   - zundo (temporal) で Undo/Redo をゼロコストで実現
 *   - 保存/復元 = JSON.stringify / JSON.parse で完結
 *   - アクション実装は slices/ 配下のスライスに分離
 */

import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { temporal } from "zundo"
import { useEditorStore } from "./editor.ts"
import type {
    VideoInfo,
    TrimState,
    TextState,
    SubtitleStyle,
    AvatarState,
    GameState,
    ProcessingState,
    TextSegment,
    SeSlot,
    SeFileEntry,
    OverlayImage,
    SilenceSegment,
    DuckingConfig,
    Position,
    AgentHighlight,
    TimelineClip,
    CustomFontEntry,
    CreatorBatchClip,
    PublishingState,
    MediaAsset,
    MediaFolder,
    EditorTrack,
    TrackMediaClip,
    WatermarkState,
} from "../lib/types.ts"
import {
    DEFAULT_TEXT,
    DEFAULT_SUBTITLE_STYLE,
    DEFAULT_AVATAR,
    DEFAULT_GAME,
    DEFAULT_PROCESSING,
    DEFAULT_DUCKING,
    DEFAULT_PUBLISHING,
    DEFAULT_WATERMARK,
} from "../lib/types.ts"
import type { AnalysisArtifact } from "../lib/analysisArtifact.ts"
import type { AnalysisJob } from "../lib/analysisJob.ts"

// スライス
import { createProjectSlice } from "./slices/projectSlice.ts"
import { createTimelineSlice } from "./slices/timelineSlice.ts"
import { createTextSlice } from "./slices/textSlice.ts"
import { createMediaSlice } from "./slices/mediaSlice.ts"
import { createProcessingSlice } from "./slices/processingSlice.ts"
import { createAnalysisSlice } from "./slices/analysisSlice.ts"
import { createFontSlice } from "./slices/fontSlice.ts"
import { createCreatorSlice } from "./slices/creatorSlice.ts"

// ============================================================
// ドキュメントモデル (JSON-serializable)
// ============================================================

export interface VFocusDocument {
    // --- project ---
    inputPath: string
    avatarPath: string
    videoInfo: VideoInfo | null
    bgmPath: string
    bgmVolume: number
    /** タイムライン上でBGMが始まるSequence Time */
    bgmStart: number
    /** タイムライン上でBGMを止める位置。nullなら素材または動画の終端 */
    bgmEnd: number | null
    /** BGM素材の先頭から読み飛ばす秒数 */
    bgmTrimStart: number
    /** BGM素材自体の長さ。メタデータ取得前はnull */
    bgmSourceDuration: number | null

    // --- media library ---
    mediaAssets: MediaAsset[]
    mediaFolders: MediaFolder[]
    editorTracks: EditorTrack[]
    trackMediaClips: TrackMediaClip[]

    // --- timeline ---
    trim: TrimState
    silenceSegments: SilenceSegment[]
    ducking: DuckingConfig
    timelineClips: TimelineClip[]

    // --- text ---
    text: TextState
    subtitleStyle: SubtitleStyle
    subtitles: TextSegment[]
    customFonts: CustomFontEntry[]

    // --- avatar ---
    avatar: AvatarState
    game: GameState

    // --- processing ---
    processing: ProcessingState

    // --- se ---
    seSlots: SeSlot[]
    seFolderPath: string
    seFileEntries: SeFileEntry[]

    // --- images ---
    images: OverlayImage[]

    // --- Creator制作キュー ---
    creatorBatch: CreatorBatchClip[]

    // --- optional publish details ---
    publishing: PublishingState

    // --- optional watermark ---
    watermark: WatermarkState

    // --- ai analysis (undo対象外) ---
    excitementGraph: number[]
    agentThinking: string
    recommendedCuts: AgentHighlight[]
    /** Candidate indices explicitly marked as unused by the user. */
    rejectedHighlightCandidateIndices: number[]
    waveformData: number[]
    analysisArtifacts: AnalysisArtifact[]
    activeAnalysisId: string | null
    analysisJobs: AnalysisJob[]
    activeAnalysisJobId: string | null
}

// ============================================================
// ストアインターフェース (ドキュメント + アクション)
// ============================================================

export interface DocumentActions {
    // --- project ---
    setInputPath: (path: string) => void
    setAvatarPath: (path: string) => void
    setVideoInfo: (info: VideoInfo | null) => void
    setBgmPath: (path: string) => void
    setBgmVolume: (volume: number) => void
    setBgmStart: (start: number) => void
    setBgmEnd: (end: number | null) => void
    setBgmTrimStart: (start: number) => void
    setBgmSourceDuration: (duration: number | null) => void
    setBgmTiming: (timing: { start?: number; end?: number | null; trimStart?: number }) => void

    // --- media library ---
    addMediaAssets: (assets: MediaAsset[]) => void
    updateMediaAsset: (id: string, partial: Partial<MediaAsset>) => void
    removeMediaAsset: (id: string) => void
    addMediaFolder: (folder: MediaFolder) => void
    updateMediaFolder: (id: string, partial: Partial<MediaFolder>) => void
    removeMediaFolder: (id: string) => void

    // --- arbitrary tracks ---
    addEditorTrack: (track: EditorTrack) => void
    updateEditorTrack: (id: string, partial: Partial<EditorTrack>) => void
    removeEditorTrack: (id: string) => void
    addTrackMediaClip: (clip: TrackMediaClip) => void
    addTrackMediaClips: (clips: TrackMediaClip[]) => void
    updateTrackMediaClip: (id: string, partial: Partial<TrackMediaClip>) => void
    updateTrackMediaClipTiming: (id: string, start: number, end: number) => void
    removeTrackMediaClip: (id: string, includeGroup?: boolean) => void
    setTrackMediaClipGroup: (id: string, groupId?: string) => void

    // --- timeline ---
    setTrimStart: (v: number) => void
    setTrimEnd: (v: number) => void
    resetTrim: () => void
    setSilenceSegments: (segments: SilenceSegment[]) => void
    setDucking: (partial: Partial<DuckingConfig>) => void

    // NLE actions
    setTimelineClips: (clips: TimelineClip[]) => void
    addTimelineClip: (clip: TimelineClip) => void
    updateTimelineClip: (id: string, partial: Partial<TimelineClip>) => void
    removeTimelineClip: (id: string, ripple: boolean) => void
    splitTimelineClip: (id: string, splitMediaTime: number) => void
    duplicateTimelineClip: (id: string) => void
    reorderTimelineClips: (fromIndex: number, toIndex: number) => void

    // --- text ---
    setText: (partial: Partial<TextState>) => void
    setTextPosition: (pos: Position) => void
    setSubtitleStyle: (partial: Partial<SubtitleStyle>) => void
    setSubtitles: (subtitles: TextSegment[]) => void
    updateSubtitle: (id: string, partial: Partial<TextSegment>) => void
    removeSubtitle: (id: string) => void
    addCustomFont: (font: CustomFontEntry) => void
    removeCustomFont: (id: string) => void

    // --- avatar ---
    setAvatarPosition: (pos: Position) => void
    setAvatarScale: (scale: number) => void
    setGameLayoutMode: (mode: GameState["layoutMode"]) => void
    setGamePositionY: (y: number) => void
    setGameScale: (scale: number) => void

    // --- processing ---
    setProcessing: (partial: Partial<ProcessingState>) => void
    resetProgress: () => void

    // --- se ---
    addSeSlot: (slot: SeSlot) => void
    removeSeSlot: (id: string) => void
    updateSeSlot: (id: string, partial: Partial<SeSlot>) => void
    clearSeSlots: () => void
    setSeFolderPath: (path: string) => void
    setSeFileEntries: (entries: SeFileEntry[]) => void
    updateSeFileEntry: (id: string, partial: Partial<SeFileEntry>) => void

    // --- images ---
    addImage: (image: OverlayImage) => void
    removeImage: (id: string) => void
    updateImage: (id: string, partial: Partial<OverlayImage>) => void
    setImagePosition: (id: string, pos: Position) => void
    clearImages: () => void

    // --- Creator制作キュー ---
    setCreatorBatch: (items: CreatorBatchClip[]) => void
    addCreatorBatchClip: (item: CreatorBatchClip) => void
    updateCreatorBatchClip: (id: string, partial: Partial<CreatorBatchClip>) => void
    removeCreatorBatchClip: (id: string) => void
    clearCreatorBatch: () => void

    // --- optional publish details ---
    setPublishing: (partial: Partial<PublishingState>) => void
    setWatermark: (partial: Partial<WatermarkState>) => void

    // --- ai analysis ---
    setExcitementGraph: (graph: number[]) => void
    setAgentThinking: (thinking: string) => void
    setRecommendedCuts: (cuts: AgentHighlight[]) => void
    rejectHighlightCandidate: (candidateIndex: number) => void
    restoreHighlightCandidates: (candidateIndices: readonly number[]) => void
    clearRejectedHighlightCandidates: () => void
    setWaveformData: (data: number[]) => void
    setAnalysisArtifact: (artifact: AnalysisArtifact) => void
    clearAnalysisArtifacts: () => void
    startAnalysisJob: (job: AnalysisJob) => void
    updateActiveAnalysisJobProgress: (progress: { progress: number; message?: string }) => void
    finishActiveAnalysisJob: (message?: string) => void
    failActiveAnalysisJob: (error: string) => void
    requestCancelActiveAnalysisJob: (message?: string) => void
    cancelActiveAnalysisJob: (message?: string) => void
    clearAnalysisJobs: () => void

    // --- ドキュメント全体 ---
    /** ドキュメント全体を置換（プロジェクト読み込み用） */
    loadDocument: (doc: Partial<VFocusDocument>) => void
    /** ドキュメント全体をリセット */
    resetDocument: () => void
}

export type DocumentStore = VFocusDocument & DocumentActions

// ============================================================
// デフォルトドキュメント
// ============================================================

export const DEFAULT_DOCUMENT: VFocusDocument = {
    inputPath: "",
    avatarPath: "",
    videoInfo: null,
    bgmPath: "",
    bgmVolume: 0.5,
    bgmStart: 0,
    bgmEnd: null,
    bgmTrimStart: 0,
    bgmSourceDuration: null,
    mediaAssets: [],
    mediaFolders: [],
    editorTracks: [],
    trackMediaClips: [],

    trim: { start: 0, end: 0 },
    silenceSegments: [],
    ducking: DEFAULT_DUCKING,
    timelineClips: [],

    text: DEFAULT_TEXT,
    subtitleStyle: DEFAULT_SUBTITLE_STYLE,
    subtitles: [],
    customFonts: [],

    avatar: DEFAULT_AVATAR,
    game: DEFAULT_GAME,

    processing: DEFAULT_PROCESSING,

    seSlots: [],
    seFolderPath: "",
    seFileEntries: [],
    images: [],
    creatorBatch: [],
    publishing: DEFAULT_PUBLISHING,
    watermark: DEFAULT_WATERMARK,

    excitementGraph: [],
    waveformData: [],
    agentThinking: "",
    recommendedCuts: [],
    rejectedHighlightCandidateIndices: [],
    analysisArtifacts: [],
    activeAnalysisId: null,
    analysisJobs: [],
    activeAnalysisJobId: null,
}

// ============================================================
// Undo/Redo 設定
// ============================================================

const TEMPORAL_EQUALITY = (past: any, current: any) => {
    if (past === current) return true
    if (typeof past !== "object" || past === null || typeof current !== "object" || current === null) {
        return false
    }
    const keysA = Object.keys(past)
    const keysB = Object.keys(current)
    if (keysA.length !== keysB.length) return false
    for (const key of keysA) {
        if (!Object.prototype.hasOwnProperty.call(current, key) || past[key] !== current[key]) {
            return false
        }
    }
    return true
}

/**
 * Undo/Redo 対象から除外するフィールド。
 * 巨大なAI解析結果や一時的な再生状態を履歴保存から除外する。
 */
const undoPartialize = (state: any) => {
    return {
        avatarPath: state.avatarPath,
        bgmPath: state.bgmPath,
        bgmVolume: state.bgmVolume,
        bgmStart: state.bgmStart,
        bgmEnd: state.bgmEnd,
        bgmTrimStart: state.bgmTrimStart,
        mediaAssets: state.mediaAssets,
        mediaFolders: state.mediaFolders,
        editorTracks: state.editorTracks,
        trackMediaClips: state.trackMediaClips,
        ducking: state.ducking,
        timelineClips: state.timelineClips,
        text: state.text,
        subtitleStyle: state.subtitleStyle,
        subtitles: state.subtitles,
        customFonts: state.customFonts,
        avatar: state.avatar,
        game: state.game,
        seSlots: state.seSlots,
        seFolderPath: state.seFolderPath,
        seFileEntries: state.seFileEntries,
        images: state.images,
        creatorBatch: state.creatorBatch,
        publishing: state.publishing,
        watermark: state.watermark,
    }
}

// ============================================================
// ストア生成 — スライスを統合
// ============================================================

export const useDocumentStore = create<DocumentStore>()(
    temporal(
        immer((set) => ({
            // 各スライスのアクション実装を展開
            ...createProjectSlice(set),
            ...createTimelineSlice(set),
            ...createTextSlice(set),
            ...createMediaSlice(set),
            ...createProcessingSlice(set),
            ...createAnalysisSlice(set),
            ...createFontSlice(set),
            ...createCreatorSlice(set),

            publishing: DEFAULT_PUBLISHING,

            watermark: DEFAULT_WATERMARK,

            setPublishing: (partial: Partial<PublishingState>) =>
                set((s: any) => {
                    Object.assign(s.publishing, partial)
                }),

            setWatermark: (partial: Partial<WatermarkState>) =>
                set((s: any) => {
                    Object.assign(s.watermark, partial)
                }),

            // === ドキュメント全体 ===
            loadDocument: (doc: Partial<VFocusDocument>) => {
                set((s: any) => {
                    Object.assign(s, { ...DEFAULT_DOCUMENT, ...doc })
                })
                useEditorStore.getState().resetPlayback()
            },
            resetDocument: () => {
                set((s: any) => {
                    Object.assign(s, DEFAULT_DOCUMENT)
                })
                useEditorStore.getState().resetPlayback()
            },
        })),
        {
            equality: TEMPORAL_EQUALITY,
            limit: 50,
            partialize: undoPartialize,
        }
    )
)
