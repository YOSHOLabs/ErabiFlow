/**
 * project.ts — プロジェクトファイルの保存/読み込み (v15: KEEP/没判断を永続化)
 *
 * 永続対象をallowlistで抽出し、旧バージョンから段階的に正規化する。
 */

import { useDocumentStore, type VFocusDocument } from "../stores/document.ts"
import { useEditorStore } from "../stores/editor.ts"
import { DEFAULT_DOCUMENT } from "../stores/document.ts"
import type { ProcessingState } from "./types.ts"
import { normalizeMediaLibrary } from "./mediaLibrary.ts"
import { normalizeEditorTimeline } from "./multiTrack.ts"

// ============================================================
// スキーマ定義
// ============================================================

export const CURRENT_SCHEMA_VERSION = 15

export type ProjectAssetKind = "video" | "image" | "audio" | "proxy" | "lut" | "font"
export interface ProjectAssetReference {
    path: string
    kind: ProjectAssetKind
}

type PersistedProcessingSettings = Pick<
    ProcessingState,
    "analysisGameId" | "enableAutoReframe" | "enableJumpCut" | "jumpCutConfig"
>

/**
 * プロジェクトファイルへ保存する編集データ。
 * 再生状態・解析キャッシュ・GPU/進捗・Pro権限はアプリ実行中の状態なので含めない。
 */
type PersistedVFocusDocument = Omit<
    VFocusDocument,
    | "processing"
    | "waveformData"
    | "analysisArtifacts"
    | "activeAnalysisId"
    | "analysisJobs"
    | "activeAnalysisJobId"
> & {
    processing: PersistedProcessingSettings
}

interface ProjectFileV15 {
    version: 15
    document: PersistedVFocusDocument
}

interface ProjectFileV5 {
    version: 5
    document: Partial<PersistedVFocusDocument>
}

interface ProjectFileV4 {
    version: 4
    document: PersistedVFocusDocument
}

interface ProjectFileV3 {
    version: 3
    document: Partial<VFocusDocument>
}

/** v2 = 旧分割ストア時代のフォーマット */
interface ProjectFileV2 {
    version: 2
    project: { inputPath: string; avatarPath: string; videoInfo: any }
    timeline: { trim: any }
    text: { text: any; subtitles: any }
    avatar: { avatar: any; game: any }
    processing: { processing: any }
}

/** v1 = フラットフォーマット */
interface ProjectFileV1 {
    inputPath: string
    avatarPath: string
    videoInfo: any
    trim: any
    text: any
    avatar: any
    game: any
    processing: any
    subtitles: any
}

// ============================================================
// マイグレーション
// ============================================================

function normalizeDocument(raw: Partial<VFocusDocument>, legacyLayout = false): PersistedVFocusDocument {
    const mediaLibrary = normalizeMediaLibrary(raw)
    const editorTimeline = normalizeEditorTimeline(raw)
    const merged = {
        ...DEFAULT_DOCUMENT,
        ...raw,
        ...mediaLibrary,
        ...editorTimeline,
        trim: {
            start: Number.isFinite(raw.trim?.start) ? raw.trim!.start : DEFAULT_DOCUMENT.trim.start,
            end: Number.isFinite(raw.trim?.end) ? raw.trim!.end : DEFAULT_DOCUMENT.trim.end,
        },
        game: {
            ...DEFAULT_DOCUMENT.game,
            ...(raw.game ?? {}),
            layoutMode: raw.game?.layoutMode ?? (legacyLayout ? "commentary" : DEFAULT_DOCUMENT.game.layoutMode),
        },
        text: {
            ...DEFAULT_DOCUMENT.text,
            ...(raw.text ?? {}),
        },
        subtitleStyle: {
            ...DEFAULT_DOCUMENT.subtitleStyle,
            ...(raw.subtitleStyle ?? {}),
        },
        publishing: {
            ...DEFAULT_DOCUMENT.publishing,
            ...(raw.publishing ?? {}),
        },
        watermark: {
            ...DEFAULT_DOCUMENT.watermark,
            ...(raw.watermark ?? {}),
        },
        processing: {
            ...DEFAULT_DOCUMENT.processing,
            ...(raw.processing ?? {}),
        },
    }
    return extractDocument(merged)
}

