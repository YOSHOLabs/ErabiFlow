/**
 * tauri/commands.ts — Tauri invoke の型安全ラッパー
 *
 * 全ての Tauri コマンド呼び出しを1箇所に集約し、
 * 引数名のtypoや戻り値型の不一致をコンパイル時に検出する。
 *
 * 使い方:
 *   import { commands } from "@/tauri/commands"
 *   const info = await commands.getVideoInfo({ inputPath: "..." })
 */

import { invoke } from "@tauri-apps/api/core"
import type { VideoInfo, SilenceSegment } from "@/lib/types"
import type { HighlightFeedbackEvent } from "@/lib/highlightFeedbackEvent"

export interface HighlightFeedbackStatus {
    bytes: number
    previousBytes: number
}

export interface HighlightFeedbackSummary {
    schemaVersion: 1
    validEventCount: number
    invalidLineCount: number
    shownCandidates: number
    adoptedCandidates: number
    rejectedCandidates: number
    exportedCandidates: number
    missedRanges: number
    uncoveredMissedRanges: number
    acceptedPerShown: number | null
    rejectionPerShown: number | null
    exportPerAccepted: number | null
    missedCoverage: number | null
    boundaryEdits: {
        sampleCount: number
        meanStartDeltaSeconds: number
        meanEndDeltaSeconds: number
    }
    categoryCounts: Record<string, number>
}

export interface FontDescriptor {
    reference: string
    label: string
    family: string
    path: string
    supportsJapanese: boolean
    isBold: boolean
    source: "system" | "custom" | string
}

export interface FontResolution {
    path: string
    family: string
    fallbackUsed: boolean
    isBold: boolean
    warning: string | null
}

export interface EntitlementSnapshot {
    plan: "free" | "creator"
    status: "free" | "creator" | "invalid"
    installationId: string
    licenseId: string | null
    expiresAt: number | null
    message: string | null
}

export interface RecoverySnapshot {
    projectJson: string
    savedAt: string
}

export interface MediaProxyResult {
    path: string
    bytes: number
    reused: boolean
}

export type WhisperModelState = "missing" | "paused" | "downloading" | "verifying" | "corrupt" | "ready"

export interface WhisperModelStatus {
    state: WhisperModelState
    source: "bundled" | "downloaded" | "development" | string
    bytes: number
    expectedBytes: number
    downloadedBytes: number
    modelName: string
    sha256: string
    downloadUrl: string
    message: string
}

export interface WhisperModelProgress {
    state: WhisperModelState
    downloadedBytes: number
    totalBytes: number
    progress: number
    message: string
}

export type FfmpegRuntimeState = "missing" | "paused" | "downloading" | "verifying" | "extracting" | "corrupt" | "ready"

export interface FfmpegRuntimeStatus {
    state: FfmpegRuntimeState
    source: "bundled" | "downloaded" | "development" | string
    bytes: number
    expectedBytes: number
    downloadedBytes: number
    archiveName: string
    archiveSha256: string
    executableSha256: string
    downloadUrl: string
    releaseUrl: string
    message: string
}

export interface FfmpegRuntimeProgress {
    state: FfmpegRuntimeState
    downloadedBytes: number
    totalBytes: number
    progress: number
    message: string
}

// ============================================================
// レスポンス型定義
// ============================================================



