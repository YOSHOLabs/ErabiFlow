import { DEFAULT_CLIP_EFFECTS, type ClipVisualEffects } from "./types.ts"

export function getClipEffects(value?: Partial<ClipVisualEffects>): ClipVisualEffects {
    const amount = (key: keyof ClipVisualEffects) => Math.max(0, Math.min(100, Number(value?.[key] ?? 0)))
    return {
        blur: Math.max(0, Math.min(50, value?.blur ?? 0)),
        mosaic: Math.max(0, Math.min(50, value?.mosaic ?? 0)),
        motionBlur: amount("motionBlur"),
        sharpen: amount("sharpen"),
        noise: amount("noise"),
        vhs: amount("vhs"),
        film: amount("film"),
        glitch: amount("glitch"),
        rgbShift: amount("rgbShift"),
        glow: amount("glow"),
        lightLeak: amount("lightLeak"),
        lensFlare: amount("lensFlare"),
        rain: amount("rain"),
        snow: amount("snow"),
        fire: amount("fire"),
        particles: amount("particles"),
        shake: amount("shake"),
        warp: amount("warp"),
        chromaticAberration: amount("chromaticAberration"),
        chroma: { ...DEFAULT_CLIP_EFFECTS.chroma, ...(value?.chroma ?? {}) },
        mask: { ...DEFAULT_CLIP_EFFECTS.mask, ...(value?.mask ?? {}) },
    }
}

export function effectsToCanvasFilter(value?: Partial<ClipVisualEffects>): string {
    const effects = getClipEffects(value)
    const filters: string[] = []
    const blur = effects.blur * 0.45 + effects.motionBlur * 0.025 + effects.glow * 0.015
    if (blur > 0) filters.push(`blur(${blur.toFixed(1)}px)`)
    if (effects.sharpen > 0) filters.push(`contrast(${(100 + effects.sharpen * 0.35).toFixed(1)}%)`)
    if (effects.film > 0) filters.push(`sepia(${(effects.film * 0.28).toFixed(1)}%)`, `contrast(${(100 + effects.film * 0.12).toFixed(1)}%)`)
    if (effects.vhs > 0) filters.push(`saturate(${(100 + effects.vhs * 0.18).toFixed(1)}%)`, `hue-rotate(${(effects.vhs * 0.08).toFixed(1)}deg)`)
    if (effects.glow > 0) filters.push(`drop-shadow(0 0 ${(effects.glow * 0.12).toFixed(1)}px rgba(255,255,255,.65))`)
    return filters.join(" ") || "none"
}

export function applyCanvasMask(
    ctx: CanvasRenderingContext2D,
    value: Partial<ClipVisualEffects> | undefined,
    x: number,
    y: number,
    width: number,
    height: number,
) {
    const mask = getClipEffects(value).mask
    if (mask.shape === "none") return
    const cx = x + width * mask.x
    const cy = y + height * mask.y
    const mw = Math.max(1, width * mask.width)
    const mh = Math.max(1, height * mask.height)
    ctx.beginPath()
    if (mask.shape === "ellipse") ctx.ellipse(cx, cy, mw / 2, mh / 2, 0, 0, Math.PI * 2)
    else ctx.rect(cx - mw / 2, cy - mh / 2, mw, mh)
    ctx.clip()
}

const frameBuffers = new Map<string, HTMLCanvasElement>()
function getBuffer(width: number, height: number) {
    if (typeof document === "undefined") return null
    const safeWidth = Math.max(2, Math.round(width))
    const safeHeight = Math.max(2, Math.round(height))
    const key = `${safeWidth}x${safeHeight}`
    const existing = frameBuffers.get(key)
    if (existing) {
        // Map末尾へ移して簡易LRUにする。寸法代入による毎フレームの再確保は行わない。
        frameBuffers.delete(key)
        frameBuffers.set(key, existing)
        return existing
    }
    const buffer = document.createElement("canvas")
    buffer.width = safeWidth
    buffer.height = safeHeight
    frameBuffers.set(key, buffer)
    while (frameBuffers.size > 6) frameBuffers.delete(frameBuffers.keys().next().value!)
    return buffer
}

function parseHex(color: string) {
    const match = /^#?([0-9a-f]{6})$/i.exec(color)
    const value = Number.parseInt(match?.[1] ?? "00ff00", 16)
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const
}

