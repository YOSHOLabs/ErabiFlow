import type { ClipKeyframe, ClipKeyframeProperty, TimelineClipTransform } from "./types.ts"

export const KEYFRAME_VALUE_BOUNDS: Record<ClipKeyframeProperty, readonly [number, number]> = {
    positionX: [-1, 1],
    positionY: [-1, 1],
    scale: [0.1, 3],
    rotation: [-180, 180],
    opacity: [0, 1],
    volume: [0, 2],
}

export function clampKeyframeValue(property: ClipKeyframeProperty, value: number): number {
    const [minimum, maximum] = KEYFRAME_VALUE_BOUNDS[property]
    if (!Number.isFinite(value)) return minimum
    return Math.max(minimum, Math.min(maximum, value))
}

export function evaluateKeyframeValue(
    keyframes: readonly ClipKeyframe[] | undefined,
    property: ClipKeyframeProperty,
    baseValue: number,
    localTime: number,
) {
    const safeBaseValue = clampKeyframeValue(property, baseValue)
    const points = (keyframes ?? [])
        .filter((keyframe) => keyframe.property === property)
        .map((keyframe) => ({ ...keyframe, value: clampKeyframeValue(property, keyframe.value) }))
        .sort((a, b) => a.time - b.time)
    if (points.length === 0) return safeBaseValue
    const time = Math.max(0, localTime)
    const first = points[0]
    if (time <= first.time) {
        if (first.time <= 0 || first.interpolation === "hold") return first.value
        return safeBaseValue + (first.value - safeBaseValue) * (time / first.time)
    }
    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1]
        const next = points[index]
        if (time <= next.time) {
            if (next.interpolation === "hold") return previous.value
            const progress = (time - previous.time) / Math.max(0.001, next.time - previous.time)
            return previous.value + (next.value - previous.value) * progress
        }
    }
    return points[points.length - 1].value
}

export function evaluateClipAnimation(
    keyframes: readonly ClipKeyframe[] | undefined,
    transform: TimelineClipTransform,
    volume: number,
    localTime: number,
) {
    return {
        transform: {
            ...transform,
            positionX: evaluateKeyframeValue(keyframes, "positionX", transform.positionX, localTime),
            positionY: evaluateKeyframeValue(keyframes, "positionY", transform.positionY, localTime),
            scale: evaluateKeyframeValue(keyframes, "scale", transform.scale, localTime),
            rotation: evaluateKeyframeValue(keyframes, "rotation", transform.rotation, localTime),
            opacity: evaluateKeyframeValue(keyframes, "opacity", transform.opacity, localTime),
        },
        volume: evaluateKeyframeValue(keyframes, "volume", volume, localTime),
    }
}

export function upsertKeyframes(
    keyframes: readonly ClipKeyframe[] | undefined,
    time: number,
    values: Partial<Record<ClipKeyframeProperty, number>>,
    interpolation: ClipKeyframe["interpolation"] = "linear",
) {
    const next = [...(keyframes ?? [])]
    for (const [property, value] of Object.entries(values) as [ClipKeyframeProperty, number][]) {
        const safeValue = clampKeyframeValue(property, value)
        const existing = next.find((keyframe) => keyframe.property === property && Math.abs(keyframe.time - time) < 0.001)
        if (existing) Object.assign(existing, { value: safeValue, interpolation })
        else next.push({
            id: globalThis.crypto?.randomUUID?.() ?? `keyframe-${Date.now()}-${property}`,
            time: Math.max(0, time), property, value: safeValue, interpolation,
        })
    }
    return next.sort((a, b) => a.time - b.time || a.property.localeCompare(b.property))
}