/** analyze_highlights のレスポンス */
export interface HighlightAnalysisResponse {
    status: string
    highlights: {
        start: number
        end: number
        label: string
        reason: string
        excitement: number
        isProRequired?: boolean
        scoreDetails?: {
            event?: number
            reaction?: number
            clipability?: number
            confidence?: number
        }
        evidence?: string[]
        category?: string
        falsePositiveRisk?: number
        durationVariants?: Partial<Record<"15" | "30" | "60", { start: number; end: number }>>
    }[]
    excitement_graph: number[]
    segments: {
        id?: string
        text: string
        startTime?: number
        endTime?: number
        start?: number
        end?: number
        start_time?: number
        end_time?: number
        confidence?: number
        sourceTrack?: number
        source_track?: number
        flags?: string[]
        refinedByGlossary?: boolean
        originalText?: string
        recognitionModel?: string
    }[]
    transcript_text: string
    track_info?: {
        voice_tracks?: number[]
        game_tracks?: number[]
        stream_count?: number
        track_stats?: {
            track: number
            role: "voice" | "game" | string
            rms?: number | null
            silence_ratio?: number | null
        }[]
    }
    game_context?: {
        requestedId?: string
        detectedId?: string | null
        label?: string | null
        source?: "manual" | "filename" | "none" | string
        glossaryApplied?: boolean
        refinementCount?: number
        learnedCorrectionCount?: number
    }
    signal_summary?: {
        perceptualLoudness?: boolean
        visualChange?: boolean
        sceneChangeCount?: number
        visualSampling?: string
        candidateStrategy?: "peak" | "legacy"
        warnings?: string[]
    }
    agentThinking?: string
    stats: {
        total_chunks?: number
        total_segments_scored?: number
        highlights_found: number
        processing_time_sec: number
        cache_hit?: boolean
    }
}

// ============================================================
// コマンドラッパー
// ============================================================

