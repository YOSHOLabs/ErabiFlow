/**
 * AvatarLayer — アバター画像の描画
 */

import type { Layer, PreviewState, HitRegion } from "../types"

export class AvatarLayer implements Layer {
    name = "avatar"

    draw(ctx: CanvasRenderingContext2D, s: PreviewState): HitRegion | null {
        const { cw, ch, avatarImg, avatar } = s
        if (!avatarImg) return null

        const baseMaxH = ch * 0.38
        const baseMaxW = cw * 0.8
        const ia = avatarImg.width / avatarImg.height
        let dw: number, dh: number
        if (ia > baseMaxW / baseMaxH) { dw = baseMaxW; dh = baseMaxW / ia }
        else { dh = baseMaxH; dw = baseMaxH * ia }

        dw *= avatar.scale
        dh *= avatar.scale

        const ax = avatar.position.x * cw - dw / 2
        const ay = avatar.position.y * ch - dh / 2
        ctx.drawImage(avatarImg, ax, ay, dw, dh)

        return { key: "avatar", x: ax, y: ay, w: dw, h: dh }
    }
}
