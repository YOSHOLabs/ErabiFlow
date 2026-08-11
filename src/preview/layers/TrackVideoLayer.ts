import type { HitRegion, Layer, PreviewState } from "../types"
import { evaluateClipAnimation } from "@/lib/keyframes"
import { applyClipTransitions } from "@/lib/transitions"
import { colorToCanvasFilter } from "@/lib/color"
import { applyCanvasMask, drawClipMedia, effectsToCanvasFilter, getClipEffects } from "@/lib/effects"
import { applyMotionPreset } from "@/lib/motionPresets"

export class TrackVideoLayer implements Layer {
    name = "track-video"

    draw(ctx: CanvasRenderingContext2D, state: PreviewState): HitRegion[] {
        const regions: HitRegion[] = []
        const ordered = [...state.trackVideos].sort((a, b) => a.trackOrder - b.trackOrder)
        for (const { clip, element } of ordered) {
            if (element.readyState < 2 || element.videoWidth <= 0 || element.videoHeight <= 0) continue
            const animatedTransform = evaluateClipAnimation(
                clip.keyframes,
                clip.transform,
                clip.volume,
                state.previewTime - clip.timelineStart,
            ).transform
            const transitionedTransform = applyClipTransitions(
                animatedTransform,
                clip.transitionIn,
                clip.transitionOut,
                state.previewTime - clip.timelineStart,
                clip.timelineEnd - clip.timelineStart,
            )
            const transform = applyMotionPreset(transitionedTransform, clip.motionPreset, state.previewTime - clip.timelineStart)
            const fit = Math.min(state.cw / element.videoWidth, state.ch / element.videoHeight)
            const width = element.videoWidth * fit * transform.scale
            const height = element.videoHeight * fit * transform.scale
            const centerX = state.cw / 2 + transform.positionX * state.cw / 2
            const centerY = state.ch / 2 + transform.positionY * state.ch / 2

            ctx.save()
            const colorFilter = colorToCanvasFilter(clip.color)
            const effectFilter = effectsToCanvasFilter(clip.effects)
            ctx.filter = effectFilter === "none" ? colorFilter : `${colorFilter} ${effectFilter}`
            ctx.beginPath()
            ctx.rect(0, 0, state.cw, state.ch)
            ctx.clip()
            ctx.globalAlpha = transform.opacity
            ctx.translate(centerX, centerY)
            const liveEffects = getClipEffects(clip.effects)
            const localTime = state.previewTime - clip.timelineStart
            const shake = liveEffects.shake / 100
            ctx.translate(Math.sin(localTime * 37) * 8 * shake, Math.cos(localTime * 29) * 6 * shake)
            const warpScale = 1 + Math.sin(localTime * 2.2) * liveEffects.warp / 2500
            ctx.scale(warpScale, 1 / warpScale)
            ctx.rotate(transform.rotation * Math.PI / 180)
            ctx.scale(transform.flipHorizontal ? -1 : 1, transform.flipVertical ? -1 : 1)
            applyCanvasMask(ctx, clip.effects, -width / 2, -height / 2, width, height)
            drawClipMedia(ctx, element, [0, 0, element.videoWidth, element.videoHeight], [-width / 2, -height / 2, width, height], clip.effects, localTime)
            ctx.restore()

            regions.push({ key: `trackClip_${clip.id}`, x: centerX - width / 2, y: centerY - height / 2, w: width, h: height })
        }
        return regions
    }
}
