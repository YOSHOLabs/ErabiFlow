/**
 * ImageLayer — 画像オーバーレイの描画
 *
 * 複数画像をサポートし、時間範囲に応じて表示/非表示を切り替える。
 */

import type { Layer, PreviewState, HitRegion } from "../types"

export class ImageLayer implements Layer {
    name = "image"

    /** ロード済画像のキャッシュ (path -> HTMLImageElement) */
    private imageCache: Map<string, HTMLImageElement> = new Map()
    /** ロード中のパス */
    private loadingPaths: Set<string> = new Set()
    /** 描画後に再描画を要求するコールバック */
    private redrawCb: (() => void) | null = null

    setRedrawCallback(cb: () => void) {
        this.redrawCb = cb
    }

    private loadImage(path: string) {
        if (this.imageCache.has(path) || this.loadingPaths.has(path)) return
        this.loadingPaths.add(path)
        const img = new Image()
        img.crossOrigin = "anonymous"
        // vfocus:// プロトコルを使って読み込む。
        // Layer層では安全に変換された URL を PreviewState から受け取る。
        img.src = path
        img.onload = () => {
            this.imageCache.set(path, img)
            this.loadingPaths.delete(path)
            this.redrawCb?.()
        }
        img.onerror = () => {
            this.loadingPaths.delete(path)
        }
    }

    draw(ctx: CanvasRenderingContext2D, s: PreviewState): HitRegion[] | null {
        const { cw, ch, overlayImages, previewTime } = s
        if (!overlayImages || overlayImages.length === 0) return null

        const hits: HitRegion[] = []

        for (const img of overlayImages) {
            // 時間範囲チェック
            if (previewTime < img.startTime || previewTime > img.endTime) continue

            // 画像URL → ロード
            const src = img.resolvedSrc
            if (!src) continue

            const cachedImg = this.imageCache.get(src)
            if (!cachedImg) {
                this.loadImage(src)
                continue
            }

            // 描画サイズ計算
            const maxDim = cw * img.scale
            const aspect = cachedImg.width / cachedImg.height
            let dw: number, dh: number
            if (aspect > 1) {
                dw = maxDim
                dh = maxDim / aspect
            } else {
                dh = maxDim
                dw = maxDim * aspect
            }

            const dx = img.position.x * cw - dw / 2
            const dy = img.position.y * ch - dh / 2

            ctx.drawImage(cachedImg, dx, dy, dw, dh)

            hits.push({ key: `image_${img.id}`, x: dx, y: dy, w: dw, h: dh })
        }

        return hits.length > 0 ? hits : null
    }
}
