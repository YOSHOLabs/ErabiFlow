import {
    Clapperboard,
    Clock3,
    Copy,
    ClipboardPaste,
    Link2,
    Scissors,
    Trash2,
    Unlink2,
} from "lucide-react"
import { open } from "@tauri-apps/plugin-dialog"
import {
    canSplitTimelineClip,
    getTimelineClipDuration,
    getTimelineClipSpeed,
    getTimelineClipTransform,
    getTimelineClipVolume,
    layoutTimelineClips,
    sequenceTimeToMedia,
    setTimelineClipEdge,
    timelineClipLocalTimeToMedia,
    trimTimelineClipEdge,
} from "@/lib/timeline"
import { DEFAULT_TIMELINE_CLIP_TRANSFORM } from "@/lib/types"
import type { ClipAudioEffects, ClipColorAdjustments, ClipKeyframe, ClipKeyframeProperty, ClipMotionPreset, ClipTransition, ClipVisualEffects, TimelineClipTransform } from "@/lib/types"
import { DEFAULT_CLIP_AUDIO_EFFECTS } from "@/lib/types"
import { getClipColor } from "@/lib/color"
import { getClipEffects } from "@/lib/effects"
import { applyFilterPreset, FILTER_PRESETS } from "@/lib/filterPresets"
import { applyCompositePlacement, COMPOSITE_PLACEMENTS } from "@/lib/compositeEditing"
import { copyTrackClipGroup, getTrackClipPlaybackDuration, pasteTrackClipGroup, trackClipLocalTimeToSource } from "@/lib/multiTrack"
import { clampKeyframeValue, KEYFRAME_VALUE_BOUNDS, upsertKeyframes } from "@/lib/keyframes"
import { useDocumentStore } from "@/stores/document"
import { useEditorStore } from "@/stores/editor"

function InspectorHome() {
    return (
        <div className="space-y-4">
            <div>
                <h2 className="border-l-2 border-cyan-300 pl-3 text-sm font-semibold text-zinc-100">仕上げる</h2>
                <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                    プレビューかタイムラインで要素を選ぶと、ここに編集項目が表示されます。
                </p>
            </div>

            <p className="border-t border-white/[0.08] pt-3 text-[10px] leading-relaxed text-zinc-500">
                選択対象が削除された可能性があります。別の要素を選び直してください。
            </p>
        </div>
    )
}

function formatTime(seconds: number) {
    const minutes = Math.floor(seconds / 60)
    const rest = (seconds % 60).toFixed(1).padStart(4, "0")
    return `${minutes}:${rest}`
}

const KEYFRAME_LABELS: Record<ClipKeyframeProperty, string> = {
    positionX: "横位置", positionY: "縦位置", scale: "拡大", rotation: "回転", opacity: "不透明度", volume: "音量",
}

function KeyframeEditor({
    keyframes, localTime, values, disabled, onChange,
}: {
    keyframes: ClipKeyframe[] | undefined
    localTime: number
    values: Record<ClipKeyframeProperty, number>
    disabled?: boolean
    onChange: (keyframes: ClipKeyframe[]) => void
}) {
    const sorted = [...(keyframes ?? [])].sort((a, b) => a.time - b.time || a.property.localeCompare(b.property))
    const addCurrent = () => onChange(upsertKeyframes(sorted, Number(Math.max(0, localTime).toFixed(3)), values))
    return (
        <section className="space-y-3 rounded-2xl border border-amber-300/10 bg-amber-300/[0.025] p-3.5">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <h3 className="text-[11px] font-semibold text-zinc-100">キーフレーム</h3>
                    <p className="mt-1 text-[9px] text-zinc-600">クリップ内 {localTime.toFixed(2)}秒 · 位置/拡大/回転/不透明度/音量</p>
                </div>
                <button type="button" disabled={disabled} onClick={addCurrent} className="rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-2 py-1.5 text-[9px] font-semibold text-amber-100 disabled:opacity-40">◆ 現在値を追加</button>
            </div>
            {sorted.length === 0 ? (
                <p className="text-[9px] text-zinc-600">再生ヘッドを動かして追加すると、その間を自動補間します。</p>
            ) : (
                <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">
                    {sorted.map((keyframe) => (
                        <div key={keyframe.id} className="grid grid-cols-[48px_1fr_58px_20px] items-center gap-1 rounded-lg border border-white/[0.05] bg-black/15 p-1.5">
                            <span className="font-mono text-[8px] text-amber-200">{keyframe.time.toFixed(2)}s</span>
                            <label className="min-w-0">
                                <span className="block truncate text-[8px] text-zinc-600">{KEYFRAME_LABELS[keyframe.property]}</span>
                                <input
                                    type="number"
                                    step={0.01}
                                    min={KEYFRAME_VALUE_BOUNDS[keyframe.property][0]}
                                    max={KEYFRAME_VALUE_BOUNDS[keyframe.property][1]}
                                    disabled={disabled}
                                    value={keyframe.value}
                                    onChange={(event) => {
                                        if (event.target.value === "") return
                                        const value = Number(event.target.value)
                                        if (!Number.isFinite(value)) return
                                        onChange(sorted.map((item) => item.id === keyframe.id
                                            ? { ...item, value: clampKeyframeValue(item.property, value) }
                                            : item))
                                    }}
                                    className="h-6 w-full rounded border border-white/[0.06] bg-black/25 px-1 font-mono text-[9px] text-zinc-300 disabled:opacity-40"
                                />
                            </label>
                            <select disabled={disabled} value={keyframe.interpolation} onChange={(event) => onChange(sorted.map((item) => item.id === keyframe.id ? { ...item, interpolation: event.target.value as ClipKeyframe["interpolation"] } : item))} className="h-6 rounded border border-white/[0.06] bg-[#151519] text-[8px] text-zinc-400 disabled:opacity-40">
                                <option value="linear">線形</option><option value="hold">保持</option>
                            </select>
                            <button type="button" disabled={disabled} aria-label={`${KEYFRAME_LABELS[keyframe.property]}キーフレームを削除`} onClick={() => onChange(sorted.filter((item) => item.id !== keyframe.id))} className="text-zinc-600 hover:text-red-300 disabled:opacity-40">×</button>
                        </div>
                    ))}
                </div>
            )}
        </section>
    )
}

function TransitionEditor({ transitionIn, transitionOut, disabled, onChange }: {
    transitionIn?: ClipTransition
    transitionOut?: ClipTransition
    disabled?: boolean
    onChange: (edge: "transitionIn" | "transitionOut", value: ClipTransition) => void
}) {
    const row = (edge: "transitionIn" | "transitionOut", label: string, value = edge === "transitionIn" ? transitionIn : transitionOut) => (
        <div className="grid grid-cols-[46px_1fr_64px] items-center gap-2">
            <span className="text-[9px] text-zinc-500">{label}</span>
            <select aria-label={`${label}トランジション`} disabled={disabled} value={value?.type ?? "none"} onChange={(event) => onChange(edge, { type: event.target.value as ClipTransition["type"], duration: value?.duration ?? 0.5 })} className="h-8 rounded-lg border border-white/[0.07] bg-black/25 px-2 text-[9px] text-zinc-300 disabled:opacity-40">
                <option value="none">なし</option><option value="fade">フェード</option><option value="dissolve">ディゾルブ</option><option value="slide">スライド</option><option value="zoom">ズーム</option><option value="rotate">回転</option>
            </select>
            <label className="flex items-center gap-1"><input type="number" min={0.05} max={5} step={0.05} disabled={disabled || !value || value.type === "none"} value={value?.duration ?? 0.5} onChange={(event) => onChange(edge, { type: value?.type ?? "fade", duration: Number(event.target.value) })} className="h-8 w-12 rounded-lg border border-white/[0.07] bg-black/25 px-1 font-mono text-[9px] text-zinc-300 disabled:opacity-40" /><span className="text-[8px] text-zinc-600">秒</span></label>
        </div>
    )
    return <section className="space-y-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5"><h3 className="text-[11px] font-semibold text-zinc-100">トランジション</h3>{row("transitionIn", "開始")}{row("transitionOut", "終了")}</section>
}

