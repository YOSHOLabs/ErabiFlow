/**
 * VideoLayer — 背景ブラー + ゲーム映像描画
 */

import type { Layer, PreviewState, HitRegion } from "../types"
import { getTimelineClipTransform } from "@/lib/timeline"
import { DEFAULT_TIMELINE_CLIP_TRANSFORM } from "@/lib/types"
import { evaluateClipAnimation } from "@/lib/keyframes"
import { applyClipTransitions } from "@/lib/transitions"
import { getTimelineClipDuration } from "@/lib/timeline"
import { colorToCanvasFilter } from "@/lib/color"
import { applyCanvasMask, drawClipMedia, effectsToCanvasFilter } from "@/lib/effects"
import { getClipEffects } from "@/lib/effects"
import { applyMotionPreset } from "@/lib/motionPresets"

export class VideoLayer implements Layer {
    name = "video"
    private backgroundBuffer: HTMLCanvasElement | null = null

    private getBackgroundBuffer(width: number, height: number) {
        if (typeof document === "undefined") return null
        const bufferWidth = Math.max(2, Math.round(width / 4))
        const bufferHeight = Math.max(2, Math.round(height / 4))
        if (!this.backgroundBuffer) this.backgroundBuffer = document.createElement("canvas")
        if (this.backgroundBuffer.width !== bufferWidth) this.backgroundBuffer.width = bufferWidth
        if (this.backgroundBuffer.height !== bufferHeight) this.backgroundBuffer.height = bufferHeight
        return this.backgroundBuffer
    }

