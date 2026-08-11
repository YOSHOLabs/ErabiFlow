import { ArrowDown, ArrowUp, Scissors, Trash2 } from "lucide-react"
import { useMemo } from "react"
import { buildRoughCutManifest } from "@/lib/roughCut"
import { getTimelineClipDuration, layoutTimelineClips, setTimelineClipEdge, timelineClipLocalTimeToMedia } from "@/lib/timeline"
import { useDocumentStore } from "@/stores/document"
import { useEditorStore } from "@/stores/editor"

function formatDuration(seconds: number) {
    const safe = Math.max(0, seconds)
    const hours = Math.floor(safe / 3600)
    const minutes = Math.floor((safe % 3600) / 60)
    const rest = Math.floor(safe % 60)
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`
}

export function RoughCutInspectorPanel() {
    const document = useDocumentStore((state) => state)
    const selection = useEditorStore((state) => state.selection)
    const previewTime = useEditorStore((state) => state.previewTime)
    const select = useEditorStore((state) => state.select)
    const setIsPlaying = useEditorStore((state) => state.setIsPlaying)
    const updateTimelineClip = useDocumentStore((state) => state.updateTimelineClip)
    const removeTimelineClip = useDocumentStore((state) => state.removeTimelineClip)
    const splitTimelineClip = useDocumentStore((state) => state.splitTimelineClip)
    const reorderTimelineClips = useDocumentStore((state) => state.reorderTimelineClips)
    const manifest = useMemo(() => buildRoughCutManifest(document), [document])
    const clipIndex = selection.type === "clip" ? document.timelineClips.findIndex((clip) => clip.id === selection.id) : -1
    const clip = clipIndex >= 0 ? document.timelineClips[clipIndex] : null
    const layout = clip ? layoutTimelineClips(document.timelineClips).find((item) => item.id === clip.id) : null

    const updateEdge = (edge: "start" | "end", value: number) => {
        if (!clip) return
        updateTimelineClip(clip.id, setTimelineClipEdge(clip, edge, value, document.videoInfo?.duration))
    }

    const splitAtPlayhead = () => {
        if (!clip || !layout || clip.isGap) return
        const local = previewTime - layout.sequenceStart
        if (local <= 0 || local >= getTimelineClipDuration(clip)) return
        setIsPlaying(false)
        splitTimelineClip(clip.id, timelineClipLocalTimeToMedia(clip, local))
    }

    const removeAsDiscard = () => {
        if (!clip) return
        removeTimelineClip(clip.id, true)
        select({ type: "project" })
    }

    return (
        <div className="space-y-4" data-testid="rough-cut-inspector">
            <section className="rounded-2xl border border-cyan-300/12 bg-cyan-300/[0.035] p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200/70">ROUGH CUT</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <Metric label="KEEP" value={`${manifest.summary.keepCount}`} />
                    <Metric label="残す" value={formatDuration(manifest.summary.keptDuration)} />
                    <Metric label="削る" value={formatDuration(manifest.summary.removedDuration)} />
                </div>
                <p className="mt-3 text-[9px] leading-relaxed text-zinc-500">演出は加えません。ここでは残す区間・端・順番だけを決め、編集ソフトへ渡します。</p>
            </section>

            {clip && !clip.isGap ? (
                <section className="space-y-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5">
                    <div>
                        <p className="text-[9px] text-zinc-600">選択中のKEEP区間</p>
                        <input aria-label="KEEP区間名" value={clip.label ?? ""} onChange={(event) => updateTimelineClip(clip.id, { label: event.target.value })} placeholder={`KEEP ${clipIndex + 1}`} className="mt-1.5 h-8 w-full rounded-lg border border-white/[0.08] bg-black/20 px-2 text-[10px] text-zinc-200" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <TimeInput label="元動画 IN" value={clip.mediaStart} onChange={(value) => updateEdge("start", value)} />
                        <TimeInput label="元動画 OUT" value={clip.mediaEnd} onChange={(value) => updateEdge("end", value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={splitAtPlayhead} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-cyan-300/15 text-[9px] font-semibold text-cyan-100 hover:bg-cyan-300/[0.07]"><Scissors className="h-3 w-3" />再生位置で分割</button>
                        <button type="button" onClick={removeAsDiscard} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-red-300/15 text-[9px] font-semibold text-red-200 hover:bg-red-300/[0.07]"><Trash2 className="h-3 w-3" />この区間を没にする</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <button type="button" disabled={clipIndex <= 0} onClick={() => reorderTimelineClips(clipIndex, clipIndex - 1)} className="flex h-8 items-center justify-center gap-1 rounded-lg border border-white/[0.07] text-[9px] text-zinc-400 disabled:opacity-30"><ArrowUp className="h-3 w-3" />前へ</button>
                        <button type="button" disabled={clipIndex >= document.timelineClips.length - 1} onClick={() => reorderTimelineClips(clipIndex, clipIndex + 1)} className="flex h-8 items-center justify-center gap-1 rounded-lg border border-white/[0.07] text-[9px] text-zinc-400 disabled:opacity-30"><ArrowDown className="h-3 w-3" />後ろへ</button>
                    </div>
                    <p className="text-[8px] leading-relaxed text-zinc-600">タイムライン上でも両端をドラッグして調整できます。削除は後続を詰め、空白を残しません。</p>
                </section>
            ) : (
                <section className="rounded-2xl border border-dashed border-white/[0.08] p-4 text-center">
                    <p className="text-[10px] font-semibold text-zinc-300">KEEP区間を選択</p>
                    <p className="mt-1.5 text-[9px] leading-relaxed text-zinc-600">タイムラインの区間をクリックすると、IN／OUT・分割・没・並び順を調整できます。</p>
                </section>
            )}
        </div>
    )
}

function Metric({ label, value }: { label: string; value: string }) {
    return <div className="rounded-xl border border-white/[0.06] bg-black/15 px-2 py-2"><p className="text-[8px] text-zinc-600">{label}</p><p className="mt-1 font-mono text-[12px] font-semibold text-zinc-100">{value}</p></div>
}

function TimeInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
    return <label className="text-[9px] text-zinc-500">{label}<input type="number" min={0} step={0.1} value={Number(value.toFixed(3))} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 h-8 w-full rounded-lg border border-white/[0.08] bg-black/20 px-2 font-mono text-[10px] text-zinc-200" /></label>
}
