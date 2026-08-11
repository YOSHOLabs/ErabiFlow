/**
 * RenderEngine — レイヤーベースの描画エンジン
 *
 * 登録されたレイヤーを順番に描画し、ヒットリージョンを管理する。
 */

import type { Layer, PreviewState, HitRegion } from "../types"
import { GuideLayer } from "../layers/GuideLayer"

export class RenderEngine {
    private layers: Layer[] = []
    private guideLayer: GuideLayer
    private hitRegions: Map<string, HitRegion> = new Map()

    constructor(layers: Layer[], guideLayer: GuideLayer) {
        this.layers = layers
        this.guideLayer = guideLayer
    }

    /** 全レイヤーを順番に描画する */
    draw(ctx: CanvasRenderingContext2D, state: PreviewState) {
        ctx.clearRect(0, 0, state.cw, state.ch)
        this.hitRegions.clear()

        // メインレイヤー描画
        for (const layer of this.layers) {
            const regionOrRegions = layer.draw(ctx, state)
            if (regionOrRegions) {
                if (Array.isArray(regionOrRegions)) {
                    for (const region of regionOrRegions) {
                        this.hitRegions.set(region.key, region)
                    }
                } else {
                    this.hitRegions.set(regionOrRegions.key, regionOrRegions)
                }
            }
        }

        // ガイドレイヤー描画（最前面）
        this.guideLayer.setRegions(this.hitRegions)
        this.guideLayer.draw(ctx, state)
    }

    /** ヒットテスト: 指定ピクセル座標にどのリージョンがあるか */
    hitTest(px: number, py: number, pad = 12): string | null {
        // レイヤー配列の逆順でテスト（前面優先）
        const keys = Array.from(this.hitRegions.keys()).reverse()
        for (const key of keys) {
            const r = this.hitRegions.get(key)!
            if (
                px >= r.x - pad &&
                px <= r.x + r.w + pad &&
                py >= r.y - pad &&
                py <= r.y + r.h + pad
            ) {
                return key
            }
        }
        return null
    }

    /** 特定キーのリージョンを取得 */
    getRegion(key: string): HitRegion | null {
        return this.hitRegions.get(key) ?? null
    }
}
