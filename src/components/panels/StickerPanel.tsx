import { useState } from "react"
import { useDocumentStore } from "@/stores/document"
import { useEditorStore } from "@/stores/editor"
import { commands } from "@/tauri/commands"

type StickerKind = "emoji" | "illustration" | "decoration"
const STICKERS = {
    emoji: [["😂", "笑顔"], ["❤️", "ハート"], ["🔥", "炎"], ["✨", "きらめき"], ["👀", "注目"], ["👍", "いいね"], ["🎉", "お祝い"], ["🚀", "ロケット"]],
    illustration: [["arrow", "矢印"], ["burst", "集中線"], ["bubble", "吹き出し"], ["badge", "バッジ"]],
    decoration: [["sparkles", "キラキラ"], ["underline", "下線"], ["circle", "囲み"], ["frame", "フレーム"]],
} as const

export function renderStickerPng(kind: StickerKind, id: string): string {
    const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 512
    const ctx = canvas.getContext("2d")!; ctx.clearRect(0, 0, 512, 512); ctx.lineCap = "round"; ctx.lineJoin = "round"
    if (kind === "emoji") {
        ctx.font = '350px "Segoe UI Emoji"'; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(id, 256, 270)
    } else if (id === "arrow") {
        ctx.strokeStyle = "#22D3EE"; ctx.lineWidth = 58; ctx.beginPath(); ctx.moveTo(70, 330); ctx.quadraticCurveTo(230, 130, 415, 215); ctx.stroke(); ctx.fillStyle = "#22D3EE"; ctx.beginPath(); ctx.moveTo(390, 115); ctx.lineTo(475, 230); ctx.lineTo(335, 255); ctx.closePath(); ctx.fill()
    } else if (id === "burst") {
        ctx.strokeStyle = "#FDE047"; ctx.lineWidth = 18; for (let i = 0; i < 18; i++) { const a = i * Math.PI / 9; ctx.beginPath(); ctx.moveTo(256 + Math.cos(a) * 110, 256 + Math.sin(a) * 110); ctx.lineTo(256 + Math.cos(a) * 235, 256 + Math.sin(a) * 235); ctx.stroke() }
    } else if (id === "bubble") {
        ctx.fillStyle = "white"; ctx.strokeStyle = "#18181B"; ctx.lineWidth = 18; ctx.beginPath(); ctx.roundRect(55, 90, 402, 285, 70); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(155, 360); ctx.lineTo(115, 460); ctx.lineTo(240, 365); ctx.fill(); ctx.stroke()
    } else if (id === "badge") {
        ctx.fillStyle = "#FB7185"; ctx.strokeStyle = "white"; ctx.lineWidth = 18; ctx.beginPath(); for (let i = 0; i < 20; i++) { const a = i * Math.PI / 10 - Math.PI / 2; const r = i % 2 ? 170 : 235; ctx.lineTo(256 + Math.cos(a) * r, 256 + Math.sin(a) * r) } ctx.closePath(); ctx.fill(); ctx.stroke()
    } else if (id === "sparkles") {
        ctx.fillStyle = "#FDE047"; [[125,145,80],[335,115,55],[285,330,100],[430,310,45]].forEach(([cx,cy,r]) => { ctx.beginPath(); for(let i=0;i<8;i++){const a=i*Math.PI/4-Math.PI/2; const rr=i%2?r/3:r; ctx.lineTo(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr)} ctx.closePath();ctx.fill() })
    } else if (id === "underline") {
        ctx.strokeStyle = "#F43F5E"; ctx.lineWidth = 42; ctx.beginPath(); ctx.moveTo(55, 290); ctx.bezierCurveTo(170, 245, 290, 325, 460, 260); ctx.stroke()
    } else if (id === "circle") {
        ctx.strokeStyle = "#F43F5E"; ctx.lineWidth = 35; ctx.beginPath(); ctx.ellipse(256, 256, 205, 150, -0.12, 0, Math.PI * 2); ctx.stroke()
    } else {
        ctx.strokeStyle = "#A78BFA"; ctx.lineWidth = 28; ctx.strokeRect(35, 35, 442, 442); ctx.strokeStyle = "#22D3EE"; ctx.lineWidth = 8; ctx.strokeRect(60, 60, 392, 392)
    }
    return canvas.toDataURL("image/png")
}

export function StickerPanel() {
    const [kind, setKind] = useState<StickerKind>("emoji")
    const [message, setMessage] = useState("")
    const addImage = useDocumentStore((state) => state.addImage)
    const addMediaAssets = useDocumentStore((state) => state.addMediaAssets)
    const previewTime = useEditorStore((state) => state.previewTime)
    const duration = useDocumentStore((state) => state.videoInfo?.duration ?? 10)
    const add = async (id: string, label: string) => {
        try {
            const path = await commands.saveGeneratedSticker({ pngBase64: renderStickerPng(kind, id) })
            addMediaAssets([{ id: globalThis.crypto?.randomUUID?.() ?? `sticker-asset-${Date.now()}`, kind: "image", path, name: label, folderId: null, favorite: false, addedAt: new Date().toISOString(), width: 512, height: 512 }])
            addImage({ id: globalThis.crypto?.randomUUID?.() ?? `sticker-${Date.now()}`, path, label, position: { x: 0.5, y: 0.5 }, scale: kind === "emoji" ? 0.22 : 0.35, startTime: previewTime, endTime: Math.min(duration, previewTime + 3) })
            setMessage(`${label}を追加しました。プレビューで移動できます。`)
        } catch (error) { setMessage(`追加できませんでした: ${String(error)}`) }
    }
    return <section className="space-y-3 border-t border-white/[0.07] pt-4">
        <div><h3 className="text-[10px] font-semibold text-zinc-300">ステッカー・絵文字</h3><p className="mt-1 text-[9px] text-zinc-600">透明PNGとして保存され、書き出しにも反映されます。</p></div>
        <div className="grid grid-cols-3 gap-1">{([['emoji','絵文字'],['illustration','イラスト'],['decoration','デコ'] ] as const).map(([id,label]) => <button key={id} type="button" onClick={() => setKind(id)} className={`rounded border py-1.5 text-[9px] ${kind === id ? 'border-cyan-300/25 text-cyan-100' : 'border-white/[0.07] text-zinc-500'}`}>{label}</button>)}</div>
        <div className="grid grid-cols-4 gap-1.5">{STICKERS[kind].map(([id,label]) => <button key={id} type="button" title={label} onClick={() => void add(id,label)} className="min-h-11 rounded-lg border border-white/[0.07] bg-black/20 px-1 text-[9px] text-zinc-300 hover:border-cyan-300/25">{kind === 'emoji' ? <span className="text-xl">{id}</span> : label}</button>)}</div>
        {message && <p className="text-[9px] text-zinc-500">{message}</p>}
    </section>
}
