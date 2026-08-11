import type { ClipMotionPreset, TimelineClipTransform } from "./types.ts"

/** キーフレーム／トランジションの後に重ねる短尺向けモーション。 */
export function applyMotionPreset(
    transform: TimelineClipTransform,
    preset: ClipMotionPreset | undefined,
    localTime: number,
): TimelineClipTransform {
    const time = Math.max(0, localTime)
    if (!preset || preset === "none") return transform
    if (preset === "swing") return { ...transform, rotation: transform.rotation + Math.sin(time * Math.PI * 3.2) * 8 }
    if (preset === "bounce") return { ...transform, positionY: transform.positionY - Math.abs(Math.sin(time * Math.PI * 2.5)) * 0.14 }
    const pulse = Math.max(0, Math.exp(-time * 3.2) * (0.22 + Math.abs(Math.sin(time * Math.PI * 5)) * 0.12))
    return { ...transform, scale: transform.scale * (1 + pulse) }
}
