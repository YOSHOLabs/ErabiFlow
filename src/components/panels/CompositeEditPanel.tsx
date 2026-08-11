import { open } from "@tauri-apps/plugin-dialog"
import { Clapperboard, Focus, Layers3, Plus, Upload, WandSparkles } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import {
    applyClipVisualAction,
    applyCompositePlacement,
    CLIP_VISUAL_ACTIONS,
    COMPOSITE_PLACEMENTS,
    createCompositeVideoClip,
    type CompositePlacement,
} from "@/lib/compositeEditing"
import { createMediaAsset } from "@/lib/mediaLibrary"
import { createEditorTrack } from "@/lib/multiTrack"
import { createFullSourceClip, getSequenceDuration, layoutTimelineClips } from "@/lib/timeline"
import type { MediaAsset } from "@/lib/types"
import { useDocumentStore } from "@/stores/document"
import { useEditorStore } from "@/stores/editor"
import { commands } from "@/tauri/commands"

const VIDEO_EXTENSIONS = ["mp4", "mov", "avi", "mkv", "webm", "m4v"]

function makeId(prefix: string) {
    return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatTime(seconds: number) {
    const minutes = Math.floor(Math.max(0, seconds) / 60)
    const rest = Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, "0")
    return `${minutes}:${rest}`
}

