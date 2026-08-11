import { getClipColor } from "./color.ts"
import { getClipEffects } from "./effects.ts"
import { upsertKeyframes } from "./keyframes.ts"
import { getTimelineClipDuration, getTimelineClipTransform } from "./timeline.ts"
import type { MediaAsset, TimelineClip, TrackMediaClip } from "./types.ts"
import { DEFAULT_TIMELINE_CLIP_TRANSFORM } from "./types.ts"

export type CompositePlacement = "top-left" | "top-right" | "ellipse" | "lower" | "fullscreen"

export const COMPOSITE_PLACEMENTS: ReadonlyArray<{
    id: CompositePlacement
    label: string
    detail: string
}> = [
    { id: "top-left", label: "左上小窓", detail: "顔出しHUD" },
    { id: "top-right", label: "右上小窓", detail: "ツッコミ枠" },
    { id: "ellipse", label: "楕円切り抜き", detail: "大きな反応" },
    { id: "lower", label: "下段2画面", detail: "上下合成" },
    { id: "fullscreen", label: "全面差し込み", detail: "カットアウェイ" },
]

const PLACEMENT_TRANSFORM: Record<CompositePlacement, TrackMediaClip["transform"]> = {
    "top-left": { ...DEFAULT_TIMELINE_CLIP_TRANSFORM, positionX: -0.52, positionY: -0.52, scale: 0.34 },
    "top-right": { ...DEFAULT_TIMELINE_CLIP_TRANSFORM, positionX: 0.52, positionY: -0.52, scale: 0.34 },
    ellipse: { ...DEFAULT_TIMELINE_CLIP_TRANSFORM, positionX: 0, positionY: -0.14, scale: 0.82 },
    lower: { ...DEFAULT_TIMELINE_CLIP_TRANSFORM, positionX: 0, positionY: 0.53, scale: 0.58 },
    fullscreen: { ...DEFAULT_TIMELINE_CLIP_TRANSFORM },
}

export function applyCompositePlacement(
    clip: TrackMediaClip,
    placement: CompositePlacement,
): TrackMediaClip {
    const effects = getClipEffects(clip.effects)
    return {
        ...clip,
        transform: {
            ...PLACEMENT_TRANSFORM[placement],
            flipHorizontal: clip.transform.flipHorizontal,
            flipVertical: clip.transform.flipVertical,
            opacity: clip.transform.opacity,
        },
        effects: {
            ...effects,
            mask: placement === "ellipse"
                ? { shape: "ellipse", x: 0.5, y: 0.5, width: 0.94, height: 0.94, feather: 3 }
                : { ...effects.mask, shape: "none" },
        },
    }
}

export interface CompositeClipOptions {
    timelineStart: number
    duration: number
    placement: CompositePlacement
    includeAudio: boolean
}

export function createCompositeVideoClip(
    asset: MediaAsset,
    trackId: string,
    options: CompositeClipOptions,
    makeId: () => string,
): TrackMediaClip | null {
    if (asset.kind !== "video") return null
    const available = Math.max(0.1, asset.duration ?? options.duration)
    const duration = Math.max(0.1, Math.min(options.duration, available))
    return applyCompositePlacement({
        id: makeId(),
        trackId,
        assetId: asset.id,
        path: asset.path,
        kind: "video",
        label: asset.name,
        timelineStart: Math.max(0, options.timelineStart),
        timelineEnd: Math.max(0, options.timelineStart) + duration,
        sourceStart: 0,
        sourceEnd: duration,
        volume: 1,
        muted: !options.includeAudio,
        hasAudio: asset.hasAudio !== false,
        transform: { ...DEFAULT_TIMELINE_CLIP_TRANSFORM },
    }, options.placement)
}

export type ClipVisualAction = "punch" | "whip" | "rotate" | "impact" | "monochrome"

export const CLIP_VISUAL_ACTIONS: ReadonlyArray<{
    id: ClipVisualAction
    label: string
    detail: string
}> = [
    { id: "punch", label: "パンチズーム", detail: "一瞬寄って戻す" },
    { id: "whip", label: "横振り", detail: "素早く横移動" },
    { id: "rotate", label: "回転イン", detail: "傾きから戻す" },
    { id: "impact", label: "衝撃", detail: "ブレ＋色ずれ" },
    { id: "monochrome", label: "白黒", detail: "オチ・回想" },
]

export function applyClipVisualAction(clip: TimelineClip, action: ClipVisualAction): TimelineClip {
    const duration = Math.max(0.1, getTimelineClipDuration(clip))
    const settle = Math.min(0.18, duration * 0.35)
    const transform = getTimelineClipTransform(clip)
    if (action === "punch") {
        let keyframes = upsertKeyframes(clip.keyframes, 0, { scale: Math.min(3, transform.scale + 0.2) })
        keyframes = upsertKeyframes(keyframes, settle, { scale: transform.scale })
        return { ...clip, keyframes }
    }
    if (action === "whip") {
        let keyframes = upsertKeyframes(clip.keyframes, 0, { positionX: Math.max(-1, transform.positionX - 0.12) })
        keyframes = upsertKeyframes(keyframes, settle, { positionX: transform.positionX })
        const effects = getClipEffects(clip.effects)
        return { ...clip, keyframes, effects: { ...effects, motionBlur: Math.max(18, effects.motionBlur) } }
    }
    if (action === "rotate") {
        let keyframes = upsertKeyframes(clip.keyframes, 0, { rotation: transform.rotation - 3.5 })
        keyframes = upsertKeyframes(keyframes, settle, { rotation: transform.rotation })
        return { ...clip, keyframes }
    }
    if (action === "impact") {
        const effects = getClipEffects(clip.effects)
        return {
            ...clip,
            effects: {
                ...effects,
                shake: Math.max(18, effects.shake),
                rgbShift: Math.max(8, effects.rgbShift),
                chromaticAberration: Math.max(6, effects.chromaticAberration),
            },
        }
    }
    return {
        ...clip,
        color: { ...getClipColor(clip.color), saturation: 0, contrast: Math.max(118, getClipColor(clip.color).contrast) },
    }
}
