import { useRef, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { InteractiveSegmenter, FilesetResolver } from "@mediapipe/tasks-vision"
import { useDocumentStore } from "@/stores/document"
import { useEditorStore } from "@/stores/editor"
import { commands } from "@/tauri/commands"

type CutoutMode = "background" | "person" | "object"
let segmenterPromise: Promise<InteractiveSegmenter> | null = null

async function getSegmenter() {
    if (!segmenterPromise) {
        segmenterPromise = FilesetResolver.forVisionTasks("/mediapipe-wasm").then(async (vision) => {
            const options = (delegate: "GPU" | "CPU") => ({
                baseOptions: { modelAssetPath: "/mediapipe-wasm/magic_touch.tflite", delegate },
                runningMode: "IMAGE" as const,
                outputCategoryMask: true,
                outputConfidenceMasks: false,
            })
            try {
                return await InteractiveSegmenter.createFromOptions(vision, options("GPU"))
            } catch (gpuError) {
                try {
                    return await InteractiveSegmenter.createFromOptions(vision, options("CPU"))
                } catch (cpuError) {
                    throw new Error(`GPU初期化失敗: ${String(gpuError)} / CPU初期化失敗: ${String(cpuError)}`)
                }
            }
        }).catch((error) => { segmenterPromise = null; throw error })
    }
    return segmenterPromise
}

function canvasToPngDataUrl(canvas: HTMLCanvasElement): Promise<string> {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => {
        if (!blob) { reject(new Error("PNGを生成できませんでした")); return }
        const reader = new FileReader()
        reader.onerror = () => reject(new Error("PNGを読み取れませんでした"))
        reader.onload = () => resolve(String(reader.result ?? ""))
        reader.readAsDataURL(blob)
    }, "image/png"))
}

function mediaUrl(path: string) {
    const protocol = /Windows/i.test(navigator.userAgent) ? "http://vfocus.localhost" : "vfocus://"
    return `${protocol}/media/${encodeURIComponent(path)}`
}

