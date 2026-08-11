import { DEFAULT_CLIP_COLOR, type ClipColorAdjustments } from "./types.ts"

export function getClipColor(color?: Partial<ClipColorAdjustments>): ClipColorAdjustments {
    const clamp = (value: number | undefined, min: number, max: number, fallback: number) =>
        Math.max(min, Math.min(max, value ?? fallback))
    return {
        brightness: clamp(color?.brightness, -100, 100, DEFAULT_CLIP_COLOR.brightness),
        contrast: clamp(color?.contrast, 0, 200, DEFAULT_CLIP_COLOR.contrast),
        saturation: clamp(color?.saturation, 0, 200, DEFAULT_CLIP_COLOR.saturation),
        temperature: clamp(color?.temperature, -100, 100, DEFAULT_CLIP_COLOR.temperature),
        tint: clamp(color?.tint, -100, 100, DEFAULT_CLIP_COLOR.tint),
        highlights: clamp(color?.highlights, -100, 100, DEFAULT_CLIP_COLOR.highlights),
        shadows: clamp(color?.shadows, -100, 100, DEFAULT_CLIP_COLOR.shadows),
        blacks: clamp(color?.blacks, -100, 100, DEFAULT_CLIP_COLOR.blacks),
        whites: clamp(color?.whites, -100, 100, DEFAULT_CLIP_COLOR.whites),
        hue: clamp(color?.hue, -180, 180, DEFAULT_CLIP_COLOR.hue),
        hslSaturation: clamp(color?.hslSaturation, -100, 100, DEFAULT_CLIP_COLOR.hslSaturation),
        lightness: clamp(color?.lightness, -100, 100, DEFAULT_CLIP_COLOR.lightness),
        curveShadows: clamp(color?.curveShadows, -100, 100, DEFAULT_CLIP_COLOR.curveShadows),
        curveMidtones: clamp(color?.curveMidtones, -100, 100, DEFAULT_CLIP_COLOR.curveMidtones),
        curveHighlights: clamp(color?.curveHighlights, -100, 100, DEFAULT_CLIP_COLOR.curveHighlights),
        ...(color?.lutPath ? { lutPath: color.lutPath } : {}),
    }
}

/** CanvasはLUTを直接扱えないため、数値補正を忠実にプレビューする。LUTは書き出しに適用する。 */
export function colorToCanvasFilter(color?: Partial<ClipColorAdjustments>): string {
    const value = getClipColor(color)
    const warmth = value.temperature / 100
    const tint = value.tint / 100
    const sepia = Math.abs(warmth) * 0.22 + Math.abs(tint) * 0.06
    const hue = value.hue + (warmth < 0 ? -8 * Math.abs(warmth) : 8 * warmth) + tint * 6
    const brightness = 100 + value.brightness + value.lightness * 0.35 + value.whites * 0.08 + value.blacks * 0.05 + value.curveMidtones * 0.12
    const contrast = value.contrast + value.highlights * 0.12 - value.shadows * 0.08 + value.curveHighlights * 0.08 - value.curveShadows * 0.08
    const saturation = value.saturation * (1 + value.hslSaturation / 100)
    return [
        `brightness(${Math.max(0, brightness).toFixed(1)}%)`,
        `contrast(${Math.max(0, contrast).toFixed(1)}%)`,
        `saturate(${Math.max(0, saturation).toFixed(1)}%)`,
        `sepia(${(sepia * 100).toFixed(1)}%)`,
        `hue-rotate(${hue.toFixed(1)}deg)`,
    ].join(" ")
}