function MotionPresetEditor({ value = "none", disabled, onChange }: { value?: ClipMotionPreset; disabled?: boolean; onChange: (value: ClipMotionPreset) => void }) {
    const presets = [["none", "なし"], ["swing", "スイング"], ["bounce", "バウンス"], ["pop", "ポップ"]] as const
    return <section className="space-y-2 rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.02] p-3.5">
        <div><h3 className="text-[11px] font-semibold text-zinc-100">モーション</h3><p className="mt-1 text-[9px] text-zinc-600">クリップ全体へワンタップで動きを追加します。</p></div>
        <div className="grid grid-cols-4 gap-1.5">{presets.map(([id, label]) => <button key={id} type="button" disabled={disabled} aria-pressed={value === id} onClick={() => onChange(id)} className={`rounded-lg border py-2 text-[8px] ${value === id ? "border-cyan-300/30 bg-cyan-300/[0.08] text-cyan-100" : "border-white/[0.07] text-zinc-500"} disabled:opacity-40`}>{label}</button>)}</div>
    </section>
}

function ColorEditor({ color, disabled, onChange }: {
    color?: Partial<ClipColorAdjustments>
    disabled?: boolean
    onChange: (color: ClipColorAdjustments) => void
}) {
    const value = getClipColor(color)
    const update = (partial: Partial<ClipColorAdjustments>) => onChange({ ...value, ...partial })
    const chooseLut = async () => {
        const selected = await open({ multiple: false, filters: [{ name: "LUT", extensions: ["cube", "3dl"] }] })
        if (typeof selected === "string") update({ lutPath: selected })
    }
    return (
        <section className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
            <div className="flex items-center justify-between gap-2">
                <div><h3 className="text-[11px] font-semibold text-zinc-100">カラー補正</h3><p className="mt-1 text-[9px] text-zinc-600">クリップ単位。LUTは最終書き出しに適用します。</p></div>
                <button type="button" disabled={disabled} onClick={() => onChange(getClipColor())} className="rounded-md border border-white/[0.07] px-2 py-1 text-[9px] text-zinc-500 disabled:opacity-40">リセット</button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
                {FILTER_PRESETS.map((preset) => (
                    <button key={preset.id} type="button" disabled={disabled} title={preset.description} onClick={() => onChange(applyFilterPreset(preset, value))} className="rounded-lg border border-white/[0.07] bg-black/15 px-1 py-2 text-[8px] font-medium text-zinc-400 transition hover:border-cyan-300/20 hover:bg-cyan-300/[0.06] hover:text-cyan-100 disabled:opacity-40">
                        {preset.label}
                    </button>
                ))}
            </div>
            <RangeSetting label="明るさ" value={value.brightness} min={-100} max={100} step={1} suffix="" disabled={disabled} onChange={(next) => update({ brightness: next })} />
            <RangeSetting label="コントラスト" value={value.contrast} min={0} max={200} step={1} suffix="%" disabled={disabled} onChange={(next) => update({ contrast: next })} />
            <RangeSetting label="彩度" value={value.saturation} min={0} max={200} step={1} suffix="%" disabled={disabled} onChange={(next) => update({ saturation: next })} />
            <RangeSetting label="色温度" value={value.temperature} min={-100} max={100} step={1} suffix="" disabled={disabled} onChange={(next) => update({ temperature: next })} />
            <RangeSetting label="色かぶり" value={value.tint} min={-100} max={100} step={1} suffix="" disabled={disabled} onChange={(next) => update({ tint: next })} />
            <div className="space-y-2 rounded-xl border border-white/[0.05] p-2.5">
                <p className="text-[9px] font-medium text-zinc-400">階調</p>
                <RangeSetting label="ハイライト" value={value.highlights} min={-100} max={100} step={1} suffix="" disabled={disabled} onChange={(next) => update({ highlights: next })} />
                <RangeSetting label="シャドウ" value={value.shadows} min={-100} max={100} step={1} suffix="" disabled={disabled} onChange={(next) => update({ shadows: next })} />
                <RangeSetting label="黒レベル" value={value.blacks} min={-100} max={100} step={1} suffix="" disabled={disabled} onChange={(next) => update({ blacks: next })} />
                <RangeSetting label="白レベル" value={value.whites} min={-100} max={100} step={1} suffix="" disabled={disabled} onChange={(next) => update({ whites: next })} />
            </div>
            <div className="space-y-2 rounded-xl border border-white/[0.05] p-2.5">
                <p className="text-[9px] font-medium text-zinc-400">HSL</p>
                <RangeSetting label="色相" value={value.hue} min={-180} max={180} step={1} suffix="°" disabled={disabled} onChange={(next) => update({ hue: next })} />
                <RangeSetting label="彩度" value={value.hslSaturation} min={-100} max={100} step={1} suffix="" disabled={disabled} onChange={(next) => update({ hslSaturation: next })} />
                <RangeSetting label="明度" value={value.lightness} min={-100} max={100} step={1} suffix="" disabled={disabled} onChange={(next) => update({ lightness: next })} />
            </div>
            <div className="space-y-2 rounded-xl border border-white/[0.05] p-2.5">
                <p className="text-[9px] font-medium text-zinc-400">カーブ（3点）</p>
                <RangeSetting label="暗部" value={value.curveShadows} min={-100} max={100} step={1} suffix="" disabled={disabled} onChange={(next) => update({ curveShadows: next })} />
                <RangeSetting label="中間" value={value.curveMidtones} min={-100} max={100} step={1} suffix="" disabled={disabled} onChange={(next) => update({ curveMidtones: next })} />
                <RangeSetting label="明部" value={value.curveHighlights} min={-100} max={100} step={1} suffix="" disabled={disabled} onChange={(next) => update({ curveHighlights: next })} />
            </div>
            <div className="flex gap-2">
                <button type="button" disabled={disabled} onClick={() => void chooseLut()} className="min-w-0 flex-1 truncate rounded-lg border border-white/[0.07] px-2 py-2 text-left text-[9px] text-zinc-400 disabled:opacity-40" title={value.lutPath}>{value.lutPath ? value.lutPath.split(/[\\/]/).pop() : "LUTを選択 (.cube / .3dl)"}</button>
                {value.lutPath && <button type="button" disabled={disabled} onClick={() => { const { lutPath: _removed, ...rest } = value; onChange(rest) }} className="rounded-lg border border-red-300/15 px-2 text-[9px] text-red-300 disabled:opacity-40">解除</button>}
            </div>
        </section>
    )
}

