import type { MediaAsset, MediaAssetKind, MediaFolder, OverlayImage, VideoInfo } from "./types.ts"

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi", "mkv", "webm", "m4v"])
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"])
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus"])

export const MEDIA_DIALOG_EXTENSIONS = [
    ...VIDEO_EXTENSIONS,
    ...IMAGE_EXTENSIONS,
    ...AUDIO_EXTENSIONS,
]

export function mediaFileName(path: string) {
    return path.split(/[\\/]/).pop() || path
}

export function detectMediaKind(path: string): MediaAssetKind | null {
    const name = mediaFileName(path)
    const dot = name.lastIndexOf(".")
    const extension = dot >= 0 ? name.slice(dot + 1).toLocaleLowerCase() : ""
    if (VIDEO_EXTENSIONS.has(extension)) return "video"
    if (IMAGE_EXTENSIONS.has(extension)) return "image"
    if (AUDIO_EXTENSIONS.has(extension)) return "audio"
    return null
}

export function createMediaAsset(
    path: string,
    folderId: string | null = null,
    makeId: () => string = () => globalThis.crypto?.randomUUID?.() ?? `media-${Date.now()}`,
    now: () => string = () => new Date().toISOString(),
): MediaAsset | null {
    const kind = detectMediaKind(path)
    if (!kind) return null
    return {
        id: makeId(),
        kind,
        path,
        name: mediaFileName(path),
        folderId,
        favorite: false,
        addedAt: now(),
    }
}

export interface LegacyMediaLibraryInput {
    mediaAssets?: MediaAsset[]
    mediaFolders?: MediaFolder[]
    inputPath?: string
    videoInfo?: VideoInfo | null
    bgmPath?: string
    bgmSourceDuration?: number | null
    images?: OverlayImage[]
}

/**
 * v11以前の単一動画/BGM/画像フィールドも素材ライブラリへ移す。
 * 不正なフォルダ参照はルートへ戻し、同じパスは一つだけ保持する。
 */
export function normalizeMediaLibrary(raw: LegacyMediaLibraryInput) {
    const folders: MediaFolder[] = Array.isArray(raw.mediaFolders)
        ? raw.mediaFolders.filter((folder) => folder && typeof folder.id === "string" && typeof folder.name === "string")
        : []
    const folderIds = new Set(folders.map((folder) => folder.id))
    const assets: MediaAsset[] = Array.isArray(raw.mediaAssets)
        ? raw.mediaAssets
            .filter((asset) => asset && typeof asset.id === "string" && typeof asset.path === "string")
            .map((asset) => ({
                ...asset,
                name: asset.name || mediaFileName(asset.path),
                folderId: asset.folderId && folderIds.has(asset.folderId) ? asset.folderId : null,
                favorite: asset.favorite === true,
                addedAt: asset.addedAt || new Date(0).toISOString(),
            }))
        : []
    const knownPaths = new Set(assets.map((asset) => asset.path.toLocaleLowerCase()))

    const addLegacyAsset = (
        kind: MediaAssetKind,
        path: string | undefined,
        metadata: Partial<Pick<MediaAsset, "duration" | "width" | "height" | "fps">> = {},
    ) => {
        if (!path || knownPaths.has(path.toLocaleLowerCase())) return
        assets.push({
            id: `legacy-${kind}-${assets.length + 1}`,
            kind,
            path,
            name: mediaFileName(path),
            folderId: null,
            favorite: false,
            addedAt: new Date(0).toISOString(),
            ...metadata,
        })
        knownPaths.add(path.toLocaleLowerCase())
    }

    addLegacyAsset("video", raw.inputPath, raw.videoInfo ?? {})
    addLegacyAsset("audio", raw.bgmPath, { duration: raw.bgmSourceDuration ?? undefined })
    for (const image of raw.images ?? []) addLegacyAsset("image", image.path)

    return { mediaAssets: assets, mediaFolders: folders }
}