/** モザイクとクロマキーを含むクリップ描画。Canvas制約下でも最終出力に近い確認ができる。 */
export function drawClipMedia(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    sourceRect: [number, number, number, number],
    destinationRect: [number, number, number, number],
    value?: Partial<ClipVisualEffects>,
    time = 0,
) {
    const effects = getClipEffects(value)
    const drawDecorations = () => drawProceduralEffects(ctx, destinationRect, effects, time)
    if (effects.mosaic <= 0 && !effects.chroma.enabled) {
        const shift = (effects.rgbShift + effects.chromaticAberration + effects.glitch) * 0.035
        if (shift > 0) {
            ctx.save(); ctx.globalAlpha *= 0.18; ctx.filter = "hue-rotate(120deg)"; ctx.drawImage(source, ...sourceRect, destinationRect[0] - shift, destinationRect[1], destinationRect[2], destinationRect[3]); ctx.restore()
            ctx.save(); ctx.globalAlpha *= 0.18; ctx.filter = "hue-rotate(-120deg)"; ctx.drawImage(source, ...sourceRect, destinationRect[0] + shift, destinationRect[1], destinationRect[2], destinationRect[3]); ctx.restore()
        }
        ctx.drawImage(source, ...sourceRect, ...destinationRect)
        drawDecorations()
        return
    }
    const [, , sw, sh] = sourceRect
    const [, , dw, dh] = destinationRect
    const pixel = effects.mosaic > 0 ? Math.max(2, effects.mosaic) : 1
    const maxWidth = effects.chroma.enabled ? 480 : Math.max(2, Math.abs(dw) / pixel)
    const bufferWidth = Math.max(2, Math.min(maxWidth, sw / pixel))
    const bufferHeight = Math.max(2, bufferWidth * sh / Math.max(1, sw))
    const buffer = getBuffer(bufferWidth, bufferHeight)
    const bufferCtx = buffer?.getContext("2d", { willReadFrequently: effects.chroma.enabled })
    if (!buffer || !bufferCtx) {
        ctx.drawImage(source, ...sourceRect, ...destinationRect)
        return
    }
    bufferCtx.clearRect(0, 0, buffer.width, buffer.height)
    bufferCtx.drawImage(source, ...sourceRect, 0, 0, buffer.width, buffer.height)
    if (effects.chroma.enabled) {
        const image = bufferCtx.getImageData(0, 0, buffer.width, buffer.height)
        const [kr, kg, kb] = parseHex(effects.chroma.color)
        const threshold = (effects.chroma.similarity / 100) * 442
        const feather = Math.max(1, (effects.chroma.blend / 100) * 120)
        for (let index = 0; index < image.data.length; index += 4) {
            const distance = Math.hypot(image.data[index] - kr, image.data[index + 1] - kg, image.data[index + 2] - kb)
            if (distance <= threshold) image.data[index + 3] = 0
            else if (distance < threshold + feather) image.data[index + 3] = Math.round(255 * (distance - threshold) / feather)
        }
        bufferCtx.putImageData(image, 0, 0)
    }
    ctx.imageSmoothingEnabled = effects.mosaic <= 0
    ctx.drawImage(buffer, ...destinationRect)
    drawDecorations()
}

function drawProceduralEffects(ctx: CanvasRenderingContext2D, rect: [number, number, number, number], effects: ClipVisualEffects, time: number) {
    const [x, y, width, height] = rect
    const strength = (value: number) => value / 100
    ctx.save()
    if (effects.vhs > 0) {
        ctx.fillStyle = `rgba(0,0,0,${0.18 * strength(effects.vhs)})`
        for (let line = y; line < y + height; line += 5) ctx.fillRect(x, line, width, 1)
    }
    if (effects.noise + effects.film > 0) {
        const count = Math.round(30 + (effects.noise + effects.film) * 1.2)
        ctx.fillStyle = `rgba(255,255,255,${0.08 + strength(effects.noise) * 0.08})`
        for (let i = 0; i < count; i++) {
            const px = x + ((i * 47.13 + time * 337) % Math.max(1, width))
            const py = y + ((i * 91.71 + time * 211) % Math.max(1, height))
            ctx.fillRect(px, py, 1.5, 1.5)
        }
    }
    if (effects.lightLeak > 0) {
        const gradient = ctx.createRadialGradient(x + width * 0.08, y + height * 0.2, 0, x + width * 0.08, y + height * 0.2, width * 0.8)
        gradient.addColorStop(0, `rgba(255,88,25,${0.55 * strength(effects.lightLeak)})`); gradient.addColorStop(1, "rgba(255,30,0,0)")
        ctx.fillStyle = gradient; ctx.fillRect(x, y, width, height)
    }
    if (effects.lensFlare > 0) {
        const gradient = ctx.createRadialGradient(x + width * 0.78, y + height * 0.18, 0, x + width * 0.78, y + height * 0.18, width * 0.35)
        gradient.addColorStop(0, `rgba(255,255,225,${0.7 * strength(effects.lensFlare)})`); gradient.addColorStop(0.15, `rgba(255,220,120,${0.25 * strength(effects.lensFlare)})`); gradient.addColorStop(1, "rgba(255,255,255,0)")
        ctx.fillStyle = gradient; ctx.fillRect(x, y, width, height)
    }
    const particles = Math.round((effects.rain + effects.snow + effects.fire + effects.particles) * 0.22)
    for (let i = 0; i < particles; i++) {
        const px = x + ((i * 73.7 + time * (effects.rain > 0 ? 170 : 35)) % Math.max(1, width))
        const py = y + ((i * 41.3 + time * (effects.fire > 0 ? -90 : 120) + height * 4) % Math.max(1, height))
        if (effects.rain > 0) { ctx.strokeStyle = `rgba(180,220,255,${0.55 * strength(effects.rain)})`; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - 5, py + 18); ctx.stroke() }
        else if (effects.fire > 0) { ctx.fillStyle = `rgba(255,${80 + i % 120},20,${0.6 * strength(effects.fire)})`; ctx.beginPath(); ctx.arc(px, py, 2 + i % 4, 0, Math.PI * 2); ctx.fill() }
        else { ctx.fillStyle = `rgba(255,255,255,${0.65 * strength(Math.max(effects.snow, effects.particles))})`; ctx.beginPath(); ctx.arc(px, py, 1 + i % 3, 0, Math.PI * 2); ctx.fill() }
    }
    ctx.restore()
}