function EffectEditor({ effects, disabled, onChange }: {
    effects?: Partial<ClipVisualEffects>
    disabled?: boolean
    onChange: (effects: ClipVisualEffects) => void
}) {
    const value = getClipEffects(effects)
    const update = (partial: Partial<ClipVisualEffects>) => onChange({ ...value, ...partial })
    return (
        <section className="space-y-3 rounded-2xl border border-fuchsia-300/10 bg-fuchsia-300/[0.02] p-3.5">
            <div className="flex items-center justify-between gap-2">
                <div><h3 className="text-[11px] font-semibold text-zinc-100">映像エフェクト</h3><p className="mt-1 text-[9px] text-zinc-600">Canvasでは近似表示し、最終結果は書き出し側を正本とします。</p></div>
                <button type="button" disabled={disabled} onClick={() => onChange(getClipEffects())} className="rounded-md border border-white/[0.07] px-2 py-1 text-[9px] text-zinc-500 disabled:opacity-40">リセット</button>
            </div>
            <RangeSetting label="ぼかし" value={value.blur} min={0} max={50} step={1} suffix="" disabled={disabled} onChange={(next) => update({ blur: next })} />
            <RangeSetting label="モザイク" value={value.mosaic} min={0} max={50} step={1} suffix="px" disabled={disabled} onChange={(next) => update({ mosaic: next })} />
            <div className="space-y-2 rounded-xl border border-white/[0.05] p-2.5">
                <p className="text-[9px] font-medium text-zinc-400">質感・光・動き</p>
                {([
                    ["motionBlur", "モーションブラー"], ["sharpen", "シャープ"], ["noise", "ノイズ"], ["vhs", "VHS"],
                    ["film", "フィルム"], ["glitch", "グリッチ"], ["rgbShift", "RGB"], ["glow", "発光"],
                    ["lightLeak", "ライトリーク"], ["lensFlare", "レンズフレア"], ["rain", "雨"], ["snow", "雪"],
                    ["fire", "炎"], ["particles", "パーティクル"], ["shake", "手ブレ"], ["warp", "ワープ"],
                    ["chromaticAberration", "色収差"],
                ] as const).map(([key, label]) => (
                    <RangeSetting key={key} label={label} value={value[key]} min={0} max={100} step={1} suffix="%" disabled={disabled} onChange={(next) => update({ [key]: next })} />
                ))}
            </div>
            <div className="space-y-2 rounded-xl border border-white/[0.05] p-2.5">
                <label className="flex items-center justify-between text-[9px] text-zinc-400"><span>クロマキー</span><input type="checkbox" disabled={disabled} checked={value.chroma.enabled} onChange={(event) => update({ chroma: { ...value.chroma, enabled: event.target.checked } })} /></label>
                <div className="grid grid-cols-[42px_1fr] items-center gap-2"><input aria-label="抜く色" type="color" disabled={disabled || !value.chroma.enabled} value={value.chroma.color} onChange={(event) => update({ chroma: { ...value.chroma, color: event.target.value } })} className="h-7 w-10 rounded bg-transparent disabled:opacity-40" /><span className="font-mono text-[8px] text-zinc-600">{value.chroma.color}</span></div>
                <RangeSetting label="近似色" value={value.chroma.similarity} min={0} max={100} step={1} suffix="%" disabled={disabled || !value.chroma.enabled} onChange={(next) => update({ chroma: { ...value.chroma, similarity: next } })} />
                <RangeSetting label="境界" value={value.chroma.blend} min={0} max={100} step={1} suffix="%" disabled={disabled || !value.chroma.enabled} onChange={(next) => update({ chroma: { ...value.chroma, blend: next } })} />
            </div>
            <div className="space-y-2 rounded-xl border border-white/[0.05] p-2.5">
                <label className="grid grid-cols-[54px_1fr] items-center gap-2 text-[9px] text-zinc-500"><span>マスク</span><select disabled={disabled} value={value.mask.shape} onChange={(event) => update({ mask: { ...value.mask, shape: event.target.value as ClipVisualEffects["mask"]["shape"] } })} className="h-7 rounded border border-white/[0.07] bg-black/25 px-2 text-[9px] text-zinc-300 disabled:opacity-40"><option value="none">なし</option><option value="ellipse">円・楕円</option><option value="rectangle">四角</option></select></label>
                {value.mask.shape !== "none" && <>
                    <RangeSetting label="横位置" value={value.mask.x * 100} min={0} max={100} step={1} suffix="%" disabled={disabled} onChange={(next) => update({ mask: { ...value.mask, x: next / 100 } })} />
                    <RangeSetting label="縦位置" value={value.mask.y * 100} min={0} max={100} step={1} suffix="%" disabled={disabled} onChange={(next) => update({ mask: { ...value.mask, y: next / 100 } })} />
                    <RangeSetting label="幅" value={value.mask.width * 100} min={1} max={100} step={1} suffix="%" disabled={disabled} onChange={(next) => update({ mask: { ...value.mask, width: next / 100 } })} />
                    <RangeSetting label="高さ" value={value.mask.height * 100} min={1} max={100} step={1} suffix="%" disabled={disabled} onChange={(next) => update({ mask: { ...value.mask, height: next / 100 } })} />
                    <RangeSetting label="フェザー" value={value.mask.feather} min={0} max={100} step={1} suffix="" disabled={disabled} onChange={(next) => update({ mask: { ...value.mask, feather: next } })} />
                </>}
            </div>
        </section>
    )
}

function AudioEffectEditor({ effects, disabled, onChange }: {
    effects?: Partial<ClipAudioEffects>
    disabled?: boolean
    onChange: (effects: ClipAudioEffects) => void
}) {
    const value = { ...DEFAULT_CLIP_AUDIO_EFFECTS, ...(effects ?? {}) }
    const update = (partial: Partial<ClipAudioEffects>) => onChange({ ...value, ...partial })
    return <section className="space-y-3 rounded-2xl border border-emerald-300/10 bg-emerald-300/[0.02] p-3.5">
        <div className="flex items-center justify-between"><div><h3 className="text-[11px] font-semibold text-zinc-100">音声補正</h3><p className="mt-1 text-[9px] text-zinc-600">EQ・ノーマライズ・ノイズ低減・フェード（書き出しで反映）</p></div><button type="button" disabled={disabled} onClick={() => onChange({ ...DEFAULT_CLIP_AUDIO_EFFECTS })} className="rounded-md border border-white/[0.07] px-2 py-1 text-[9px] text-zinc-500 disabled:opacity-40">リセット</button></div>
        <RangeSetting label="低音EQ" value={value.eqLow} min={-20} max={20} step={1} suffix="dB" disabled={disabled} onChange={(next) => update({ eqLow: next })} />
        <RangeSetting label="中音EQ" value={value.eqMid} min={-20} max={20} step={1} suffix="dB" disabled={disabled} onChange={(next) => update({ eqMid: next })} />
        <RangeSetting label="高音EQ" value={value.eqHigh} min={-20} max={20} step={1} suffix="dB" disabled={disabled} onChange={(next) => update({ eqHigh: next })} />
        <RangeSetting label="ノイズ低減" value={value.noiseReduction} min={0} max={100} step={1} suffix="%" disabled={disabled} onChange={(next) => update({ noiseReduction: next })} />
        <RangeSetting label="フェードイン" value={value.fadeIn} min={0} max={5} step={0.1} suffix="秒" disabled={disabled} onChange={(next) => update({ fadeIn: next })} />
        <RangeSetting label="フェードアウト" value={value.fadeOut} min={0} max={5} step={0.1} suffix="秒" disabled={disabled} onChange={(next) => update({ fadeOut: next })} />
        <label className="flex items-center justify-between rounded-lg border border-white/[0.05] p-2 text-[9px] text-zinc-400"><span>ラウドネスを自動正規化</span><input type="checkbox" disabled={disabled} checked={value.normalize} onChange={(event) => update({ normalize: event.target.checked })} /></label>
    </section>
}