export function AiCutoutPanel() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const sourceReadyRef = useRef(false)
    const selectionGenerationRef = useRef(0)
    const [sourceName, setSourceName] = useState("")
    const [point, setPoint] = useState({ x: 0.5, y: 0.5 })
    const [mode, setMode] = useState<CutoutMode>("background")
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState("")
    const addImage = useDocumentStore((state) => state.addImage)
    const addMediaAssets = useDocumentStore((state) => state.addMediaAssets)
    const previewTime = useEditorStore((state) => state.previewTime)
    const duration = useDocumentStore((state) => state.videoInfo?.duration ?? 10)

    const selectSource = async () => {
        if (busy) return
        const generation = ++selectionGenerationRef.current
        sourceReadyRef.current = false
        setSourceName("")
        setMessage("画像を読み込んでいます…")
        const previousCanvas = canvasRef.current
        if (previousCanvas) { previousCanvas.width = 1; previousCanvas.height = 1; previousCanvas.getContext("2d")?.clearRect(0, 0, 1, 1) }
        const selected = await open({ multiple: false, filters: [{ name: "画像", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }] })
        if (generation !== selectionGenerationRef.current) return
        if (typeof selected !== "string") { setMessage(""); return }
        const image = new Image(); image.crossOrigin = "anonymous"
        image.onload = () => {
            if (generation !== selectionGenerationRef.current) { image.onload = null; image.onerror = null; image.removeAttribute("src"); return }
            const canvas = canvasRef.current; if (!canvas) return
            if (image.naturalWidth * image.naturalHeight > 100_000_000) {
                setMessage("画像が大きすぎます。1億画素以下の画像を選択してください。")
                image.onload = null; image.onerror = null; image.removeAttribute("src")
                return
            }
            const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight))
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
            canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height)
            sourceReadyRef.current = true
            setSourceName(selected.split(/[\\/]/).pop() ?? "画像"); setPoint({ x: 0.5, y: 0.5 }); setMessage("残したい人物・物を画像上でクリックしてください。")
            image.onload = null; image.onerror = null; image.removeAttribute("src")
        }
        image.onerror = () => { if (generation === selectionGenerationRef.current) { sourceReadyRef.current = false; setSourceName(""); setMessage("画像を読み込めませんでした。") } }
        image.src = mediaUrl(selected)
    }

    const cutout = async () => {
        const canvas = canvasRef.current; if (busy || !canvas || !sourceReadyRef.current) { setMessage("先に画像を選択してください。"); return }
        const sourceSnapshot = document.createElement("canvas")
        sourceSnapshot.width = canvas.width; sourceSnapshot.height = canvas.height
        sourceSnapshot.getContext("2d")?.drawImage(canvas, 0, 0)
        const nameSnapshot = sourceName
        const pointSnapshot = { ...point }
        const modeSnapshot = mode
        const previewTimeSnapshot = previewTime
        const durationSnapshot = duration
        setBusy(true); setMessage("端末内AIで切り抜いています…")
        try {
            const segmenter = await getSegmenter()
            const result = segmenter.segment(sourceSnapshot, { keypoint: pointSnapshot })
            const mask = result.categoryMask; if (!mask) throw new Error("切り抜きマスクを生成できませんでした")
            const categories = new Uint8Array(mask.getAsUint8Array()); const mw = mask.width; const mh = mask.height; mask.close()
            const maskCanvas = document.createElement("canvas"); maskCanvas.width = mw; maskCanvas.height = mh
            const maskContext = maskCanvas.getContext("2d")!; const maskImage = maskContext.createImageData(mw, mh)
            for (let index = 0; index < categories.length; index++) { const offset = index * 4; maskImage.data[offset] = 255; maskImage.data[offset + 1] = 255; maskImage.data[offset + 2] = 255; maskImage.data[offset + 3] = categories[index] === 0 ? 255 : 0 }
            maskContext.putImageData(maskImage, 0, 0)
            const output = document.createElement("canvas"); output.width = sourceSnapshot.width; output.height = sourceSnapshot.height
            const outputContext = output.getContext("2d")!; outputContext.drawImage(sourceSnapshot, 0, 0); outputContext.globalCompositeOperation = "destination-in"; outputContext.drawImage(maskCanvas, 0, 0, output.width, output.height)
            const path = await commands.saveGeneratedSticker({ pngBase64: await canvasToPngDataUrl(output) })
            const label = modeSnapshot === "person" ? "AI人物切り抜き" : modeSnapshot === "object" ? "AIオブジェクト切り抜き" : "AI背景除去"
            const assetName = `${label} - ${nameSnapshot}`
            addMediaAssets([{ id: globalThis.crypto?.randomUUID?.() ?? `cutout-asset-${Date.now()}`, kind: "image", path, name: assetName, folderId: null, favorite: false, addedAt: new Date().toISOString(), width: output.width, height: output.height }])
            addImage({ id: globalThis.crypto?.randomUUID?.() ?? `cutout-${Date.now()}`, path, label: assetName, position: { x: 0.5, y: 0.5 }, scale: 0.45, startTime: previewTimeSnapshot, endTime: Math.min(durationSnapshot, previewTimeSnapshot + 5) })
            setMessage(`${label}を透明素材として追加しました。`)
        } catch (error) { setMessage(`AI切り抜きに失敗しました: ${String(error)}`) }
        finally { setBusy(false) }
    }

    return <section className="space-y-3 border-t border-white/[0.07] pt-4">
        <div><h3 className="text-[10px] font-semibold text-zinc-300">AI切り抜き</h3><p className="mt-1 text-[9px] leading-relaxed text-zinc-600">画像内の残したい対象をクリック。処理は端末内で行います。</p></div>
        <button type="button" disabled={busy} onClick={() => void selectSource()} className="w-full rounded-lg border border-white/[0.08] py-2 text-[9px] text-zinc-300 disabled:opacity-40">{sourceName || "切り抜く画像を選択"}</button>
        <div className={`relative overflow-hidden rounded-lg border border-white/[0.08] bg-black/30 ${sourceName ? "block" : "hidden"}`}>
            <canvas ref={canvasRef} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setPoint({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }) }} className="block h-auto max-h-48 w-full cursor-crosshair object-contain" />
            <span className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-cyan-400 shadow" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-1">{([['background','背景除去'],['person','人物'],['object','物体']] as const).map(([id,label]) => <button key={id} type="button" onClick={() => setMode(id)} className={`rounded border py-1.5 text-[8px] ${mode === id ? 'border-cyan-300/25 text-cyan-100' : 'border-white/[0.07] text-zinc-500'}`}>{label}</button>)}</div>
        <button type="button" disabled={busy || !sourceName || !sourceReadyRef.current} onClick={() => void cutout()} className="w-full rounded-lg border border-cyan-300/20 bg-cyan-300/[0.05] py-2 text-[9px] font-semibold text-cyan-100 disabled:opacity-40">{busy ? "AI処理中…" : "クリック位置をAI切り抜き"}</button>
        {message && <p className="text-[9px] leading-relaxed text-zinc-500">{message}</p>}
    </section>
}