function disableLegacyAutoReframe(document: PersistedVFocusDocument): PersistedVFocusDocument {
    return {
        ...document,
        processing: {
            ...document.processing,
            enableAutoReframe: false,
        },
    }
}

function migrateV1toV15(v1: ProjectFileV1): ProjectFileV15 {
    return {
        version: 15,
        document: disableLegacyAutoReframe(normalizeDocument({
            inputPath: v1.inputPath ?? "",
            avatarPath: v1.avatarPath ?? "",
            videoInfo: v1.videoInfo ?? null,
            trim: v1.trim ?? DEFAULT_DOCUMENT.trim,
            text: v1.text ?? DEFAULT_DOCUMENT.text,
            subtitles: v1.subtitles ?? [],
            avatar: v1.avatar ?? DEFAULT_DOCUMENT.avatar,
            game: v1.game ?? {},
            processing: v1.processing ?? DEFAULT_DOCUMENT.processing,
        }, true)),
    }
}

function migrateV2toV15(v2: ProjectFileV2): ProjectFileV15 {
    return {
        version: 15,
        document: disableLegacyAutoReframe(normalizeDocument({
            inputPath: v2.project?.inputPath ?? "",
            avatarPath: v2.project?.avatarPath ?? "",
            videoInfo: v2.project?.videoInfo ?? null,
            trim: v2.timeline?.trim ?? DEFAULT_DOCUMENT.trim,
            text: v2.text?.text ?? DEFAULT_DOCUMENT.text,
            subtitles: v2.text?.subtitles ?? [],
            avatar: v2.avatar?.avatar ?? DEFAULT_DOCUMENT.avatar,
            game: v2.avatar?.game ?? {},
            processing: v2.processing?.processing ?? DEFAULT_DOCUMENT.processing,
        }, true)),
    }
}

function migrateLegacyBgm(document: Partial<VFocusDocument>): Partial<VFocusDocument> {
    // v5までの bgmStart は「BGM素材内の読み始め」だった。
    // v6ではタイムライン開始位置へ意味が変わるため、旧値をtrimStartへ移す。
    return {
        ...document,
        bgmStart: 0,
        bgmEnd: null,
        bgmTrimStart: document.bgmTrimStart ?? document.bgmStart ?? 0,
        bgmSourceDuration: document.bgmSourceDuration ?? null,
    }
}

function ensureLatestVersion(raw: any): ProjectFileV15 {
    if (!raw.version) return migrateV1toV15(raw as ProjectFileV1)
    if (raw.version === 2) return migrateV2toV15(raw as ProjectFileV2)
    if (raw.version === 3) {
        const v3 = raw as ProjectFileV3
        return { version: 15, document: disableLegacyAutoReframe(normalizeDocument(migrateLegacyBgm(v3.document), true)) }
    }
    if (raw.version === 4) {
        const v4 = raw as ProjectFileV4
        return {
            version: 15,
            document: disableLegacyAutoReframe(
                normalizeDocument(migrateLegacyBgm(v4.document as unknown as Partial<VFocusDocument>), true),
            ),
        }
    }
    if (raw.version === 5) {
        const v5 = raw as ProjectFileV5
        return {
            version: 15,
            document: normalizeDocument(migrateLegacyBgm(v5.document as Partial<VFocusDocument>), true),
        }
    }
    if (raw.version === 6) {
        return {
            version: 15,
            document: normalizeDocument(raw.document as Partial<VFocusDocument>, true),
        }
    }
    if (raw.version === 7) {
        return {
            version: 15,
            document: normalizeDocument(raw.document as Partial<VFocusDocument>, true),
        }
    }
    if ([8, 9, 10, 11, 12, 13, 14].includes(raw.version)) {
        return {
            version: 15,
            document: normalizeDocument(raw.document as Partial<VFocusDocument>, true),
        }
    }
    if (raw.version === 15) {
        return { version: 15, document: normalizeDocument(raw.document as Partial<VFocusDocument>) }
    }
    throw new Error(`未対応のプロジェクトファイルバージョン: ${raw.version}`)
}

// ============================================================
// 保存 / 読み込み
// ============================================================

/** ドキュメント状態をプロジェクトファイル形式で取得する */
export function serializeProject(): string {
    const state = useDocumentStore.getState()

    // ホワイトリスト方式: VFocusDocument のキーだけを抽出する
    // → アクション関数を手動除外する必要がなく、新しいアクション追加時の漏れを防止
    const document = extractDocument(state)

    const data: ProjectFileV15 = {
        version: CURRENT_SCHEMA_VERSION,
        document,
    }

    return JSON.stringify(data, null, 2)
}