export function ClipInspector({ id }: { id: string }) {
    const timelineClips = useDocumentStore((state) => state.timelineClips)
    const clip = timelineClips.find((item) => item.id === id)
    const updateTimelineClip = useDocumentStore((state) => state.updateTimelineClip)
    const removeTimelineClip = useDocumentStore((state) => state.removeTimelineClip)
    const splitTimelineClip = useDocumentStore((state) => state.splitTimelineClip)
    const duplicateTimelineClip = useDocumentStore((state) => state.duplicateTimelineClip)
    const previewTime = useEditorStore((state) => state.previewTime)
    const setPreviewTime = useEditorStore((state) => state.setPreviewTime)
    const setIsPlaying = useEditorStore((state) => state.setIsPlaying)
    const videoDuration = useDocumentStore((state) => state.videoInfo?.duration ?? null)
    const clearSelection = useEditorStore((state) => state.clearSelection)

    if (!clip) return <InspectorHome />

    const duration = getTimelineClipDuration(clip)
    const speed = getTimelineClipSpeed(clip)
    const clipVolume = getTimelineClipVolume(clip)
    const transform = getTimelineClipTransform(clip)
    const clipIndex = timelineClips.findIndex((item) => item.id === id)
    const clipSequenceStart = layoutTimelineClips(timelineClips)[clipIndex]?.sequenceStart ?? 0
    const sequencePosition = sequenceTimeToMedia(timelineClips, previewTime)
    const splitMediaTime = sequencePosition?.clip.id === id ? sequencePosition.mediaTime : null
    const canSplitAtPlayhead = splitMediaTime !== null && canSplitTimelineClip(clip, splitMediaTime)

    const applyEdge = (edge: "start" | "end", value: number) => {
        const next = setTimelineClipEdge(clip, edge, value, videoDuration)
        updateTimelineClip(id, {
            mediaStart: next.mediaStart,
            mediaEnd: next.mediaEnd,
        })
    }

    const nudgeEdge = (edge: "start" | "end", delta: number) => {
        const next = trimTimelineClipEdge(clip, edge, delta, videoDuration)
        updateTimelineClip(id, {
            mediaStart: next.mediaStart,
            mediaEnd: next.mediaEnd,
        })
    }

    const splitAtPlayhead = () => {
        if (!canSplitAtPlayhead || splitMediaTime === null) return
        setIsPlaying(false)
        splitTimelineClip(id, splitMediaTime)
        setPreviewTime(previewTime)
    }

    const updateTransform = (partial: Partial<TimelineClipTransform>) => {
        updateTimelineClip(id, { transform: { ...transform, ...partial } })
    }

    return (
        <div className="space-y-5">
            <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.035] p-3.5">
                <div className="flex items-start gap-2.5">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-200">
                        <Clapperboard className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h2 className="text-sm font-semibold text-zinc-100">映像クリップ</h2>
                        <p className="mt-1 text-[10px] text-zinc-600">
                            #{clipIndex + 1} · {duration.toFixed(2)} 秒
                        </p>
                    </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                    <ClipStat label="開始" value={clip.isGap ? "Gap" : formatTime(clip.mediaStart)} />
                    <ClipStat label="終了" value={clip.isGap ? "—" : formatTime(clip.mediaEnd)} />
                    <ClipStat label="尺" value={`${duration.toFixed(1)}s`} />
                </div>
            </div>

            <label className="block space-y-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">ラベル</span>
                <input
                    value={clip.label ?? ""}
                    onChange={(event) => updateTimelineClip(id, { label: event.target.value })}
                    className="h-9 w-full rounded-lg border border-white/[0.08] bg-black/25 px-3 text-xs text-zinc-200 outline-none transition focus:border-cyan-500/50"
                />
            </label>

            {!clip.isGap && (
                <>
                    <section className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                        <div className="flex items-center gap-2">
                            <Clock3 className="h-3.5 w-3.5 text-cyan-300" />
                            <h3 className="text-[11px] font-semibold text-zinc-100">イン/アウトを微調整</h3>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <label className="space-y-1.5">
                                <span className="text-[10px] text-zinc-500">開始</span>
                                <input
                                    type="number"
                                    min={0}
                                    step={0.01}
                                    value={clip.mediaStart}
                                    onChange={(event) => applyEdge("start", Number(event.target.value))}
                                    className="h-9 w-full rounded-lg border border-white/[0.08] bg-black/25 px-2 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-500/50"
                                />
                            </label>
                            <label className="space-y-1.5">
                                <span className="text-[10px] text-zinc-500">終了</span>
                                <input
                                    type="number"
                                    min={0}
                                    step={0.01}
                                    value={clip.mediaEnd}
                                    onChange={(event) => applyEdge("end", Number(event.target.value))}
                                    className="h-9 w-full rounded-lg border border-white/[0.08] bg-black/25 px-2 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-500/50"
                                />
                            </label>
                        </div>

                        <div className="grid grid-cols-2 gap-1.5">
                            <NudgeButton label="前を伸ばす" detail="-0.5s" onClick={() => nudgeEdge("start", -0.5)} />
                            <NudgeButton label="前を詰める" detail="+0.5s" onClick={() => nudgeEdge("start", 0.5)} />
                            <NudgeButton label="後を詰める" detail="-0.5s" onClick={() => nudgeEdge("end", -0.5)} />
                            <NudgeButton label="後を伸ばす" detail="+0.5s" onClick={() => nudgeEdge("end", 0.5)} />
                        </div>
                    </section>

                    <details className="group rounded-2xl border border-white/[0.06] bg-black/10" data-testid="clip-advanced-editor">
                        <summary className="cursor-pointer list-none px-3.5 py-3 text-[11px] font-semibold text-zinc-400 transition hover:text-zinc-100 [&::-webkit-details-marker]:hidden">
                            詳細編集・互換機能
                            <span className="mt-1 block text-[9px] font-normal text-zinc-600">速度・トランジション・色・エフェクト・キーフレーム</span>
                        </summary>
                        <div className="space-y-4 border-t border-white/[0.06] p-3.5">
                            <KeyframeEditor
                                keyframes={clip.keyframes}
                                localTime={Math.max(0, Math.min(duration, previewTime - clipSequenceStart))}
                                values={{
                                    positionX: transform.positionX, positionY: transform.positionY, scale: transform.scale,
                                    rotation: transform.rotation, opacity: transform.opacity, volume: clipVolume,
                                }}
                                onChange={(keyframes) => updateTimelineClip(id, { keyframes })}
                            />
                            <TransitionEditor transitionIn={clip.transitionIn} transitionOut={clip.transitionOut} onChange={(edge, value) => updateTimelineClip(id, { [edge]: value })} />
                            <MotionPresetEditor value={clip.motionPreset} onChange={(motionPreset) => updateTimelineClip(id, { motionPreset })} />
                            <ColorEditor color={clip.color} onChange={(color) => updateTimelineClip(id, { color })} />
                            <EffectEditor effects={clip.effects} onChange={(effects) => updateTimelineClip(id, { effects })} />
                            <AudioEffectEditor effects={clip.audioEffects} onChange={(audioEffects) => updateTimelineClip(id, { audioEffects })} />

                            <section className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                                <div>
                                    <h3 className="text-[11px] font-semibold text-zinc-100">再生速度</h3>
                                    <p className="mt-1 text-[9px] text-zinc-600">映像と元音声を同期したまま速度を変更します。</p>
                                </div>
                                <div className="grid grid-cols-4 gap-1.5">
                                    {[0.5, 1, 1.5, 2].map((preset) => (
                                        <button
                                            key={preset}
                                            type="button"
                                            onClick={() => updateTimelineClip(id, { speed: preset })}
                                            className={`rounded-lg border py-1.5 text-[10px] font-medium transition ${
                                                Math.abs(speed - preset) < 0.001
                                                    ? "border-cyan-300/35 bg-cyan-300/[0.1] text-cyan-100"
                                                    : "border-white/[0.07] text-zinc-500 hover:text-zinc-200"
                                            }`}
                                        >
                                            {preset}x
                                        </button>
                                    ))}
                                </div>
                                <RangeSetting
                                    label="速度"
                                    value={speed}
                                    min={0.25}
                                    max={4}
                                    step={0.05}
                                    suffix="x"
                                    onChange={(value) => updateTimelineClip(id, { speed: value })}
                                />
                                <div className="space-y-2 rounded-xl border border-white/[0.05] p-2.5">
                                    <div className="flex items-center justify-between"><span className="text-[9px] text-zinc-400">カーブ速度</span><button type="button" onClick={() => updateTimelineClip(id, { speedCurve: clip.speedCurve?.length ? undefined : [{ position: 0, speed }, { position: 0.5, speed }, { position: 1, speed }] })} className={`rounded-md border px-2 py-1 text-[8px] ${clip.speedCurve?.length ? "border-cyan-300/25 text-cyan-100" : "border-white/[0.07] text-zinc-500"}`}>{clip.speedCurve?.length ? "有効" : "無効"}</button></div>
                                    {clip.speedCurve?.length ? <div className="grid grid-cols-3 gap-1.5">{([0, 1, 2] as const).map((pointIndex) => <label key={pointIndex} className="space-y-1"><span className="block text-center text-[8px] text-zinc-600">{["開始", "中間", "終了"][pointIndex]}</span><input type="number" min={0.25} max={4} step={0.05} value={clip.speedCurve?.[pointIndex]?.speed ?? speed} onChange={(event) => { const next = [...(clip.speedCurve ?? [{ position: 0, speed }, { position: 0.5, speed }, { position: 1, speed }])]; next[pointIndex] = { position: pointIndex / 2, speed: Number(event.target.value) }; updateTimelineClip(id, { speedCurve: next }) }} className="h-7 w-full rounded border border-white/[0.07] bg-black/25 px-1 text-center font-mono text-[9px] text-zinc-300" /></label>)}</div> : <p className="text-[8px] text-zinc-600">開始・中間・終了の速度をつないで可変速にします。</p>}
                                </div>
                                <label className="flex items-center justify-between rounded-xl border border-white/[0.05] p-2.5 text-[9px] text-zinc-400"><span>逆再生（映像・音声）</span><input type="checkbox" checked={clip.reverse === true} onChange={(event) => updateTimelineClip(id, { reverse: event.target.checked })} /></label>
                                <div className="space-y-2 rounded-xl border border-white/[0.05] p-2.5">
                                    <div className="flex items-center justify-between gap-2"><span className="text-[9px] text-zinc-400">フリーズフレーム</span><button type="button" onClick={() => updateTimelineClip(id, clip.freezeFrame === undefined ? { freezeFrame: timelineClipLocalTimeToMedia(clip, Math.max(0, previewTime - clipSequenceStart)), freezeDuration: 2 } : { freezeFrame: undefined, freezeDuration: undefined })} className={`rounded-md border px-2 py-1 text-[8px] ${clip.freezeFrame !== undefined ? "border-cyan-300/25 text-cyan-100" : "border-white/[0.07] text-zinc-500"}`}>{clip.freezeFrame !== undefined ? "解除" : "現在フレームを固定"}</button></div>
                                    {clip.freezeFrame !== undefined && <RangeSetting label="静止時間" value={clip.freezeDuration ?? 2} min={0.1} max={30} step={0.1} suffix="秒" onChange={(value) => updateTimelineClip(id, { freezeDuration: value })} />}
                                </div>
                            </section>
                        </div>
                    </details>

                    <section className="space-y-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                        <div className="flex items-start justify-between gap-2">
                            <div>
                                <h3 className="text-[11px] font-semibold text-zinc-100">変形・合成</h3>
                                <p className="mt-1 text-[9px] text-zinc-600">このクリップだけに適用されます。</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => updateTimelineClip(id, { transform: { ...DEFAULT_TIMELINE_CLIP_TRANSFORM } })}
                                className="rounded-md border border-white/[0.07] px-2 py-1 text-[9px] text-zinc-500 hover:text-zinc-200"
                            >
                                リセット
                            </button>
                        </div>
                        <RangeSetting label="拡大" value={transform.scale * 100} min={100} max={300} step={1} suffix="%" onChange={(value) => updateTransform({ scale: value / 100 })} />
                        <RangeSetting label="横位置" value={transform.positionX * 100} min={-100} max={100} step={1} suffix="%" onChange={(value) => updateTransform({ positionX: value / 100 })} />
                        <RangeSetting label="縦位置" value={transform.positionY * 100} min={-100} max={100} step={1} suffix="%" onChange={(value) => updateTransform({ positionY: value / 100 })} />
                        <RangeSetting label="回転" value={transform.rotation} min={-180} max={180} step={1} suffix="°" onChange={(value) => updateTransform({ rotation: value })} />
                        <RangeSetting label="不透明度" value={transform.opacity * 100} min={0} max={100} step={1} suffix="%" onChange={(value) => updateTransform({ opacity: value / 100 })} />
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                aria-pressed={transform.flipHorizontal}
                                onClick={() => updateTransform({ flipHorizontal: !transform.flipHorizontal })}
                                className={`rounded-lg border py-2 text-[10px] font-medium transition ${transform.flipHorizontal ? "border-cyan-300/35 bg-cyan-300/[0.1] text-cyan-100" : "border-white/[0.07] text-zinc-500 hover:text-zinc-200"}`}
                            >
                                左右反転
                            </button>
                            <button
                                type="button"
                                aria-pressed={transform.flipVertical}
                                onClick={() => updateTransform({ flipVertical: !transform.flipVertical })}
                                className={`rounded-lg border py-2 text-[10px] font-medium transition ${transform.flipVertical ? "border-cyan-300/35 bg-cyan-300/[0.1] text-cyan-100" : "border-white/[0.07] text-zinc-500 hover:text-zinc-200"}`}
                            >
                                上下反転
                            </button>
                        </div>
                    </section>

                    <section className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                        <div className="flex items-center justify-between gap-2">
                            <div>
                                <h3 className="text-[11px] font-semibold text-zinc-100">クリップ音声</h3>
                                <p className="mt-1 text-[9px] text-zinc-600">メイン音量に対するクリップ固有の倍率です。</p>
                            </div>
                            <button
                                type="button"
                                aria-pressed={clip.muted === true}
                                onClick={() => updateTimelineClip(id, { muted: !clip.muted })}
                                className={`rounded-md border px-2 py-1 text-[9px] transition ${clip.muted ? "border-red-300/30 bg-red-300/[0.08] text-red-200" : "border-white/[0.07] text-zinc-500 hover:text-zinc-200"}`}
                            >
                                {clip.muted ? "ミュート中" : "ミュート"}
                            </button>
                        </div>
                        <RangeSetting
                            label="音量"
                            value={clipVolume * 100}
                            min={0}
                            max={200}
                            step={1}
                            suffix="%"
                            disabled={clip.muted === true}
                            onChange={(value) => updateTimelineClip(id, { volume: value / 100, muted: false })}
                        />
                    </section>

                    <section className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                        <div className="flex items-center gap-2">
                            <Scissors className="h-3.5 w-3.5 text-violet-300" />
                            <h3 className="text-[11px] font-semibold text-zinc-100">再生ヘッドで分割</h3>
                        </div>
                        <p className="text-[10px] leading-relaxed text-zinc-600">
                            プレビューの再生位置がこのクリップ内にある時だけ分割できます。
                            {splitMediaTime !== null && (
                                <span className="ml-1 font-mono text-zinc-400">
                                    現在 {formatTime(splitMediaTime)}
                                </span>
                            )}
                        </p>
                        <button
                            type="button"
                            disabled={!canSplitAtPlayhead}
                            onClick={splitAtPlayhead}
                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-violet-300/15 bg-violet-300/[0.06] py-2 text-[11px] font-semibold text-violet-100 transition hover:bg-violet-300/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <Scissors className="h-3.5 w-3.5" />
                            ここで2つに分ける
                        </button>
                    </section>

                    <button
                        type="button"
                        onClick={() => duplicateTimelineClip(id)}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.025] py-2 text-[11px] font-semibold text-zinc-300 transition hover:bg-white/[0.06] hover:text-white"
                        title="同じ区間を直後へ複製"
                    >
                        <Copy className="h-3.5 w-3.5" />
                        クリップを複製
                    </button>
                </>
            )}

            <section className="space-y-2 rounded-2xl border border-red-500/10 bg-red-500/[0.025] p-3.5">
                <div className="flex items-center gap-2 text-red-200">
                    <Trash2 className="h-3.5 w-3.5" />
                    <h3 className="text-[11px] font-semibold">削除</h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <button
                        type="button"
                        onClick={() => {
                            removeTimelineClip(id, false)
                            clearSelection()
                        }}
                        className="rounded-lg border border-white/[0.07] bg-white/[0.025] py-2 text-[10px] font-medium text-zinc-400 transition hover:bg-white/[0.05] hover:text-zinc-200"
                    >
                        隙間に置換
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            removeTimelineClip(id, true)
                            clearSelection()
                        }}
                        className="rounded-lg border border-red-500/20 bg-red-500/[0.06] py-2 text-[10px] font-medium text-red-300 transition hover:bg-red-500/10"
                    >
                        詰めて削除
                    </button>
                </div>
            </section>
        </div>
    )
}

