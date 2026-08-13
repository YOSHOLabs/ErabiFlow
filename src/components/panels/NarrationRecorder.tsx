import { useEffect, useRef, useState } from "react"
import { save } from "@tauri-apps/plugin-dialog"
import { remove, writeFile } from "@tauri-apps/plugin-fs"
import { useDocumentStore } from "@/stores/document"
import { commands } from "@/tauri/commands"

type RecordingPhase = "idle" | "starting" | "recording" | "stopping" | "saving"

export function NarrationRecorder() {
    const addMediaAssets = useDocumentStore((state) => state.addMediaAssets)
    const recorderRef = useRef<MediaRecorder | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const chunksRef = useRef<Blob[]>([])
    const startedAtRef = useRef(0)
    const mountedRef = useRef(true)
    const phaseRef = useRef<RecordingPhase>("idle")
    const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>("idle")
    const [message, setMessage] = useState("")
    const [speechText, setSpeechText] = useState("")
    const [voices, setVoices] = useState<string[]>([])
    const [voice, setVoice] = useState("")
    const [rate, setRate] = useState(0)
    const [generating, setGenerating] = useState(false)

    useEffect(() => {
        void commands.listSystemVoices().then((items) => { setVoices(items); setVoice((current) => current || items[0] || "") }).catch(() => setVoices([]))
        return () => {
            mountedRef.current = false
            const recorder = recorderRef.current
            if (recorder) {
                recorder.ondataavailable = null
                recorder.onstop = null
                if (recorder.state !== "inactive") recorder.stop()
            }
            streamRef.current?.getTracks().forEach((track) => track.stop())
            recorderRef.current = null
            streamRef.current = null
            phaseRef.current = "idle"
        }
    }, [])

    const setPhase = (phase: RecordingPhase) => {
        phaseRef.current = phase
        if (mountedRef.current) setRecordingPhase(phase)
    }

    const addAudioAsset = async (path: string, fallbackDuration = 1) => {
        const info = await commands.getVideoInfo({ inputPath: path })
        if (!info.hasAudio || !Number.isFinite(info.duration) || info.duration <= 0.05) {
            throw new Error("保存したファイルに有効な音声がありません")
        }
        addMediaAssets([{ id: globalThis.crypto?.randomUUID?.() ?? `narration-${Date.now()}`, kind: "audio", path, name: path.split(/[\\/]/).pop() ?? "ナレーション", folderId: null, favorite: false, addedAt: new Date().toISOString(), duration: info.duration || fallbackDuration, hasAudio: true }])
    }

    const synthesize = async () => {
        if (!speechText.trim()) { setMessage("読み上げる文章を入力してください。"); return }
        setGenerating(true); setMessage("AI音声を生成しています…")
        try {
            const path = await commands.synthesizeSpeech({ text: speechText.trim(), voice: voice || null, rate })
            await addAudioAsset(path, Math.max(1, speechText.length / 7))
            setMessage("読み上げ音声を素材へ追加しました。音声トラックへ配置できます。")
        } catch (error) { setMessage(`音声合成に失敗しました: ${String(error)}`) }
        finally { setGenerating(false) }
    }

    const stopStream = () => {
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
    }

    const startRecording = async () => {
        if (phaseRef.current !== "idle") return
        setPhase("starting")
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } })
            if (!mountedRef.current || (phaseRef.current as RecordingPhase) !== "starting") {
                stream.getTracks().forEach((track) => track.stop())
                return
            }
            const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm"
            const recorder = new MediaRecorder(stream, { mimeType })
            streamRef.current = stream
            recorderRef.current = recorder
            chunksRef.current = []
            startedAtRef.current = performance.now()
            recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
            recorder.onstop = async () => {
                stopStream()
                recorderRef.current = null
                if (!mountedRef.current) return
                setPhase("saving")
                try {
                    const blob = new Blob(chunksRef.current, { type: mimeType })
                    if (blob.size < 256) throw new Error("録音データが空です。少し待ってから停止してください")
                    const path = await save({ defaultPath: `erabiflow-narration-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`, filters: [{ name: "Opus音声", extensions: ["webm"] }] })
                    if (!path) return
                    await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
                    const fallbackDuration = Math.max(0.1, (performance.now() - startedAtRef.current) / 1000)
                    try {
                        await addAudioAsset(path, fallbackDuration)
                    } catch (error) {
                        await remove(path).catch(() => undefined)
                        throw error
                    }
                    setMessage("録音を素材ライブラリへ追加しました。A2以降へ配置できます。")
                } catch (error) { if (mountedRef.current) setMessage(`録音を保存できませんでした: ${String(error)}`) }
                finally { setPhase("idle") }
            }
            recorder.start(250)
            setMessage("録音中です。マイクへナレーションを話してください。")
            setPhase("recording")
        } catch (error) { stopStream(); setPhase("idle"); if (mountedRef.current) setMessage(`マイクを開始できませんでした: ${String(error)}`) }
    }

    const stopRecording = () => {
        if (phaseRef.current !== "recording") return
        const recorder = recorderRef.current
        if (!recorder || recorder.state === "inactive") { setPhase("idle"); return }
        setPhase("stopping")
        recorder.requestData()
        recorder.stop()
    }

    return (
        <section className="space-y-3 border-t border-white/[0.07] pt-4">
            <div><h3 className="text-[10px] font-semibold text-zinc-300">AI音声・音声合成・読み上げ</h3><p className="mt-1 text-[9px] leading-relaxed text-zinc-600">PC内の音声を使い、文章からオフラインでWAVを生成します。</p></div>
            <textarea aria-label="読み上げ文章" maxLength={3000} value={speechText} onChange={(event) => setSpeechText(event.target.value)} placeholder="読み上げる文章を入力" className="min-h-20 w-full resize-y rounded-lg border border-white/[0.08] bg-black/25 p-2 text-[10px] text-zinc-200 outline-none focus:border-cyan-300/30" />
            <div className="grid grid-cols-[1fr_72px] gap-2"><select aria-label="音声" value={voice} onChange={(event) => setVoice(event.target.value)} className="h-8 min-w-0 rounded border border-white/[0.08] bg-[#151519] px-2 text-[9px] text-zinc-300"><option value="">既定の音声</option>{voices.map((item) => <option key={item} value={item}>{item}</option>)}</select><label className="flex items-center gap-1 text-[8px] text-zinc-600"><span>速さ</span><input aria-label="読み上げ速度" type="number" min={-10} max={10} value={rate} onChange={(event) => setRate(Number(event.target.value))} className="h-8 w-12 rounded border border-white/[0.08] bg-black/25 px-1 text-center text-[9px] text-zinc-300" /></label></div>
            <button type="button" disabled={generating} onClick={() => void synthesize()} className="w-full rounded-lg border border-violet-300/20 bg-violet-300/[0.05] py-2 text-[10px] font-semibold text-violet-100 disabled:opacity-50">{generating ? "生成中…" : "AI音声を生成して素材へ追加"}</button>
            <div className="border-t border-white/[0.06] pt-3"><h3 className="text-[10px] font-semibold text-zinc-300">ナレーション録音</h3><p className="mt-1 text-[9px] leading-relaxed text-zinc-600">自分の声もノイズ抑制付きで録音できます。</p></div>
            <button type="button" disabled={recordingPhase !== "idle" && recordingPhase !== "recording"} onClick={() => recordingPhase === "recording" ? stopRecording() : void startRecording()} className={`w-full rounded-lg border py-2 text-[10px] font-semibold disabled:opacity-50 ${recordingPhase === "recording" ? "border-red-300/25 bg-red-300/[0.07] text-red-200" : "border-cyan-300/20 bg-cyan-300/[0.05] text-cyan-100"}`}>{recordingPhase === "recording" ? "■ 録音を停止して保存" : recordingPhase === "starting" ? "マイクを準備中…" : recordingPhase === "stopping" ? "録音を停止中…" : recordingPhase === "saving" ? "録音を検証・保存中…" : "● ナレーションを録音"}</button>
            {message && <p className="text-[9px] leading-relaxed text-zinc-500">{message}</p>}
        </section>
    )
}
