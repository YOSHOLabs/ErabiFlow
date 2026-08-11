import type { SubtitleStyle, SubtitleStyleOverride, TextSegment } from "./types.ts"

/** 個別編集を開始した時点の外観を固定し、以後の全体設定変更から独立させる。 */
export function createSubtitleStyleOverride(style: SubtitleStyle): SubtitleStyleOverride {
    return {
        font: style.font,
        color: style.color,
        size: style.size,
        strokeColor: style.strokeColor,
        strokeWidth: style.strokeWidth,
        shadowColor: style.shadowColor,
        shadowBlur: style.shadowBlur,
        positionY: style.positionY,
        emphasisMode: style.emphasisMode,
        emphasisColor: style.emphasisColor,
    }
}

export function resolveSubtitleStyle(
    style: SubtitleStyle,
    subtitle?: Pick<TextSegment, "styleOverride"> | null,
): SubtitleStyle {
    return {
        ...style,
        ...(subtitle?.styleOverride ?? {}),
    }
}