export function TrackClipInspector({ id }: { id: string }) {
    const tracks = useDocumentStore((state) => state.editorTracks)
    const clips = useDocumentStore((state) => state.trackMediaClips)
    const updateClip = useDocumentStore((state) => state.updateTrackMediaClip)
    const removeClip = useDocumentStore((state) => state.removeTrackMediaClip)
    const setGroup = useDocumentStore((state) => state.setTrackMediaClipGroup)
    const addClips = useDocumentStore((state) => state.addTrackMediaClips)
    const previewTime = useEditorStore((state) => state.previewTime)
    const clip = clips.find((item) => item.id === id)
    const track = clip && tracks.find((item) => item.id === clip.trackId)
    const clipboard = useEditorStore((state) => state.trackClipboard)
    const setClipboard = useEditorStore((state) => state.setTrackClipboard)
    const select = useEditorStore((state) => state.select)
    const clearSelection = useEditorStore((state) => state.clearSelection)

    if (!clip || !track) return <InspectorHome />
    const groups = Array.from(new Set(clips.map((item) => item.groupId).filter((value): value is string => Boolean(value))))
    const transform = clip.transform
    const locked = track.locked
    const updateTransform = (partial: Partial<TimelineClipTransform>) => updateClip(id, { transform: { ...transform, ...partial } })
    const updateTrackPlayback = (partial: Partial<typeof clip>) => {
        const next = { ...clip, ...partial }
        updateClip(id, { ...partial, timelineEnd: next.timelineStart + getTrackClipPlaybackDuration(next) })
    }

    return (
        <div className="space-y-4">
            <div className={`rounded-2xl border p-3.5 ${clip.kind === "video" ? "border-violet-300/15 bg-violet-300/[0.035]" : "border-emerald-300/15 bg-emerald-300/[0.035]"}`}>
                <div className="flex items-center gap-2">
                    <Clapperboard className="h-4 w-4 text-violet-200" />
                    <div className="min-w-0 flex-1">
                        <h2 className="truncate text-sm font-semibold text-zinc-100">{clip.label}</h2>
                        <p className="text-[9px] text-zinc-500">{track.name} · {(clip.timelineEnd - clip.timelineStart).toFixed(2)}秒{locked ? " · ロック中" : ""}</p>
                    </div>
                </div>
            </div>

            <label className="block space-y-1.5">
                <span className="text-[10px] text-zinc-500">配置トラック</span>
                <select disabled={locked} value={clip.trackId} onChange={(event) => updateClip(id, { trackId: event.target.value })} className="h-9 w-full rounded-lg border border-white/[0.08] bg-black/25 px-2 text-xs text-zinc-200 disabled:opacity-40">
                    {tracks.filter((item) => item.kind === clip.kind).map((item) => <option key={item.id} value={item.id}>{item.name}{item.locked ? "（ロック）" : ""}</option>)}
                </select>
            </label>

            <section className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                <h3 className="text-[11px] font-semibold text-zinc-100">タイミング・素材範囲</h3>
                <div className="grid grid-cols-2 gap-2">
                    {([
                        ["timelineStart", "配置開始"], ["timelineEnd", "配置終了"],
                        ["sourceStart", "素材開始"], ["sourceEnd", "素材終了"],
                    ] as const).map(([key, label]) => (
                        <label key={key} className="space-y-1">
                            <span className="text-[9px] text-zinc-600">{label}</span>
                            <input type="number" min={0} step={0.01} disabled={locked} value={clip[key]} onChange={(event) => updateClip(id, { [key]: Number(event.target.value) })} className="h-8 w-full rounded-lg border border-white/[0.07] bg-black/25 px-2 font-mono text-[10px] text-zinc-200 disabled:opacity-40" />
                        </label>
                    ))}
                </div>
            </section>

            <section className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-semibold text-zinc-100">音声</h3>
                    <button type="button" disabled={locked} aria-pressed={clip.muted} onClick={() => updateClip(id, { muted: !clip.muted })} className={`rounded-md border px-2 py-1 text-[9px] ${clip.muted ? "border-red-300/20 text-red-200" : "border-white/[0.07] text-zinc-500"}`}>{clip.muted ? "ミュート中" : "ミュート"}</button>
                </div>
                <RangeSetting label="音量" value={clip.volume * 100} min={0} max={200} step={1} suffix="%" disabled={locked || clip.muted} onChange={(value) => updateClip(id, { volume: value / 100 })} />
            </section>

            {clip.kind === "video" && (
                <section className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                    <h3 className="text-[11px] font-semibold text-zinc-100">映像変形</h3>
                    <div className="grid grid-cols-2 gap-1.5">
                        {COMPOSITE_PLACEMENTS.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                disabled={locked}
                                onClick={() => {
                                    const next = applyCompositePlacement(clip, item.id)
                                    updateClip(id, { transform: next.transform, effects: next.effects })
                                }}
                                className="rounded-lg border border-violet-300/10 px-2 py-2 text-left text-[8px] text-violet-100/70 disabled:opacity-40"
                            >
                                <span className="block font-semibold">{item.label}</span>
                                <span className="mt-0.5 block text-[7px] text-zinc-600">{item.detail}</span>
                            </button>
                        ))}
                    </div>
                    <RangeSetting label="拡大" value={transform.scale * 100} min={10} max={300} step={1} suffix="%" disabled={locked} onChange={(value) => updateTransform({ scale: value / 100 })} />
                    <RangeSetting label="横位置" value={transform.positionX * 100} min={-100} max={100} step={1} suffix="%" disabled={locked} onChange={(value) => updateTransform({ positionX: value / 100 })} />
                    <RangeSetting label="縦位置" value={transform.positionY * 100} min={-100} max={100} step={1} suffix="%" disabled={locked} onChange={(value) => updateTransform({ positionY: value / 100 })} />
                    <RangeSetting label="回転" value={transform.rotation} min={-180} max={180} step={1} suffix="°" disabled={locked} onChange={(value) => updateTransform({ rotation: value })} />
                    <RangeSetting label="不透明度" value={transform.opacity * 100} min={0} max={100} step={1} suffix="%" disabled={locked} onChange={(value) => updateTransform({ opacity: value / 100 })} />
                </section>
            )}

            <details className="group rounded-2xl border border-white/[0.06] bg-black/10" data-testid="track-clip-advanced-editor">
                <summary className="cursor-pointer list-none px-3.5 py-3 text-[11px] font-semibold text-zinc-400 transition hover:text-zinc-100 [&::-webkit-details-marker]:hidden">
                    詳細編集・互換機能
                    <span className="mt-1 block text-[9px] font-normal text-zinc-600">速度・トランジション・色・エフェクト・キーフレーム</span>
                </summary>
                <div className="space-y-4 border-t border-white/[0.06] p-3.5">
                    <section className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                        <h3 className="text-[11px] font-semibold text-zinc-100">再生速度</h3>
                        <RangeSetting label="速度" value={clip.speed ?? 1} min={0.25} max={4} step={0.05} suffix="x" disabled={locked || Boolean(clip.speedCurve?.length) || clip.freezeFrame !== undefined} onChange={(speed) => updateTrackPlayback({ speed })} />
                        <div className="flex gap-2"><button type="button" disabled={locked || clip.freezeFrame !== undefined} onClick={() => updateTrackPlayback({ reverse: !clip.reverse })} className={`flex-1 rounded-lg border py-2 text-[9px] ${clip.reverse ? "border-cyan-300/25 text-cyan-100" : "border-white/[0.07] text-zinc-500"}`}>逆再生</button><button type="button" disabled={locked} onClick={() => updateTrackPlayback(clip.freezeFrame === undefined ? { freezeFrame: trackClipLocalTimeToSource(clip, Math.max(0, previewTime - clip.timelineStart)), speedCurve: undefined } : { freezeFrame: undefined })} className={`flex-1 rounded-lg border py-2 text-[9px] ${clip.freezeFrame !== undefined ? "border-cyan-300/25 text-cyan-100" : "border-white/[0.07] text-zinc-500"}`}>{clip.freezeFrame !== undefined ? "フリーズ解除" : "現在フレーム固定"}</button></div>
                        {(clip.reverse || clip.freezeFrame !== undefined || Boolean(clip.speedCurve?.length)) && <p className="text-[8px] leading-relaxed text-amber-200/60">逆再生・フリーズ・可変速の追加トラック音声はプレビューではミュートされ、最終書き出しで反映されます。</p>}
                        <div className="flex items-center justify-between"><span className="text-[9px] text-zinc-500">3点カーブ速度</span><button type="button" disabled={locked || clip.freezeFrame !== undefined} onClick={() => updateTrackPlayback({ speedCurve: clip.speedCurve?.length ? undefined : [{ position: 0, speed: clip.speed ?? 1 }, { position: 0.5, speed: clip.speed ?? 1 }, { position: 1, speed: clip.speed ?? 1 }] })} className="rounded-md border border-white/[0.07] px-2 py-1 text-[8px] text-zinc-400 disabled:opacity-40">{clip.speedCurve?.length ? "解除" : "有効化"}</button></div>
                        {clip.speedCurve?.length ? <div className="grid grid-cols-3 gap-1.5">{([0, 1, 2] as const).map((pointIndex) => <input key={pointIndex} aria-label={`カーブ速度${pointIndex + 1}`} type="number" min={0.25} max={4} step={0.05} disabled={locked} value={clip.speedCurve?.[pointIndex]?.speed ?? 1} onChange={(event) => { const next = [...clip.speedCurve!]; next[pointIndex] = { position: pointIndex / 2, speed: Number(event.target.value) }; updateTrackPlayback({ speedCurve: next }) }} className="h-7 rounded border border-white/[0.07] bg-black/25 px-1 text-center font-mono text-[9px] text-zinc-300 disabled:opacity-40" />)}</div> : null}
                    </section>

                    <KeyframeEditor
                        keyframes={clip.keyframes}
                        localTime={Math.max(0, Math.min(clip.timelineEnd - clip.timelineStart, previewTime - clip.timelineStart))}
                        values={{
                            positionX: transform.positionX, positionY: transform.positionY, scale: transform.scale,
                            rotation: transform.rotation, opacity: transform.opacity, volume: clip.volume,
                        }}
                        disabled={locked}
                        onChange={(keyframes) => updateClip(id, { keyframes })}
                    />
                    <TransitionEditor transitionIn={clip.transitionIn} transitionOut={clip.transitionOut} disabled={locked} onChange={(edge, value) => updateClip(id, { [edge]: value })} />
                    {clip.kind === "video" && <MotionPresetEditor value={clip.motionPreset} disabled={locked} onChange={(motionPreset) => updateClip(id, { motionPreset })} />}
                    {clip.kind === "video" && <ColorEditor color={clip.color} disabled={locked} onChange={(color) => updateClip(id, { color })} />}
                    {clip.kind === "video" && <EffectEditor effects={clip.effects} disabled={locked} onChange={(effects) => updateClip(id, { effects })} />}
                    <AudioEffectEditor effects={clip.audioEffects} disabled={locked} onChange={(audioEffects) => updateClip(id, { audioEffects })} />
                </div>
            </details>

            <section className="space-y-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                <div className="flex items-center gap-2"><Link2 className="h-3.5 w-3.5 text-cyan-300" /><h3 className="text-[11px] font-semibold text-zinc-100">グループ</h3></div>
                <select disabled={locked} value={clip.groupId ?? ""} onChange={(event) => setGroup(id, event.target.value || undefined)} className="h-8 w-full rounded-lg border border-white/[0.07] bg-black/25 px-2 text-[10px] text-zinc-300 disabled:opacity-40">
                    <option value="">グループなし</option>
                    {groups.map((group, index) => <option key={group} value={group}>グループ {index + 1}</option>)}
                </select>
                <div className="grid grid-cols-2 gap-2">
                    <button type="button" disabled={locked} onClick={() => setGroup(id, globalThis.crypto?.randomUUID?.() ?? `group-${Date.now()}`)} className="flex items-center justify-center gap-1 rounded-lg border border-cyan-300/15 py-2 text-[9px] text-cyan-100 disabled:opacity-40"><Link2 className="h-3 w-3" />新規グループ</button>
                    <button type="button" disabled={locked || !clip.groupId} onClick={() => setGroup(id, undefined)} className="flex items-center justify-center gap-1 rounded-lg border border-white/[0.07] py-2 text-[9px] text-zinc-400 disabled:opacity-40"><Unlink2 className="h-3 w-3" />解除</button>
                </div>
                <p className="text-[9px] leading-relaxed text-zinc-600">同じグループを選んだクリップは、ドラッグ時にまとめて移動します。</p>
            </section>

            <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setClipboard(copyTrackClipGroup(clips, id))} className="flex items-center justify-center gap-1 rounded-lg border border-white/[0.07] py-2 text-[10px] text-zinc-300"><Copy className="h-3 w-3" />コピー</button>
                <button type="button" disabled={clipboard.length === 0} onClick={() => {
                    const pasted = pasteTrackClipGroup(clipboard, previewTime)
                    addClips(pasted)
                    if (pasted[0]) select({ type: "trackClip", id: pasted[0].id })
                }} className="flex items-center justify-center gap-1 rounded-lg border border-white/[0.07] py-2 text-[10px] text-zinc-300 disabled:opacity-40"><ClipboardPaste className="h-3 w-3" />貼り付け</button>
            </div>

            <button type="button" disabled={locked} onClick={() => { removeClip(id, true); clearSelection() }} className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-300/15 py-2 text-[10px] text-red-300 disabled:opacity-40"><Trash2 className="h-3 w-3" />クリップ／グループを削除</button>
        </div>
    )
}