export function CompositeEditPanel() {
    const [assetId, setAssetId] = useState("")
    const [selectedClipId, setSelectedClipId] = useState("")
    const [placement, setPlacement] = useState<CompositePlacement>("top-right")
    const [duration, setDuration] = useState(5)
    const [includeAudio, setIncludeAudio] = useState(false)
    const [importing, setImporting] = useState(false)
    const [message, setMessage] = useState("")
    const inputPath = useDocumentStore((state) => state.inputPath)
    const videoInfo = useDocumentStore((state) => state.videoInfo)
    const mediaAssets = useDocumentStore((state) => state.mediaAssets)
    const trackMediaClips = useDocumentStore((state) => state.trackMediaClips)
    const timelineClips = useDocumentStore((state) => state.timelineClips)
    const previewTime = useEditorStore((state) => state.previewTime)
    const layoutMode = useDocumentStore((state) => state.game.layoutMode)
    const setGameLayoutMode = useDocumentStore((state) => state.setGameLayoutMode)
    const addMediaAssets = useDocumentStore((state) => state.addMediaAssets)
    const updateMediaAsset = useDocumentStore((state) => state.updateMediaAsset)
    const updateTrackMediaClip = useDocumentStore((state) => state.updateTrackMediaClip)
    const select = useEditorStore((state) => state.select)

    const videoAssets = useMemo(
        () => mediaAssets.filter((asset) => asset.kind === "video" && asset.path !== inputPath),
        [inputPath, mediaAssets],
    )
    const videoTrackClips = useMemo(
        () => trackMediaClips.filter((clip) => clip.kind === "video"),
        [trackMediaClips],
    )

    useEffect(() => {
        if (assetId && videoAssets.some((asset) => asset.id === assetId)) return
        setAssetId(videoAssets[0]?.id ?? "")
    }, [assetId, videoAssets])

    useEffect(() => {
        if (selectedClipId && videoTrackClips.some((clip) => clip.id === selectedClipId)) return
        setSelectedClipId(videoTrackClips[0]?.id ?? "")
    }, [selectedClipId, videoTrackClips])

    const importSecondaryVideo = async () => {
        setImporting(true)
        setMessage("")
        try {
            const selected = await open({
                multiple: true,
                filters: [{ name: "合成する動画", extensions: VIDEO_EXTENSIONS }],
            })
            const paths = selected ? (Array.isArray(selected) ? selected : [selected]) : []
            const assets = paths
                .map((path) => createMediaAsset(path))
                .filter((asset): asset is MediaAsset => asset?.kind === "video")
            if (assets.length === 0) return
            addMediaAssets(assets)
            await Promise.all(assets.map(async (asset) => {
                try {
                    const info = await commands.getVideoInfo({ inputPath: asset.path })
                    updateMediaAsset(asset.id, {
                        duration: info.duration,
                        width: info.width,
                        height: info.height,
                        fps: info.fps,
                        hasAudio: info.hasAudio,
                    })
                } catch (error) {
                    console.warn("合成動画の情報を取得できません", error)
                }
            }))
            setAssetId(assets[0].id)
            setMessage(`${assets.length}本を合成素材へ追加しました。`)
        } catch (error) {
            setMessage(`動画を読み込めませんでした: ${String(error)}`)
        } finally {
            setImporting(false)
        }
    }

    const addCompositeClip = () => {
        const current = useDocumentStore.getState()
        const asset = current.mediaAssets.find((item) => item.id === assetId && item.kind === "video")
        if (!asset) {
            setMessage("先に顔出し・リアクション・差し込み用の動画を読み込んでください。")
            return
        }
        let editorTracks = [...current.editorTracks]
        let track = editorTracks.find((item) => item.kind === "video" && !item.locked)
        if (!track) {
            track = createEditorTrack("video", editorTracks)
            editorTracks = [...editorTracks, track]
        }
        const clip = createCompositeVideoClip(asset, track.id, {
            timelineStart: previewTime,
            duration: Math.max(0.1, duration),
            placement,
            includeAudio,
        }, () => makeId("composite-video"))
        if (!clip) return
        useDocumentStore.setState({
            editorTracks,
            trackMediaClips: [...current.trackMediaClips, clip],
        })
        current.setAgentThinking(`${asset.name}を${track.name}へ追加`)
        setSelectedClipId(clip.id)
        setMessage(`${formatTime(previewTime)}から「${COMPOSITE_PLACEMENTS.find((item) => item.id === placement)?.label}」として追加しました。`)
    }

    const changeSelectedPlacement = (nextPlacement: CompositePlacement) => {
        const clip = useDocumentStore.getState().trackMediaClips.find((item) => item.id === selectedClipId && item.kind === "video")
        if (!clip) {
            setMessage("配置を変えるV2動画を選んでください。")
            return
        }
        updateTrackMediaClip(clip.id, applyCompositePlacement(clip, nextPlacement))
        setMessage(`「${COMPOSITE_PLACEMENTS.find((item) => item.id === nextPlacement)?.label}」へ変更しました。`)
    }

    const applyMainVisual = (action: Parameters<typeof applyClipVisualAction>[1]) => {
        const current = useDocumentStore.getState()
        const clips = current.timelineClips.length > 0
            ? current.timelineClips
            : videoInfo?.duration
                ? [createFullSourceClip(videoInfo.duration)]
                : []
        const active = layoutTimelineClips(clips).find((item) =>
            previewTime >= item.sequenceStart && previewTime < item.sequenceStart + item.duration && !item.isGap,
        ) ?? clips.find((clip) => !clip.isGap)
        if (!active) {
            setMessage("先に本編動画を読み込んでください。")
            return
        }
        useDocumentStore.setState({
            timelineClips: clips.map((clip) => clip.id === active.id ? applyClipVisualAction(clip, action) : clip),
        })
        setMessage(`現在の本編クリップへ「${CLIP_VISUAL_ACTIONS.find((item) => item.id === action)?.label}」を追加しました。`)
    }

    const sequenceDuration = getSequenceDuration(timelineClips) || videoInfo?.duration || 0

    return (
        <div className="space-y-4">
            <div className="border-l-2 border-violet-300 pl-3">
                <h2 className="text-sm font-semibold text-zinc-100">合成・リアクション編集</h2>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">プリセットではなく、素材・配置・演出を別々に追加して後から調整できます。</p>
            </div>

            <section className="space-y-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                <div className="flex items-center gap-2"><Focus className="h-3.5 w-3.5 text-cyan-300" /><h3 className="text-[11px] font-semibold text-zinc-100">本編の見せ方</h3></div>
                <div className="grid grid-cols-3 gap-1.5">
                    {([
                        ["portrait", "全面9:16"],
                        ["stage", "上下黒帯3:4"],
                        ["commentary", "横長帯"],
                    ] as const).map(([mode, label]) => (
                        <button key={mode} type="button" aria-pressed={layoutMode === mode} onClick={() => setGameLayoutMode(mode)} className={`rounded-lg border px-1 py-2 text-[8px] font-semibold ${layoutMode === mode ? "border-cyan-300/30 bg-cyan-300/[0.08] text-cyan-100" : "border-white/[0.07] text-zinc-500"}`}>{label}</button>
                    ))}
                </div>
            </section>

            <section className="space-y-3 rounded-2xl border border-violet-300/15 bg-violet-300/[0.035] p-3.5">
                <div className="flex items-center gap-2"><Layers3 className="h-3.5 w-3.5 text-violet-200" /><h3 className="text-[11px] font-semibold text-zinc-100">別動画をV2へ追加</h3></div>
                <div className="flex gap-2">
                    <select aria-label="合成する動画" value={assetId} onChange={(event) => setAssetId(event.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/25 px-2 text-[9px] text-zinc-300">
                        <option value="">動画を選択</option>
                        {videoAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                    </select>
                    <button type="button" onClick={() => void importSecondaryVideo()} disabled={importing} className="flex h-8 items-center gap-1 rounded-lg border border-violet-300/15 px-2 text-[8px] text-violet-200 disabled:opacity-40"><Upload className="h-3 w-3" />{importing ? "読込中" : "読込"}</button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                    {COMPOSITE_PLACEMENTS.map((item) => (
                        <button key={item.id} type="button" aria-pressed={placement === item.id} onClick={() => setPlacement(item.id)} className={`rounded-lg border p-2 text-left ${placement === item.id ? "border-violet-300/30 bg-violet-300/[0.08] text-violet-50" : "border-white/[0.07] text-zinc-500"}`}>
                            <span className="block text-[8px] font-semibold">{item.label}</span><span className="mt-0.5 block text-[7px] opacity-60">{item.detail}</span>
                        </button>
                    ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1"><span className="text-[8px] text-zinc-600">開始</span><div className="flex h-8 items-center rounded-lg border border-white/[0.07] bg-black/20 px-2 font-mono text-[9px] text-zinc-300">現在位置 {formatTime(previewTime)}</div></label>
                    <label className="space-y-1"><span className="text-[8px] text-zinc-600">長さ</span><input aria-label="合成動画の長さ" type="number" min={0.1} max={Math.max(0.1, sequenceDuration || 300)} step={0.1} value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="h-8 w-full rounded-lg border border-white/[0.07] bg-black/20 px-2 font-mono text-[9px] text-zinc-300" /></label>
                </div>
                <label className="flex items-center justify-between text-[9px] text-zinc-500"><span>合成動画の音声も使う</span><input type="checkbox" checked={includeAudio} onChange={(event) => setIncludeAudio(event.target.checked)} /></label>
                <button type="button" onClick={addCompositeClip} disabled={!inputPath || !assetId} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-violet-300 py-2.5 text-[9px] font-bold text-violet-950 disabled:opacity-40"><Plus className="h-3.5 w-3.5" />現在位置へV2動画を追加</button>
            </section>

            <section className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                <div className="flex items-center gap-2"><Clapperboard className="h-3.5 w-3.5 text-violet-200" /><h3 className="text-[11px] font-semibold text-zinc-100">配置済みV2を変更</h3></div>
                <select aria-label="配置済みV2動画" value={selectedClipId} onChange={(event) => setSelectedClipId(event.target.value)} className="h-8 w-full rounded-lg border border-white/[0.08] bg-black/25 px-2 text-[9px] text-zinc-300">
                    <option value="">V2動画を選択</option>
                    {videoTrackClips.map((clip) => <option key={clip.id} value={clip.id}>{clip.label} · {formatTime(clip.timelineStart)}</option>)}
                </select>
                <div className="grid grid-cols-2 gap-1.5">
                    {COMPOSITE_PLACEMENTS.map((item) => <button key={item.id} type="button" disabled={!selectedClipId} onClick={() => changeSelectedPlacement(item.id)} className="rounded-lg border border-white/[0.07] px-2 py-2 text-[8px] text-zinc-400 disabled:opacity-35">{item.label}</button>)}
                </div>
                <button type="button" disabled={!selectedClipId} onClick={() => select({ type: "trackClip", id: selectedClipId })} className="w-full rounded-lg border border-cyan-300/15 py-2 text-[9px] text-cyan-100 disabled:opacity-35">時間・マスク・速度・色を詳しく編集</button>
            </section>

            <section className="space-y-3 rounded-2xl border border-amber-300/10 bg-amber-300/[0.025] p-3.5">
                <div className="flex items-center gap-2"><WandSparkles className="h-3.5 w-3.5 text-amber-200" /><h3 className="text-[11px] font-semibold text-zinc-100">現在の本編クリップへ演出</h3></div>
                <div className="grid grid-cols-2 gap-1.5">
                    {CLIP_VISUAL_ACTIONS.map((item) => (
                        <button key={item.id} type="button" onClick={() => applyMainVisual(item.id)} className="rounded-lg border border-white/[0.07] p-2 text-left text-zinc-400 hover:text-zinc-100"><span className="block text-[8px] font-semibold">{item.label}</span><span className="mt-0.5 block text-[7px] text-zinc-600">{item.detail}</span></button>
                    ))}
                </div>
                <p className="text-[8px] leading-relaxed text-zinc-600">追加後は本編クリップのキーフレーム・カラー・エフェクトで数値を変えられます。</p>
            </section>

            <section className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => select({ type: "text" })} className="rounded-lg border border-white/[0.07] py-2 text-[9px] text-zinc-400">固定見出しを編集</button>
                <button type="button" onClick={() => select({ type: "subtitle" })} className="rounded-lg border border-white/[0.07] py-2 text-[9px] text-zinc-400">色字幕を編集</button>
            </section>

            {message && <p className="rounded-lg border border-white/[0.06] bg-black/20 p-2 text-[9px] leading-relaxed text-zinc-400">{message}</p>}
        </div>
    )
}