    draw(ctx: CanvasRenderingContext2D, s: PreviewState): HitRegion | null {
        const { cw, ch, video, hasVideo, game } = s

        const sourceLayout = game.layoutMode === "source"
        const stageLayout = game.layoutMode === "stage"

        // 1. 背景。上下余白レイアウトはゲーム実況のHUDを邪魔しない黒背景にする。
        if (sourceLayout || stageLayout) {
            ctx.fillStyle = "#000000"
            ctx.fillRect(0, 0, cw, ch)
        } else if (video && video.videoWidth > 0) {
            const vw = video.videoWidth
            const vh = video.videoHeight
            const buffer = this.getBackgroundBuffer(cw, ch)
            const bufferCtx = buffer?.getContext("2d") ?? null
            const targetWidth = buffer?.width ?? cw
            const targetHeight = buffer?.height ?? ch
            const bgScale = Math.max(targetWidth / vw, targetHeight / vh)
            const bgW = vw * bgScale
            const bgH = vh * bgScale
            if (buffer && bufferCtx) {
                bufferCtx.clearRect(0, 0, targetWidth, targetHeight)
                bufferCtx.save()
                bufferCtx.filter = "blur(3px) brightness(0.55)"
                bufferCtx.drawImage(video, (targetWidth - bgW) / 2, (targetHeight - bgH) / 2, bgW, bgH)
                bufferCtx.restore()
                bufferCtx.fillStyle = "rgba(0,0,0,0.42)"
                bufferCtx.fillRect(0, 0, targetWidth, targetHeight)

                ctx.save()
                ctx.imageSmoothingEnabled = true
                ctx.imageSmoothingQuality = "high"
                ctx.drawImage(buffer, 0, 0, cw, ch)
                ctx.restore()
            } else {
                ctx.save()
                ctx.globalAlpha = 0.35
                ctx.drawImage(video, (cw - bgW) / 2, (ch - bgH) / 2, bgW, bgH)
                ctx.restore()
            }
        } else {
            const grad = ctx.createLinearGradient(0, 0, 0, ch)
            grad.addColorStop(0, "#1a1025")
            grad.addColorStop(0.5, "#0d0d1a")
            grad.addColorStop(1, "#1a1025")
            ctx.fillStyle = grad
            ctx.fillRect(0, 0, cw, ch)
        }

        // 2. ゲーム映像
        const portraitLayout = game.layoutMode === "portrait"
        const gameH = sourceLayout || portraitLayout ? ch : stageLayout ? Math.round(ch * 0.75) : Math.round(cw * (9 / 16))
        const gameY = sourceLayout || portraitLayout ? 0 : Math.round(game.positionY * ch - gameH / 2)

        if (video && video.videoWidth > 0) {
            const vw = video.videoWidth
            const vh = video.videoHeight
            const srcAspect = vw / vh
            const tgt = sourceLayout ? cw / ch : portraitLayout ? 9 / 16 : stageLayout ? 3 / 4 : 16 / 9
            let sx = 0, sy = 0, sw = vw, sh = vh
            if (srcAspect > tgt) { sw = Math.round(vh * tgt); sx = Math.round((vw - sw) / 2) }
            else { sh = Math.round(vw / tgt); sy = Math.round((vh - sh) / 2) }
            const baseTransform = s.activeClip
                ? getTimelineClipTransform(s.activeClip)
                : DEFAULT_TIMELINE_CLIP_TRANSFORM
            const animatedTransform = s.activeClip
                ? evaluateClipAnimation(s.activeClip.keyframes, baseTransform, s.activeClip.volume ?? 1, s.activeClipLocalTime).transform
                : baseTransform
            const transitionedTransform = s.activeClip
                ? applyClipTransitions(animatedTransform, s.activeClip.transitionIn, s.activeClip.transitionOut, s.activeClipLocalTime, getTimelineClipDuration(s.activeClip))
                : animatedTransform
            const transform = applyMotionPreset(transitionedTransform, s.activeClip?.motionPreset, s.activeClipLocalTime)
            const zoom = Math.max(1, (game.scale ?? 1) * transform.scale)
            const zoomedW = sw / zoom
            const zoomedH = sh / zoom
            sx += (sw - zoomedW) * ((transform.positionX + 1) / 2)
            sy += (sh - zoomedH) * ((transform.positionY + 1) / 2)
            sw = zoomedW
            sh = zoomedH

            ctx.save()
            const colorFilter = colorToCanvasFilter(s.activeClip?.color)
            const effectFilter = effectsToCanvasFilter(s.activeClip?.effects)
            ctx.filter = effectFilter === "none" ? colorFilter : `${colorFilter} ${effectFilter}`
            ctx.beginPath()
            ctx.rect(0, gameY, cw, gameH)
            ctx.clip()
            ctx.globalAlpha = transform.opacity
            ctx.translate(cw / 2, gameY + gameH / 2)
            const liveEffects = getClipEffects(s.activeClip?.effects)
            const shake = liveEffects.shake / 100
            ctx.translate(Math.sin(s.previewTime * 37) * 8 * shake, Math.cos(s.previewTime * 29) * 6 * shake)
            const warpScale = 1 + Math.sin(s.previewTime * 2.2) * liveEffects.warp / 2500
            ctx.scale(warpScale, 1 / warpScale)
            ctx.rotate((transform.rotation * Math.PI) / 180)
            ctx.scale(transform.flipHorizontal ? -1 : 1, transform.flipVertical ? -1 : 1)
            applyCanvasMask(ctx, s.activeClip?.effects, -cw / 2, -gameH / 2, cw, gameH)
            drawClipMedia(ctx, video, [sx, sy, sw, sh], [-cw / 2, -gameH / 2, cw, gameH], s.activeClip?.effects, s.activeClipLocalTime)
            ctx.restore()
        } else {
            ctx.fillStyle = "rgba(255,255,255,0.03)"
            ctx.fillRect(0, gameY, cw, gameH)
            ctx.strokeStyle = "rgba(255,255,255,0.08)"
            ctx.lineWidth = 1
            ctx.setLineDash([8, 4])
            ctx.strokeRect(4, gameY + 4, cw - 8, gameH - 8)
            ctx.setLineDash([])
        }

        // 帯レイアウトだけ境界を表示する。全面クロップではキャンバス端と重なる。
        if (!sourceLayout && !portraitLayout) {
            ctx.strokeStyle = "rgba(255,255,255,0.06)"
            ctx.lineWidth = 1
            ctx.strokeRect(0, gameY, cw, gameH)
        }

        return { key: "game", x: 0, y: gameY, w: cw, h: gameH }
    }
}