function ClipStat({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-white/[0.06] bg-black/15 px-2 py-2">
            <div className="text-[8px] font-semibold uppercase tracking-[0.14em] text-zinc-700">{label}</div>
            <div className="mt-1 truncate font-mono text-[10px] text-zinc-300">{value}</div>
        </div>
    )
}

function NudgeButton({ label, detail, onClick }: { label: string; detail: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="rounded-lg border border-white/[0.06] bg-black/20 px-2 py-2 text-left transition hover:border-cyan-300/20 hover:bg-cyan-300/[0.06]"
        >
            <span className="block text-[10px] font-medium text-zinc-300">{label}</span>
            <span className="mt-0.5 block font-mono text-[9px] text-zinc-600">{detail}</span>
        </button>
    )
}

function RangeSetting({
    label,
    value,
    min,
    max,
    step,
    suffix,
    disabled = false,
    onChange,
}: {
    label: string
    value: number
    min: number
    max: number
    step: number
    suffix: string
    disabled?: boolean
    onChange: (value: number) => void
}) {
    const safeValue = Number.isFinite(value) ? value : min
    return (
        <label className={`block space-y-1.5 ${disabled ? "opacity-40" : ""}`}>
            <span className="flex items-center justify-between text-[10px] text-zinc-500">
                {label}
                <span className="font-mono text-zinc-300">{Number(safeValue.toFixed(2))}{suffix}</span>
            </span>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={safeValue}
                disabled={disabled}
                onChange={(event) => onChange(Number(event.target.value))}
                className="w-full accent-cyan-400 disabled:cursor-not-allowed"
            />
        </label>
    )
}