/**
 * ストア状態からデータのみを安全に抽出する。
 * VFocusDocument のキーだけをピックすることで、
 * アクション関数が混入するリスクを排除する。
 */
const DOCUMENT_KEYS = [
    'inputPath', 'avatarPath', 'videoInfo', 'bgmPath', 'bgmVolume', 'bgmStart',
    'bgmEnd', 'bgmTrimStart', 'bgmSourceDuration',
    'mediaAssets', 'mediaFolders',
    'editorTracks', 'trackMediaClips',
    'trim', 'silenceSegments', 'ducking', 'timelineClips',
    'text', 'subtitleStyle', 'subtitles', 'customFonts',
    'avatar', 'game',
    'seSlots', 'seFolderPath', 'seFileEntries', 'images', 'creatorBatch', 'publishing', 'watermark',
    'excitementGraph', 'agentThinking', 'recommendedCuts', 'rejectedHighlightCandidateIndices',
] as const satisfies readonly (keyof PersistedVFocusDocument)[]

// 新しい永続fieldを追加したのにallowlistへ入れ忘れた場合はcompile errorにする。
const _documentKeysAreExhaustive: Record<
    Exclude<keyof PersistedVFocusDocument, typeof DOCUMENT_KEYS[number] | "processing">,
    never
> = {}
void _documentKeysAreExhaustive

function extractDocument(state: VFocusDocument): PersistedVFocusDocument {
    const doc: Record<string, unknown> = {}
    for (const key of DOCUMENT_KEYS) {
        doc[key] = state[key]
    }
    doc.trim = { start: state.trim.start, end: state.trim.end }
    doc.processing = {
        analysisGameId: state.processing.analysisGameId,
        enableAutoReframe: state.processing.enableAutoReframe,
        enableJumpCut: state.processing.enableJumpCut,
        jumpCutConfig: { ...state.processing.jumpCutConfig },
    } satisfies PersistedProcessingSettings
    return doc as PersistedVFocusDocument
}

/** プロジェクトファイルの JSON を読み込み、ドキュメントストアに反映する */
export function deserializeProject(json: string): void {
    const raw = JSON.parse(json)
    const data = ensureLatestVersion(raw)
    const current = useDocumentStore.getState()
    current.loadDocument({
        ...data.document,
        waveformData: [],
        analysisJobs: [],
        activeAnalysisJobId: null,
        processing: {
            ...DEFAULT_DOCUMENT.processing,
            ...data.document.processing,
        },
    })
    useEditorStore.getState().resetPlayback()
    // 読み込む前の別プロジェクトへ Ctrl+Z で戻らないよう、ここを履歴の起点にする。
    useDocumentStore.temporal.getState().clear()
}

/** 再起動後のasset scope再認可に必要な参照だけを、移行済みプロジェクトから列挙する。 */
export function collectProjectAssetReferences(json: string): ProjectAssetReference[] {
    const raw = JSON.parse(json)
    const data = ensureLatestVersion(raw)
    const document = data.document
    const result: ProjectAssetReference[] = []
    const seen = new Set<string>()
    const add = (path: unknown, kind: ProjectAssetKind) => {
        if (typeof path !== "string" || !path.trim()) return
        const key = `${kind}:${path.toLocaleLowerCase()}`
        if (seen.has(key)) return
        seen.add(key)
        result.push({ path, kind })
    }

    add(document.inputPath, "video")
    add(document.avatarPath, "image")
    add(document.bgmPath, "audio")
    for (const asset of document.mediaAssets ?? []) {
        add(asset.path, asset.kind)
        add(asset.proxyPath, "proxy")
    }
    for (const clip of document.trackMediaClips ?? []) {
        add(clip.path, clip.kind)
        add(clip.color?.lutPath, "lut")
    }
    for (const clip of document.timelineClips ?? []) add(clip.color?.lutPath, "lut")
    for (const image of document.images ?? []) add(image.path, "image")
    for (const se of document.seSlots ?? []) add(se.path, "audio")
    for (const entry of document.seFileEntries ?? []) add(entry.path, "audio")
    for (const font of document.customFonts ?? []) add(font.path, "font")
    return result
}
