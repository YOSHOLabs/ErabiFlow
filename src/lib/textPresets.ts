import type { SubtitleStyle, TextState } from "./types.ts"

export interface TextStylePreset {
    id: "impact" | "clean" | "pop" | "news" | "minimal" | "gaming"
    label: string
    description: string
    title: Partial<TextState>
    subtitle: Partial<SubtitleStyle>
}

/** 縦動画で読みやすさを優先した、タイトルと字幕の共通スタイルセット。 */
export const TEXT_STYLE_PRESETS: readonly TextStylePreset[] = [
    {
        id: "impact", label: "インパクト", description: "太い白文字＋黒縁",
        title: { color: "#FFFFFF", size: 72, strokeColor: "#000000", strokeWidth: 8, shadowColor: "rgba(0,0,0,0.65)", shadowBlur: 4, letterSpacing: 1, lineHeight: 1.05 },
        subtitle: { color: "#FFFFFF", size: 48, strokeColor: "#000000", strokeWidth: 7, shadowColor: "rgba(0,0,0,0.6)", shadowBlur: 3, letterSpacing: 0, lineHeight: 1.1, positionY: 0.82 },
    },
    {
        id: "clean", label: "クリーン", description: "小さめで端正",
        title: { color: "#FFFFFF", size: 54, strokeColor: "#111827", strokeWidth: 3, shadowColor: "rgba(0,0,0,0.45)", shadowBlur: 2, letterSpacing: 2, lineHeight: 1.2 },
        subtitle: { color: "#FFFFFF", size: 40, strokeColor: "#111827", strokeWidth: 4, shadowColor: "rgba(0,0,0,0.45)", shadowBlur: 2, letterSpacing: 1, lineHeight: 1.2, positionY: 0.84 },
    },
    {
        id: "pop", label: "ポップ", description: "黄色＋ピンクの強調",
        title: { color: "#FDE047", size: 68, strokeColor: "#BE185D", strokeWidth: 7, shadowColor: "rgba(0,0,0,0.55)", shadowBlur: 5, letterSpacing: 1, lineHeight: 1.05 },
        subtitle: { color: "#FFFFFF", size: 46, strokeColor: "#BE185D", strokeWidth: 6, shadowColor: "rgba(0,0,0,0.55)", shadowBlur: 3, letterSpacing: 0, lineHeight: 1.1, positionY: 0.82, emphasisMode: "karaoke", emphasisColor: "#FDE047" },
    },
    {
        id: "news", label: "ニュース", description: "青縁で説明向け",
        title: { color: "#E0F2FE", size: 58, strokeColor: "#075985", strokeWidth: 6, shadowColor: "rgba(0,0,0,0.5)", shadowBlur: 3, letterSpacing: 1, lineHeight: 1.1 },
        subtitle: { color: "#F0F9FF", size: 42, strokeColor: "#075985", strokeWidth: 5, shadowColor: "rgba(0,0,0,0.5)", shadowBlur: 2, letterSpacing: 0, lineHeight: 1.15, positionY: 0.84 },
    },
    {
        id: "minimal", label: "ミニマル", description: "細い白文字",
        title: { color: "#FAFAFA", size: 48, strokeColor: "#000000", strokeWidth: 1, shadowColor: "rgba(0,0,0,0.35)", shadowBlur: 2, letterSpacing: 4, lineHeight: 1.3 },
        subtitle: { color: "#FAFAFA", size: 36, strokeColor: "#000000", strokeWidth: 2, shadowColor: "rgba(0,0,0,0.35)", shadowBlur: 2, letterSpacing: 2, lineHeight: 1.25, positionY: 0.86 },
    },
    {
        id: "gaming", label: "ゲーミング", description: "シアン＋紫の配色",
        title: { color: "#67E8F9", size: 66, strokeColor: "#581C87", strokeWidth: 7, shadowColor: "rgba(34,211,238,0.55)", shadowBlur: 6, letterSpacing: 1, lineHeight: 1.05 },
        subtitle: { color: "#FFFFFF", size: 45, strokeColor: "#581C87", strokeWidth: 6, shadowColor: "rgba(34,211,238,0.45)", shadowBlur: 4, letterSpacing: 0, lineHeight: 1.1, positionY: 0.82, emphasisMode: "karaoke", emphasisColor: "#67E8F9" },
    },
] as const
