/**
 * mediaSlice — アバター・ゲーム・SE・画像の状態とアクション
 */
import type { AvatarState, GameState, SeSlot, SeFileEntry, OverlayImage, Position, MediaAsset, MediaFolder } from "../../lib/types.ts"
import { DEFAULT_AVATAR, DEFAULT_GAME } from "../../lib/types.ts"

const MAX_SE_SLOTS = 8

export const createMediaSlice = (set: any) => ({
    // --- 初期値 ---
    avatar: DEFAULT_AVATAR,
    game: DEFAULT_GAME,
    seSlots: [] as SeSlot[],
    seFolderPath: "",
    seFileEntries: [] as SeFileEntry[],
    images: [] as OverlayImage[],
    mediaAssets: [] as MediaAsset[],
    mediaFolders: [] as MediaFolder[],

    // --- 素材ライブラリ ---
    addMediaAssets: (assets: MediaAsset[]) =>
        set((s: any) => {
            const existingPaths = new Set(s.mediaAssets.map((asset: MediaAsset) => asset.path.toLocaleLowerCase()))
            for (const asset of assets) {
                const normalizedPath = asset.path.toLocaleLowerCase()
                if (existingPaths.has(normalizedPath)) continue
                s.mediaAssets.push(asset)
                existingPaths.add(normalizedPath)
            }
        }),
    updateMediaAsset: (id: string, partial: Partial<MediaAsset>) =>
        set((s: any) => {
            const asset = s.mediaAssets.find((item: MediaAsset) => item.id === id)
            if (asset) Object.assign(asset, partial)
        }),
    removeMediaAsset: (id: string) =>
        set((s: any) => {
            s.mediaAssets = s.mediaAssets.filter((item: MediaAsset) => item.id !== id)
        }),
    addMediaFolder: (folder: MediaFolder) =>
        set((s: any) => {
            if (!s.mediaFolders.some((item: MediaFolder) => item.id === folder.id)) {
                s.mediaFolders.push(folder)
            }
        }),
    updateMediaFolder: (id: string, partial: Partial<MediaFolder>) =>
        set((s: any) => {
            const folder = s.mediaFolders.find((item: MediaFolder) => item.id === id)
            if (folder) Object.assign(folder, partial)
        }),
    removeMediaFolder: (id: string) =>
        set((s: any) => {
            s.mediaFolders = s.mediaFolders.filter((item: MediaFolder) => item.id !== id)
            for (const asset of s.mediaAssets as MediaAsset[]) {
                if (asset.folderId === id) asset.folderId = null
            }
        }),

    // --- アバター ---
    setAvatarPosition: (pos: Position) =>
        set((s: any) => {
            s.avatar.position = pos
        }),
    setAvatarScale: (scale: number) =>
        set((s: any) => {
            s.avatar.scale = Math.max(0.2, Math.min(2.0, scale))
        }),
    setGameLayoutMode: (mode: GameState["layoutMode"]) =>
        set((s: any) => {
            s.game.layoutMode = mode
            if (mode === "portrait" || mode === "stage") s.game.positionY = 0.5
        }),
    setGamePositionY: (y: number) =>
        set((s: any) => {
            s.game.positionY = Math.max(0.15, Math.min(0.65, y))
        }),
    setGameScale: (scale: number) =>
        set((s: any) => {
            s.game.scale = Math.max(1.0, Math.min(2.5, scale))
        }),

    // --- SE ---
    addSeSlot: (slot: SeSlot) =>
        set((s: any) => {
            if (s.seSlots.length < MAX_SE_SLOTS) s.seSlots.push(slot)
        }),
    removeSeSlot: (id: string) =>
        set((s: any) => {
            s.seSlots = s.seSlots.filter((x: any) => x.id !== id)
        }),
    updateSeSlot: (id: string, partial: Partial<SeSlot>) =>
        set((s: any) => {
            const slot = s.seSlots.find((x: any) => x.id === id)
            if (slot) Object.assign(slot, partial)
        }),
    clearSeSlots: () =>
        set((s: any) => {
            s.seSlots = []
        }),
    setSeFolderPath: (path: string) =>
        set((s: any) => {
            s.seFolderPath = path
        }),
    setSeFileEntries: (entries: SeFileEntry[]) =>
        set((s: any) => {
            s.seFileEntries = entries
        }),
    updateSeFileEntry: (id: string, partial: Partial<SeFileEntry>) =>
        set((s: any) => {
            const entry = s.seFileEntries.find((x: any) => x.id === id)
            if (entry) Object.assign(entry, partial)
        }),

    // --- 画像 ---
    addImage: (image: OverlayImage) =>
        set((s: any) => {
            s.images.push(image)
        }),
    removeImage: (id: string) =>
        set((s: any) => {
            s.images = s.images.filter((x: any) => x.id !== id)
        }),
    updateImage: (id: string, partial: Partial<OverlayImage>) =>
        set((s: any) => {
            const img = s.images.find((x: any) => x.id === id)
            if (img) Object.assign(img, partial)
        }),
    setImagePosition: (id: string, pos: Position) =>
        set((s: any) => {
            const img = s.images.find((x: any) => x.id === id)
            if (img) img.position = pos
        }),
    clearImages: () =>
        set((s: any) => {
            s.images = []
        }),
})
