/**
 * GuideLayer — ドラッグ/ホバー時のハイライト表示
 */

import type { Layer, PreviewState, HitRegion } from "../types"

interface HighlightConfig {
    key: string
    color: string
    label?: string
    isDynamic?: boolean
}

const HIGHLIGHTS: HighlightConfig[] = [
    { key: "game", color: "rgba(59,130,246,0.8)", label: "ドラッグで移動" },
    { key: "text", color: "rgba(147,51,234,0.9)" },
    { key: "avatar", color: "rgba(34,197,94,0.9)" },
    { key: "image_", color: "rgba(6,182,212,0.9)", isDynamic: true },
]

export class GuideLayer implements Layer {
    name = "guide"

    /** 外部から現在のヒットリージョンをセット */
    private regions: Map<string, HitRegion> = new Map()

    setRegions(regions: Map<string, HitRegion>) {
        this.regions = regions
    }

    draw(ctx: CanvasRenderingContext2D, s: PreviewState): HitRegion | null {
        const { hoveredTarget, dragTarget } = s

        if (s.safeZone) {
            const { cw, ch } = s
            const x = s.safeZone.left * cw
            const y = s.safeZone.top * ch
            const w = cw - x - s.safeZone.right * cw
            const h = ch - y - s.safeZone.bottom * ch

            ctx.save()
            ctx.fillStyle = "rgba(4, 8, 14, 0.34)"
            ctx.fillRect(0, 0, cw, y)
            ctx.fillRect(0, y + h, cw, ch - y - h)
            ctx.fillRect(0, y, x, h)
            ctx.fillRect(x + w, y, cw - x - w, h)
            ctx.strokeStyle = "rgba(34, 211, 238, 0.72)"
            ctx.lineWidth = 1
            ctx.setLineDash([6, 4])
            ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
            ctx.setLineDash([])
            ctx.fillStyle = "rgba(34, 211, 238, 0.9)"
            ctx.font = "10px sans-serif"
            ctx.textAlign = "left"
            ctx.textBaseline = "bottom"
            ctx.fillText(`${s.safeZone.label}UI回避ガイド（公式固定値ではありません）`, x + 6, y - 5)
            ctx.restore()
        }

        for (const cfg of HIGHLIGHTS) {
            const targetKey = hoveredTarget || dragTarget
            if (!targetKey) continue

            // 動的キー(image_xxx)の場合はプレフィックスマッチ
            const matches = cfg.isDynamic
                ? targetKey.startsWith(cfg.key)
                : targetKey === cfg.key

            if (!matches) continue

            // 動的キーの場合は実際のキーでリージョンを検索
            const regionKey = cfg.isDynamic ? targetKey : cfg.key
            if (hoveredTarget !== regionKey && dragTarget !== regionKey) continue

            const region = this.regions.get(regionKey)
            if (!region) continue

            ctx.save()
            ctx.strokeStyle = cfg.color
            ctx.lineWidth = 2
            ctx.setLineDash([5, 3])

            if (cfg.key === "game") {
                ctx.strokeRect(2, region.y + 2, region.w - 4, region.h - 4)
                ctx.setLineDash([])
                if (cfg.label) {
                    ctx.fillStyle = cfg.color
                    ctx.font = "11px sans-serif"
                    ctx.textAlign = "left"
                    ctx.textBaseline = "top"
                    ctx.fillText(cfg.label, 8, region.y + 6)
                }
            } else {
                const pad = cfg.key === "avatar" ? 4 : 8
                ctx.strokeRect(
                    region.x - pad, region.y - pad + 2,
                    region.w + pad * 2, region.h + pad * 2 - 4
                )
            }

            ctx.setLineDash([])
            ctx.restore()
        }

        return null
    }
}
