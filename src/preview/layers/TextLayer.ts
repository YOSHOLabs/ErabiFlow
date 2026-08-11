/**
 * TextLayer — 固定テキスト + 動的字幕の描画
 */

import type { Layer, PreviewState, HitRegion } from "../types"
import { findActiveSubtitle } from "@/lib/subtitleTiming"
import { activeCaptionRange } from "@/lib/captionEmphasis"
import { resolveSubtitleStyle } from "@/lib/subtitleStyle"

export class TextLayer implements Layer {
    name = "text"

    draw(ctx: CanvasRenderingContext2D, s: PreviewState): HitRegion | null {
        const { cw, ch, text, subtitleStyle, subtitles } = s
        let hitRegion: HitRegion | null = null

        // 固定テキスト
        const titleStart = Number.isFinite(text.startTime) ? text.startTime : 0
        const titleEnd = text.endTime == null ? Number.POSITIVE_INFINITY : text.endTime
        if (text.content && s.previewTime >= titleStart && s.previewTime < titleEnd) {
            const fontSize = Math.round((text.size / 1080) * cw)
            const tx = text.position.x * cw
            const ty = text.position.y * ch

            const layout = this.drawAdvancedText(
                ctx, cw, text.content, tx, ty,
                text.color, text.strokeColor, text.strokeWidth,
                text.shadowColor, text.shadowBlur,
                fontSize, text.font, text.letterSpacing, text.lineHeight,
                cw * 0.9, ch,
            )

            hitRegion = { key: "text", x: tx - layout.width / 2, y: layout.y - layout.height / 2, w: layout.width, h: layout.height }
        }

        // 動的字幕 (カット編集に追従するため、Media Timeをベースに判定)
        const currentSub = findActiveSubtitle(subtitles, s.mediaTime)
        if (currentSub) {
            const currentStyle = resolveSubtitleStyle(subtitleStyle, currentSub)
            const fontSize = Math.round((currentStyle.size / 1080) * cw)
            const emphasis = currentStyle.emphasisMode === "karaoke"
                ? activeCaptionRange(
                    currentSub.text,
                    (s.mediaTime - currentSub.start) / Math.max(0.01, currentSub.end - currentSub.start),
                )
                : null
            const layout = this.drawAdvancedText(
                ctx, cw, currentSub.text, cw / 2, ch * currentStyle.positionY,
                currentStyle.color, currentStyle.strokeColor, currentStyle.strokeWidth,
                currentStyle.shadowColor, currentStyle.shadowBlur,
                fontSize, currentStyle.font, currentStyle.letterSpacing, 1.35,
                cw * 0.86, ch,
                emphasis ? { ...emphasis, color: currentStyle.emphasisColor } : undefined,
            )

            hitRegion = hitRegion || {
                key: "subtitle",
                x: (cw / 2) - (layout.width / 2),
                y: layout.y - (layout.height / 2),
                w: layout.width,
                h: layout.height,
            }
        }

        // 任意透かしは最前面へ常時表示する。投稿UIを避けやすい4隅固定で、
        // CanvasとFFmpegの配置差を小さくする。
        if (s.watermark.enabled && s.watermark.text.trim()) {
            const fontSize = Math.max(8, Math.round((s.watermark.size / 1080) * cw))
            const margin = Math.max(8, Math.round(cw * 0.035))
            const right = s.watermark.position.endsWith("right")
            const bottom = s.watermark.position.startsWith("bottom")
            ctx.save()
            const cleanFont = s.watermark.font.replace(/['"]/g, "")
            ctx.font = `normal ${fontSize}px '${cleanFont}'`
            ctx.textAlign = right ? "right" : "left"
            ctx.textBaseline = bottom ? "bottom" : "top"
            ctx.globalAlpha = Math.max(0.05, Math.min(1, s.watermark.opacity))
            ctx.lineJoin = "round"
            ctx.lineWidth = Math.max(1, fontSize * 0.08)
            ctx.strokeStyle = "rgba(0,0,0,0.72)"
            ctx.fillStyle = s.watermark.color
            const x = right ? cw - margin : margin
            const y = bottom ? ch - margin : margin
            ctx.strokeText(s.watermark.text.trim(), x, y)
            ctx.fillText(s.watermark.text.trim(), x, y)
            ctx.restore()
        }

        return hitRegion
    }

    private drawAdvancedText(
        ctx: CanvasRenderingContext2D,
        cw: number,
        content: string,
        tx: number, ty: number,
        color: string,
        strokeColor: string, strokeWidth: number,
        shadowColor: string, shadowBlur: number,
        fontSize: number, font: string,
        letterSpacing: number,
        lineHeightMultiplier: number = 1.4,
        maxWidth: number = cw * 0.9,
        canvasHeight: number = Number.POSITIVE_INFINITY,
        emphasis?: { start: number; end: number; color: string },
    ): { width: number; height: number; y: number } {
        ctx.save()
        // フォント名のクォートを統一（スペースや数字始まりの名前でctx.fontが無効化されるのを防ぐ）
        const cleanFont = font.replace(/['"]/g, '')
        // 選択された実フォントファイルをFontFaceとして読み込んでいるため、
        // ブラウザ側だけの合成boldは使わない（FFmpegとの字形差を防ぐ）。
        ctx.font = `normal ${fontSize}px '${cleanFont}'`
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        Object.assign(ctx, { letterSpacing: `${letterSpacing}px` })

        const lines = this.wrapLines(ctx, content, maxWidth)
        const actualLineHeight = fontSize * lineHeightMultiplier
        const blockHeight = Math.max(actualLineHeight, actualLineHeight * lines.length)
        const safeY = Number.isFinite(canvasHeight)
            ? Math.max(blockHeight / 2 + 12, Math.min(canvasHeight - blockHeight / 2 - 12, ty))
            : ty
        const startY = safeY - (actualLineHeight * (lines.length - 1)) / 2

        if (shadowBlur > 0) {
            ctx.shadowColor = shadowColor
            // FFmpegのdrawtext影（shadowx, shadowy）と見た目を一致させるため、ぼかしを0にして単色オフセットにする
            ctx.shadowBlur = 0
            ctx.shadowOffsetX = (shadowBlur / 1080) * cw
            ctx.shadowOffsetY = (shadowBlur / 1080) * cw
        }

        if (strokeWidth > 0) {
            ctx.strokeStyle = strokeColor
            ctx.lineWidth = (strokeWidth / 1080) * cw * 2
            ctx.lineJoin = "round"
            ctx.miterLimit = 2
            for (let i = 0; i < lines.length; i++) {
                ctx.strokeText(lines[i], tx, startY + i * actualLineHeight)
            }
            // 枠線を描画した後は影を無効化（塗りに影が重複しないようにする）
            ctx.shadowColor = "transparent"
            ctx.shadowBlur = 0
        }

        ctx.fillStyle = color
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], tx, startY + i * actualLineHeight)
        }

        if (emphasis) {
            let searchFrom = 0
            ctx.textAlign = "left"
            ctx.fillStyle = emphasis.color
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i]
                const lineStart = content.indexOf(line, searchFrom)
                if (lineStart < 0) continue
                const lineEnd = lineStart + line.length
                const start = Math.max(lineStart, emphasis.start)
                const end = Math.min(lineEnd, emphasis.end)
                if (start < end) {
                    const prefix = content.slice(lineStart, start)
                    const fragment = content.slice(start, end)
                    const left = tx - ctx.measureText(line).width / 2
                    ctx.fillText(fragment, left + ctx.measureText(prefix).width, startY + i * actualLineHeight)
                }
                searchFrom = lineEnd
            }
            ctx.textAlign = "center"
        }

        const blockWidth = Math.max(1, ...lines.map((line) => ctx.measureText(line).width))
        ctx.restore()
        return {
            width: blockWidth,
            height: blockHeight,
            y: safeY,
        }
    }

    private wrapLines(ctx: CanvasRenderingContext2D, content: string, maxWidth: number): string[] {
        const result: string[] = []
        for (const paragraph of content.split('\n')) {
            const characters = Array.from(paragraph)
            if (characters.length === 0) {
                result.push("")
                continue
            }

            let line = ""
            for (const character of characters) {
                const candidate = line + character
                if (line && ctx.measureText(candidate).width > maxWidth) {
                    result.push(line.trim())
                    line = character.trimStart()
                } else {
                    line = candidate
                }
            }
            if (line) result.push(line.trim())
        }
        return result.length > 0 ? result : [""]
    }
}