export function GameInspector() {
    const layoutMode = useDocumentStore((state) => state.game.layoutMode ?? "commentary")
    const positionY = useDocumentStore((state) => state.game.positionY)
    const scale = useDocumentStore((state) => state.game.scale ?? 1)
    const setGameLayoutMode = useDocumentStore((state) => state.setGameLayoutMode)
    const setGamePositionY = useDocumentStore((state) => state.setGamePositionY)
    const setGameScale = useDocumentStore((state) => state.setGameScale)

    return (
        <div className="space-y-5">
            <div className="flex items-center gap-2">
                <Clapperboard className="h-4 w-4 text-cyan-300" />
                <div>
                    <h2 className="text-sm font-semibold text-zinc-100">映像の構図</h2>
                    <p className="text-[10px] text-zinc-600">縦画面内の見せ方を整えます</p>
                </div>
            </div>
            <section className="space-y-2">
                <span className="text-[10px] text-zinc-500">縦画面への配置</span>
                <div className="grid grid-cols-3 gap-1.5">
                    {([
                        ["portrait", "画面いっぱい", "人物・商品紹介"],
                        ["stage", "上下に余白", "ゲーム実況HUD"],
                        ["commentary", "横長のまま", "ゲーム・画面収録"],
                    ] as const).map(([mode, label, detail]) => (
                        <button
                            key={mode}
                            type="button"
                            aria-pressed={layoutMode === mode}
                            onClick={() => setGameLayoutMode(mode)}
                            className={`rounded-xl border p-2.5 text-left transition ${layoutMode === mode ? "border-cyan-300/30 bg-cyan-300/[0.08] text-cyan-50" : "border-white/[0.07] bg-white/[0.02] text-zinc-500 hover:text-zinc-200"}`}
                        >
                            <span className="block text-[10px] font-semibold">{label}</span>
                            <span className="mt-1 block text-[8px] opacity-60">{detail}</span>
                        </button>
                    ))}
                </div>
            </section>
            {layoutMode !== "portrait" && <label className="block space-y-2">
                <span className="flex items-center justify-between text-[10px] text-zinc-500">
                    縦位置
                    <span className="font-mono text-zinc-400">{Math.round(positionY * 100)}%</span>
                </span>
                <input
                    type="range"
                    min={15}
                    max={65}
                    value={positionY * 100}
                    onChange={(event) => setGamePositionY(Number(event.target.value) / 100)}
                    className="w-full accent-cyan-400"
                />
            </label>}
            <label className="block space-y-2">
                <span className="flex items-center justify-between text-[10px] text-zinc-500">
                    拡大率
                    <span className="font-mono text-zinc-400">{Math.round(scale * 100)}%</span>
                </span>
                <input
                    type="range"
                    min={100}
                    max={250}
                    step={5}
                    value={scale * 100}
                    onChange={(event) => setGameScale(Number(event.target.value) / 100)}
                    className="w-full accent-cyan-400"
                />
                <span className="block text-[9px] leading-relaxed text-zinc-600">
                    {layoutMode === "portrait"
                        ? "9:16で全面クロップし、位置とズームはクリップごとに調整できます。"
                        : layoutMode === "stage"
                            ? "3:4の映像を中央に置き、上下へ見出しやCTA用の黒い余白を残します。"
                            : "ゲーム画面の中央を基準に拡大します。100%で元の構図です。"}
                </span>
            </label>
            <p className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3 text-[10px] leading-relaxed text-zinc-600">
                プレビュー上のゲーム映像をドラッグしても位置を変更できます。
            </p>
        </div>
    )
}
