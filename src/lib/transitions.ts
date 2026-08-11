import type { ClipTransition, TimelineClipTransform } from "./types.ts"

const progress = (time: number, duration: number) => Math.max(0, Math.min(1, time / Math.max(0.05, duration)))
const smooth = (value: number) => value * value * (3 - 2 * value)

export function applyClipTransitions(
    transform: TimelineClipTransform,
    transitionIn: ClipTransition | undefined,
    transitionOut: ClipTransition | undefined,
    localTime: number,
    clipDuration: number,
) {
    let opacity = transform.opacity
    let positionX = transform.positionX
    let scale = transform.scale
    let rotation = transform.rotation
    if (transitionIn?.type && transitionIn.type !== "none") {
        const raw = progress(localTime, transitionIn.duration)
        const value = transitionIn.type === "dissolve" ? smooth(raw) : raw
        if (transitionIn.type === "fade" || transitionIn.type === "dissolve") opacity *= value
        if (transitionIn.type === "slide") positionX += (1 - value) * -2
        if (transitionIn.type === "zoom") scale *= 1.28 - value * 0.28
        if (transitionIn.type === "rotate") rotation += (1 - value) * -18
    }
    if (transitionOut?.type && transitionOut.type !== "none") {
        const remaining = Math.max(0, clipDuration - localTime)
        const raw = progress(remaining, transitionOut.duration)
        const value = transitionOut.type === "dissolve" ? smooth(raw) : raw
        if (transitionOut.type === "fade" || transitionOut.type === "dissolve") opacity *= value
        if (transitionOut.type === "slide") positionX += (1 - value) * 2
        if (transitionOut.type === "zoom") scale *= 1 + (1 - value) * 0.28
        if (transitionOut.type === "rotate") rotation += (1 - value) * 18
    }
    return { ...transform, opacity, positionX, scale, rotation }
}
