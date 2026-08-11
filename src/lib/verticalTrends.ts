import type { PublishPlatform } from "./types.ts"
import type { VFocusDocument } from "../stores/document.ts"

export interface PlatformSpec {
    id: PublishPlatform
    label: string
    shortLabel: string
    idealDuration: [number, number]
    uploadMaxSeconds: number
    discoveryMaxSeconds: number | null
    uploadUrl: string
    technical: string
    safeZone: { top: number; right: number; bottom: number; left: number }
}

/** 投稿UIは変動するため、プラットフォーム固有の保証値ではなく共通の保守ガイドとして扱う。 */
export const CONSERVATIVE_UI_GUIDE = { top: 0.10, right: 0.16, bottom: 0.21, left: 0.05 }

export const PLATFORM_SPECS: Record<PublishPlatform, PlatformSpec> = {
    tiktok: {
        id: "tiktok",
        label: "TikTok",
        shortLabel: "TikTok",
        idealDuration: [10, 60],
        uploadMaxSeconds: 30 * 60,
        discoveryMaxSeconds: null,
        uploadUrl: "https://www.tiktok.com/tiktokstudio/upload",
        technical: "MP4 / 1080×1920 / 9:16 / 音あり",
        safeZone: CONSERVATIVE_UI_GUIDE,
    },
    instagram: {
        id: "instagram",
        label: "Instagram Reels",
        shortLabel: "Reels",
        idealDuration: [7, 60],
        uploadMaxSeconds: 20 * 60,
        discoveryMaxSeconds: 3 * 60,
        uploadUrl: "https://www.instagram.com/",
        technical: "MP4 / 1080×1920 / 9:16 / 30fps以上",
        safeZone: CONSERVATIVE_UI_GUIDE,
    },
    youtube: {
        id: "youtube",
        label: "YouTube Shorts",
        shortLabel: "Shorts",
        idealDuration: [15, 60],
        uploadMaxSeconds: 3 * 60,
        discoveryMaxSeconds: 3 * 60,
        uploadUrl: "https://studio.youtube.com/",
        technical: "MP4 / 1080×1920 / 9:16 / 3分以内",
        safeZone: CONSERVATIVE_UI_GUIDE,
    },
}

export function normalizeHashtags(value: string) {
    const tags = value
        .split(/[\s,、]+/)
        .map((tag) => tag.trim().replace(/^#+/, ""))
        .filter(Boolean)
    return [...new Set(tags)].map((tag) => `#${tag}`).join(" ")
}

export function buildPostText(document: Pick<VFocusDocument, "publishing">) {
    return [
        document.publishing.caption.trim(),
        document.publishing.cta.trim(),
        normalizeHashtags(document.publishing.hashtags),
    ].filter(Boolean).join("\n\n")
}
