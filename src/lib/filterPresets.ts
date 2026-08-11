import type { ClipColorAdjustments } from "./types.ts"
import { getClipColor } from "./color.ts"

export interface FilterPreset {
    id: "cinema" | "film" | "retro" | "monochrome" | "vintage" | "cool" | "warm" | "hdr"
    label: string
    description: string
    color: Partial<ClipColorAdjustments>
}

/**
 * 数値カラー補正だけで構成する軽量プリセット。
 * LUTファイルに依存しないため、配布先のPCでも同じ見た目を書き出せる。
 */
export const FILTER_PRESETS: readonly FilterPreset[] = [
    { id: "cinema", label: "シネマ", description: "締まった寒色", color: { brightness: -5, contrast: 118, saturation: 90, temperature: -8, shadows: -8, highlights: -4, curveMidtones: 4 } },
    { id: "film", label: "フィルム", description: "柔らかな暖色", color: { brightness: 4, contrast: 108, saturation: 88, temperature: 10, tint: 3, blacks: 5, curveHighlights: -6 } },
    { id: "retro", label: "レトロ", description: "淡く色あせた質感", color: { brightness: 8, contrast: 92, saturation: 78, temperature: 18, blacks: 14, highlights: -12 } },
    { id: "monochrome", label: "モノクロ", description: "高コントラスト白黒", color: { brightness: 0, contrast: 112, saturation: 0, temperature: 0 } },
    { id: "vintage", label: "ビンテージ", description: "低彩度の暖色", color: { brightness: 6, contrast: 95, saturation: 68, temperature: 22, tint: 7, blacks: 10, whites: -8 } },
    { id: "cool", label: "クール", description: "青みを強調", color: { brightness: 0, contrast: 105, saturation: 92, temperature: -28 } },
    { id: "warm", label: "ウォーム", description: "肌になじむ暖色", color: { brightness: 3, contrast: 106, saturation: 105, temperature: 28 } },
    { id: "hdr", label: "HDR風", description: "強いコントラスト", color: { brightness: 3, contrast: 128, saturation: 118, temperature: 0, shadows: 18, highlights: -12, blacks: -8, whites: 10 } },
] as const

export function applyFilterPreset(preset: FilterPreset, current?: Partial<ClipColorAdjustments>): ClipColorAdjustments {
    return getClipColor({
        ...preset.color,
        ...(current?.lutPath ? { lutPath: current.lutPath } : {}),
    })
}