export const commands = {
    // --- 動画エンジン（公開軽量版では初回にBtbN公式GitHubから取得） ---
    getFfmpegRuntimeStatus: () =>
        invoke<FfmpegRuntimeStatus>("get_ffmpeg_runtime_status"),
    downloadFfmpegRuntime: () =>
        invoke<FfmpegRuntimeStatus>("download_ffmpeg_runtime"),
    cancelFfmpegRuntimeDownload: () =>
        invoke<void>("cancel_ffmpeg_runtime_download"),
    removeDownloadedFfmpegRuntime: () =>
        invoke<FfmpegRuntimeStatus>("remove_downloaded_ffmpeg_runtime"),

    // --- AI字幕モデル（軽量版では初回に公式配布元から取得） ---
    getWhisperModelStatus: () =>
        invoke<WhisperModelStatus>("get_whisper_model_status"),
    downloadWhisperModel: () =>
        invoke<WhisperModelStatus>("download_whisper_model"),
    cancelWhisperModelDownload: () =>
        invoke<void>("cancel_whisper_model_download"),
    removeDownloadedWhisperModel: () =>
        invoke<WhisperModelStatus>("remove_downloaded_whisper_model"),

    // --- 商品ライセンス（Rust側で署名とPC紐付けを検証） ---
    getEntitlement: () => invoke<EntitlementSnapshot>("get_entitlement"),
    activateCreatorLicense: (params: { token: string }) =>
        invoke<EntitlementSnapshot>("activate_creator_license", params),
    deactivateCreatorLicense: () =>
        invoke<EntitlementSnapshot>("deactivate_creator_license"),

    // --- クラッシュ復旧（アプリデータ領域へ原子的に自動保存） ---
    saveRecoverySnapshot: (params: { projectJson: string }) =>
        invoke<void>("save_recovery_snapshot", params),
    getRecoverySnapshot: () =>
        invoke<RecoverySnapshot | null>("get_recovery_snapshot"),
    clearRecoverySnapshot: () =>
        invoke<void>("clear_recovery_snapshot"),
    saveProjectFile: (params: { projectPath: string; projectJson: string }) =>
        invoke<void>("save_project_file", params),
    saveHandoffFile: (params: { handoffPath: string; content: string }) =>
        invoke<void>("save_handoff_file", params),

    // --- 動画情報 ---
    getVideoInfo: (params: { inputPath: string }) =>
        invoke<VideoInfo>("get_video_info", params),
    saveGeneratedSticker: (params: { pngBase64: string }) =>
        invoke<string>("save_generated_sticker", params),
    authorizeProjectAssets: (params: { assets: Array<{ path: string; kind: "video" | "image" | "audio" | "proxy" | "lut" | "font" }> }) =>
        invoke<void>("authorize_project_assets", params),
    listSystemVoices: () => invoke<string[]>("list_system_voices"),
    synthesizeSpeech: (params: { text: string; voice?: string | null; rate: number }) =>
        invoke<string>("synthesize_speech", params),
    generateMediaProxy: (params: { inputPath: string }) =>
        invoke<MediaProxyResult>("generate_media_proxy", params),
    removeMediaProxy: (params: { proxyPath: string }) =>
        invoke<void>("remove_media_proxy", params),

    // --- 波形データ ---
    getWaveformData: (params: { inputPath: string; samplesPerSecond?: number }) =>
        invoke<number[]>("get_waveform_data", params),

    // --- 音声抽出 ---
    extractAudio: (params: {
        inputPath: string
        outputPath: string
        startTime: number
        duration?: number | null
    }) => invoke<void>("extract_audio", params),



    // --- ハイライト分析 ---
    analyzeHighlights: (params: {
        videoPath: string
        chunkSize?: number
        threshold?: number
        maxClips?: number
        language?: string
        gameId?: string
        gpuType?: string
        forceReanalyze?: boolean
        clientJobId?: string
        translateToEnglish?: boolean
    }) => invoke<HighlightAnalysisResponse>("analyze_highlights", params),

    cancelAnalysis: (params: { clientJobId?: string | null }) =>
        invoke<{ status: string; cancelled: number }>("cancel_analysis", params),

    // --- 無音区間検出 ---
    detectSilenceSegments: (params: {
        inputPath: string
        trimStart?: number | null
        trimDuration?: number | null
        thresholdDb: number
        minDuration: number
        padding: number
    }) => invoke<SilenceSegment[]>("detect_silence_segments", params),

    // --- GPU検出 ---
    detectGpu: () => invoke<string>("detect_gpu"),

    // --- フォント（プレビューと書き出しで同じ実ファイルを使用） ---
    listSystemFonts: () => invoke<FontDescriptor[]>("list_system_fonts"),
    importFontFile: (params: { fontPath: string }) =>
        invoke<FontDescriptor>("import_font_file", params),
    resolveFontPreview: (params: { fontRef: string; text: string }) =>
        invoke<FontResolution>("resolve_font_preview", params),

    // --- 動画処理 ---
    processVideoVFocus: (params: { params: unknown }) =>
        invoke<void>("process_video_v_focus", params),

    // --- ローカル編集履歴（動画内容やパスは保存しない） ---
    appendHighlightFeedback: (params: { event: HighlightFeedbackEvent }) =>
        invoke<void>("append_highlight_feedback", params),
    appendHighlightFeedbackBatch: (params: { events: HighlightFeedbackEvent[] }) =>
        invoke<void>("append_highlight_feedback_batch", params),
    getHighlightFeedbackStatus: () =>
        invoke<HighlightFeedbackStatus>("get_highlight_feedback_status"),
    getHighlightFeedbackSummary: () =>
        invoke<HighlightFeedbackSummary>("get_highlight_feedback_summary"),
    clearHighlightFeedback: () =>
        invoke<void>("clear_highlight_feedback"),

    // --- 字幕修正学習 ---
    learnSubtitleCorrection: (params: {
        originalText: string
        correctedText: string
        gameId?: string | null
        sourcePath?: string | null
    }) =>
        invoke<void>("learn_subtitle_correction", params),

    // --- デーモンヘルスチェック (GPU情報含む) ---
    checkDaemonHealth: () => invoke<{
        status: string
        engine_loaded: boolean
        device: string
        hardware_gpu: string
    }>("check_daemon_health"),

    // --- デーモン診断情報 ---
    getDaemonDiagnostics: () => invoke<{
        alive: boolean
        pendingRequests: number
        stderrTail: string[]
        restartCount: number
        lastStartError: string | null
    }>("get_daemon_diagnostics"),
} as const
