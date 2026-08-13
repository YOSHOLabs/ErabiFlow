import { useDocumentStore } from "@/stores/document"
import { useState } from "react"
import { open, save } from "@tauri-apps/plugin-dialog"
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { commands } from "@/tauri/commands"
import { Button } from "@/components/ui/button"
import type { SubtitleStyleOverride, TextSegment } from "@/lib/types"
import { SliderRow, SectionHeader } from "@/components/ui/controls"
import { COLOR_PRESETS } from "@/lib/constants"
import { FontPicker } from "@/components/ui/FontPicker"
import { createAnalysisArtifactFromResponse } from "@/lib/analysisArtifact"
import { createAnalysisJob } from "@/lib/analysisJob"
import { useDaemonProgress } from "@/features/analysis/hooks/useDaemonProgress"
import { useEditorStore } from "@/stores/editor"
import { mediaRangeToSequenceRanges, sequenceTimeToMedia } from "@/lib/timeline"
import { learnScopedSubtitleCorrection } from "@/lib/subtitleLearning"
import { useWhisperModel } from "@/hooks/useWhisperModel"
import { WhisperModelSetupCard } from "@/features/setup/WhisperModelSetupCard"
import { createSubtitleStyleOverride, resolveSubtitleStyle } from "@/lib/subtitleStyle"
import { assignSpeakerLabels, createSrt, parseSrt } from "@/lib/srt"
import { TEXT_STYLE_PRESETS } from "@/lib/textPresets"

export function SubtitlePanel() {
    const inputPath = useDocumentStore((s) => s.inputPath)
    const subtitles = useDocumentStore((s) => s.subtitles)
    const setSubtitles = useDocumentStore((s) => s.setSubtitles)
    const updateSubtitle = useDocumentStore((s) => s.updateSubtitle)
    const setAnalysisArtifact = useDocumentStore((s) => s.setAnalysisArtifact)
    const startAnalysisJob = useDocumentStore((s) => s.startAnalysisJob)
    const finishActiveAnalysisJob = useDocumentStore((s) => s.finishActiveAnalysisJob)
    const failActiveAnalysisJob = useDocumentStore((s) => s.failActiveAnalysisJob)
    const subtitleStyle = useDocumentStore((s) => s.subtitleStyle)
    const setSubtitleStyle = useDocumentStore((s) => s.setSubtitleStyle)
    const gpuType = useDocumentStore((s) => s.processing.gpuType)
    const analysisGameId = useDocumentStore((s) => s.processing.analysisGameId)
    const selection = useEditorStore((s) => s.selection)
    const select = useEditorStore((s) => s.select)
    const previewTime = useEditorStore((s) => s.previewTime)
    const timelineClips = useDocumentStore((s) => s.timelineClips)
    const setIsPlaying = useEditorStore((s) => s.setIsPlaying)
    useDaemonProgress()
    const whisperModel = useWhisperModel()

    const [isTranscribing, setIsTranscribing] = useState(false)
    const [isTranslating, setIsTranslating] = useState(false)
    const [errorMsg, setErrorMsg] = useState("")

    const isTauri = typeof window !== "undefined" && 
        (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__)

    const handleGenerateSubtitles = async () => {
        if (!inputPath || !isTauri || !whisperModel.ready) return
        setErrorMsg("")

        try {
            setIsTranscribing(true)

            const params = {
                videoPath: inputPath,
                chunkSize: 300,
                threshold: 25.0,
                maxClips: 10,
                language: "auto",
                gameId: analysisGameId,
                gpuType,
            }
            startAnalysisJob(createAnalysisJob({
                id: globalThis.crypto?.randomUUID?.() ?? `subtitle-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                sourcePath: inputPath,
                mode: "subtitle",
                params,
            }))

            // analyzeHighlights 経由でローカルのwhisper.cppを呼び出す。
            const response: any = await commands.analyzeHighlights(params)

            if (response.segments && Array.isArray(response.segments)) {
                const artifact = createAnalysisArtifactFromResponse(response, inputPath, "subtitle")
                setAnalysisArtifact(artifact)
                setSubtitles(artifact.subtitles)
                finishActiveAnalysisJob(`${response.stats?.cache_hit ? "字幕キャッシュ復元" : "字幕生成完了"}: ${artifact.subtitles.length}件`)
            } else {
                setSubtitles([])
                finishActiveAnalysisJob(`${response.stats?.cache_hit ? "字幕キャッシュ復元" : "字幕生成完了"}: 字幕セグメントなし`)
                console.warn("No text segments returned:", response)
            }
        } catch (err: any) {
            console.error("Subtitle generation failed:", err)
            const message = err?.toString() || "字幕生成エラー"
            failActiveAnalysisJob(message)
            setErrorMsg(message)
        } finally {
            setIsTranscribing(false)
        }
    }

    const handleAddSubtitleAtPlayhead = () => {
        const position = sequenceTimeToMedia(timelineClips, previewTime)
        if (!position || position.clip.isGap) {
            setErrorMsg("映像クリップ上へ再生ヘッドを移動してから字幕を追加してください。")
            return
        }

        const start = position.mediaTime
        const end = Math.min(position.clip.mediaEnd, start + 2)
        if (end - start < 0.05) {
            setErrorMsg("クリップの終端では字幕を追加できません。")
            return
        }

        const subtitle: TextSegment = {
            id: globalThis.crypto?.randomUUID?.() ?? `subtitle-${Date.now()}`,
            text: "新しい字幕",
            start: Number(start.toFixed(3)),
            end: Number(end.toFixed(3)),
        }
        setErrorMsg("")
        setIsPlaying(false)
        setSubtitles([...subtitles, subtitle].sort((a, b) => a.start - b.start))
        select({ type: "subtitle", id: subtitle.id })
    }

    const handleImportSrt = async () => {
        try {
            const path = await open({ multiple: false, filters: [{ name: "SubRip字幕", extensions: ["srt"] }] })
            if (typeof path !== "string") return
            const imported = parseSrt(await readTextFile(path))
            if (!imported.length) throw new Error("有効な字幕区間がありません")
            setSubtitles(imported)
            setErrorMsg("")
        } catch (error) { setErrorMsg(`SRTを読み込めませんでした: ${String(error)}`) }
    }

    const handleExportSrt = async () => {
        try {
            const path = await save({ defaultPath: "erabiflow-subtitles.srt", filters: [{ name: "SubRip字幕", extensions: ["srt"] }] })
            if (!path) return
            await writeTextFile(path, createSrt(subtitles))
            setErrorMsg("")
        } catch (error) { setErrorMsg(`SRTを書き出せませんでした: ${String(error)}`) }
    }

    const handleTranslateToEnglish = async () => {
        if (!inputPath || !isTauri || !whisperModel.ready) return
        setIsTranslating(true)
        setErrorMsg("")
        try {
            const response: any = await commands.analyzeHighlights({ videoPath: inputPath, chunkSize: 300, threshold: 25, maxClips: 10, language: "auto", gameId: analysisGameId, gpuType, forceReanalyze: true, translateToEnglish: true })
            const translated = createAnalysisArtifactFromResponse(response, inputPath, "subtitle").subtitles.map((subtitle) => ({ ...subtitle, translatedFrom: "auto" }))
            setSubtitles(translated)
        } catch (error) { setErrorMsg(`英語字幕を生成できませんでした: ${String(error)}`) }
        finally { setIsTranslating(false) }
    }

    if (!inputPath) return null

    const selectedSubtitle = selection.type === "subtitle" && selection.id
        ? subtitles.find((subtitle) => subtitle.id === selection.id)
        : null

    if (selectedSubtitle) {
        return <SelectedSubtitleEditor subtitle={selectedSubtitle} />
    }

    const label = isTranscribing ? "文字起こし中..." : "字幕を自動生成"

    return (
        <section className="space-y-5">
            <WhisperModelSetupCard model={whisperModel} />

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                        AI字幕
                    </h3>
                    <Button
                        onClick={handleGenerateSubtitles}
                        disabled={isTranscribing || !isTauri || !whisperModel.ready}
                        size="sm"
                        className="h-7 px-3 bg-purple-600 hover:bg-purple-500 text-xs rounded-lg font-medium"
                    >
                        {label}
                    </Button>
                </div>

                {!isTauri && (
                    <p className="text-[10px] text-zinc-600">※ Tauriアプリとして起動した場合のみ使用可能</p>
                )}

                {errorMsg && (
                    <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 break-all">
                        {errorMsg}
                    </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => void handleImportSrt()} className="rounded-lg border border-white/[0.07] py-2 text-[9px] text-zinc-400">SRT読み込み</button>
                    <button type="button" disabled={!subtitles.length} onClick={() => void handleExportSrt()} className="rounded-lg border border-white/[0.07] py-2 text-[9px] text-zinc-400 disabled:opacity-40">SRT書き出し</button>
                    <button type="button" disabled={!subtitles.length} onClick={() => setSubtitles(assignSpeakerLabels(subtitles))} className="rounded-lg border border-white/[0.07] py-2 text-[9px] text-zinc-400 disabled:opacity-40">話者を分離</button>
                    <button type="button" disabled={isTranslating || !isTauri || !whisperModel.ready} onClick={() => void handleTranslateToEnglish()} className="rounded-lg border border-purple-300/15 py-2 text-[9px] text-purple-200 disabled:opacity-40">{isTranslating ? "翻訳中…" : "AI英語字幕"}</button>
                </div>
            </div>

            <div className="space-y-4 p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/60">
                <SectionHeader>外観</SectionHeader>

                <div className="grid grid-cols-3 gap-1.5">
                    {TEXT_STYLE_PRESETS.map((preset) => (
                        <button key={preset.id} type="button" title={preset.description} onClick={() => setSubtitleStyle(preset.subtitle)} className="rounded-lg border border-white/[0.07] bg-black/15 px-1.5 py-2 text-[9px] font-medium text-zinc-400 transition hover:border-sky-300/20 hover:bg-sky-300/[0.06] hover:text-sky-100">
                            {preset.label}
                        </button>
                    ))}
                </div>

                <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-zinc-400">フォント</label>
                    <FontPicker value={subtitleStyle.font} onChange={(font) => setSubtitleStyle({ font })} />
                </div>

                <SliderRow
                    label="サイズ" value={subtitleStyle.size} min={12} max={300} step={1}
                    unit="px"
                    onChange={(v) => setSubtitleStyle({ size: v })}
                />
                <SliderRow
                    label="Y位置" value={subtitleStyle.positionY} min={0} max={1} step={0.01}
                    display={Math.round(subtitleStyle.positionY * 100).toString()}
                    unit="%"
                    onChange={(v) => setSubtitleStyle({ positionY: v })}
                />

                <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                        <label className="text-[11px] font-medium text-zinc-400">追従ハイライト</label>
                        <span className="text-[9px] text-zinc-600">短尺向け</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setSubtitleStyle({ emphasisMode: "none" })} className={`rounded-lg border px-2 py-2 text-[9px] font-semibold transition ${subtitleStyle.emphasisMode === "none" ? "border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-100" : "border-white/[0.06] text-zinc-500"}`}>
                            通常
                        </button>
                        <button type="button" onClick={() => setSubtitleStyle({ emphasisMode: "karaoke" })} className={`rounded-lg border px-2 py-2 text-[9px] font-semibold transition ${subtitleStyle.emphasisMode === "karaoke" ? "border-yellow-300/20 bg-yellow-300/[0.08] text-yellow-100" : "border-white/[0.06] text-zinc-500"}`}>
                            単語を追従
                        </button>
                    </div>
                    {subtitleStyle.emphasisMode === "karaoke" && (
                        <div className="flex items-center justify-between rounded-lg border border-white/[0.05] bg-black/10 px-2.5 py-2">
                            <span className="text-[9px] text-zinc-500">強調色</span>
                            <input type="color" value={subtitleStyle.emphasisColor} onChange={(event) => setSubtitleStyle({ emphasisColor: event.target.value })} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent" />
                        </div>
                    )}
                </div>
            </div>

            <div className="space-y-4 p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/60">
                <SectionHeader>カラー</SectionHeader>

                <div className="space-y-2">
                    <label className="text-[11px] font-medium text-zinc-400">文字色</label>
                    <div className="flex items-center gap-2 flex-wrap">
                        {COLOR_PRESETS.map((c) => (
                            <button
                                key={c}
                                onClick={() => setSubtitleStyle({ color: c })}
                                className={`
                                    w-7 h-7 rounded-lg border-2 transition-transform
                                    hover:scale-110
                                    ${subtitleStyle.color === c
                                        ? "border-white scale-110 shadow-md"
                                        : "border-transparent"
                                    }
                                `}
                                style={{ backgroundColor: c }}
                            />
                        ))}
                        <input
                            type="color"
                            value={subtitleStyle.color}
                            onChange={(e) => setSubtitleStyle({ color: e.target.value })}
                            className="w-7 h-7 rounded-lg cursor-pointer bg-transparent border-0"
                            title="カスタムカラー"
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-[11px] font-medium text-zinc-400">縁取り</label>
                        <input
                            type="color"
                            value={subtitleStyle.strokeColor}
                            onChange={(e) => setSubtitleStyle({ strokeColor: e.target.value })}
                            className="w-6 h-6 rounded cursor-pointer bg-transparent border-0"
                        />
                    </div>
                    <SliderRow
                        label="" value={subtitleStyle.strokeWidth} min={0} max={15}
                        unit="px"
                        onChange={(v) => setSubtitleStyle({ strokeWidth: v })}
                    />
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-[11px] font-medium text-zinc-400">シャドウ</label>
                        <input
                            type="color"
                            value={subtitleStyle.shadowColor}
                            onChange={(e) => setSubtitleStyle({ shadowColor: e.target.value })}
                            className="w-6 h-6 rounded cursor-pointer bg-transparent border-0"
                        />
                    </div>
                    <SliderRow
                        label="" value={subtitleStyle.shadowBlur} min={0} max={50}
                        unit="px" accent="accent-zinc-500"
                        onChange={(v) => setSubtitleStyle({ shadowBlur: v })}
                    />
                </div>
            </div>

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <SectionHeader>字幕リスト</SectionHeader>
                    <div className="flex items-center gap-1.5">
                        {subtitles.some((subtitle) => subtitle.flags?.includes("needs_review")) && (
                            <span className="rounded-full border border-amber-300/15 bg-amber-300/[0.07] px-2 py-1 text-[9px] font-medium text-amber-200">
                                要確認 {subtitles.filter((subtitle) => subtitle.flags?.includes("needs_review")).length}件
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={handleAddSubtitleAtPlayhead}
                            className="rounded-md border border-sky-300/15 bg-sky-300/[0.06] px-2 py-1 text-[9px] font-medium text-sky-100 transition hover:bg-sky-300/[0.12]"
                            title="現在の再生位置へ2秒の字幕を追加"
                        >
                            ＋ 現在位置
                        </button>
                    </div>
                </div>

            {subtitles.length > 0 ? (
                <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1 custom-scrollbar">
                    {subtitles.map((sub, idx) => (
                        <SubtitleItem
                            key={sub.id}
                            sub={sub}
                            idx={idx}
                            updateSubtitle={updateSubtitle}
                        />
                    ))}
                </div>
            ) : (
                <div className="p-5 rounded-xl border border-dashed border-zinc-700/50 bg-zinc-800/10 text-center">
                    <p className="text-xs text-zinc-600">
                        「字幕を自動生成」を押すとWhisperで文字起こしします
                    </p>
                </div>
            )}
            </div>
        </section>
    )
}

function SelectedSubtitleEditor({ subtitle }: { subtitle: TextSegment }) {
    const subtitles = useDocumentStore((s) => s.subtitles)
    const timelineClips = useDocumentStore((s) => s.timelineClips)
    const updateSubtitle = useDocumentStore((s) => s.updateSubtitle)
    const removeSubtitle = useDocumentStore((s) => s.removeSubtitle)
    const setPreviewTime = useEditorStore((s) => s.setPreviewTime)
    const setIsPlaying = useEditorStore((s) => s.setIsPlaying)
    const select = useEditorStore((s) => s.select)
    const [originalText, setOriginalText] = useState(subtitle.text)

    const ordered = [...subtitles].sort((a, b) => a.start - b.start)
    const currentIndex = ordered.findIndex((item) => item.id === subtitle.id)
    const sequenceRange = mediaRangeToSequenceRanges(timelineClips, subtitle.start, subtitle.end)[0]
    const needsReview = subtitle.flags?.includes("needs_review")
    const nextReview = ordered.slice(currentIndex + 1).find((item) => item.flags?.includes("needs_review"))
        ?? ordered.find((item) => item.flags?.includes("needs_review") && item.id !== subtitle.id)

    const focusSubtitle = (target: TextSegment | undefined) => {
        if (!target) return
        setIsPlaying(false)
        const sequenceStart = mediaRangeToSequenceRanges(timelineClips, target.start, target.end)[0]?.sequenceStart
        setPreviewTime(sequenceStart ?? target.start)
        select({ type: "subtitle", id: target.id })
    }

    const commitLearning = () => {
        if (originalText.trim() && subtitle.text.trim() && originalText !== subtitle.text) {
            learnScopedSubtitleCorrection(originalText, subtitle.text).catch(console.error)
            setOriginalText(subtitle.text)
        }
    }

    const updateStart = (value: number) => {
        updateSubtitle(subtitle.id, {
            start: Math.max(0, Math.min(value, subtitle.end - 0.05)),
        })
    }

    const updateEnd = (value: number) => {
        updateSubtitle(subtitle.id, {
            end: Math.max(subtitle.start + 0.05, value),
        })
    }

    return (
        <section className="space-y-4" data-testid="selected-subtitle-editor">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="text-sm font-semibold text-zinc-100">字幕を編集</h2>
                    <p className="mt-1 text-[10px] text-zinc-600">
                        字幕 #{currentIndex + 1} / {ordered.length} · 元動画 {formatSubtitleTime(subtitle.start)}
                        {sequenceRange
                            ? ` · タイムライン ${formatSubtitleTime(sequenceRange.sequenceStart)}`
                            : " · 現在の投稿クリップ外"}
                        {subtitle.sourceTrack !== undefined && ` · マイク Tr.${subtitle.sourceTrack}`}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => select({ type: "subtitle" })}
                    className="rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-[9px] text-zinc-400 transition hover:bg-white/[0.05] hover:text-zinc-100"
                >
                    字幕一覧
                </button>
            </div>

            {needsReview && (
                <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3">
                    <p className="text-[10px] font-semibold text-amber-100">この字幕は要確認です</p>
                    <p className="mt-1 text-[9px] leading-relaxed text-amber-100/55">
                        {subtitle.flags?.includes("possible_hallucination")
                            ? "音声にない語を誤認識した可能性があります。再生位置と文章を確認してください。"
                            : "認識の確信度が低いため、再生位置と文章を確認してください。"}
                    </p>
                    {nextReview && (
                        <button
                            type="button"
                            onClick={() => focusSubtitle(nextReview)}
                            className="mt-2 rounded-md border border-amber-200/15 px-2 py-1 text-[9px] text-amber-100/80 hover:bg-amber-200/[0.06]"
                        >
                            次の要確認字幕へ →
                        </button>
                    )}
                </div>
            )}

            <div className="rounded-xl border border-sky-300/15 bg-sky-300/[0.04] p-3">
                <label className="text-[10px] font-medium text-sky-100/80" htmlFor="selected-subtitle-text">
                    字幕テキスト
                </label>
                <textarea
                    id="selected-subtitle-text"
                    aria-label="字幕テキスト"
                    value={subtitle.text}
                    rows={4}
                    onFocus={() => setOriginalText(subtitle.text)}
                    onChange={(event) => updateSubtitle(subtitle.id, { text: event.target.value })}
                    onBlur={commitLearning}
                    className="mt-2 min-h-[92px] w-full resize-y rounded-lg border border-white/[0.09] bg-black/25 px-3 py-2 text-sm leading-relaxed text-zinc-50 outline-none transition focus:border-sky-300/40"
                />
                <label className="mt-2 block text-[9px] text-zinc-500">話者名<input value={subtitle.speaker ?? ""} onChange={(event) => updateSubtitle(subtitle.id, { speaker: event.target.value || undefined })} placeholder="例: 話者 1" className="mt-1 h-8 w-full rounded-lg border border-white/[0.08] bg-black/25 px-2 text-[10px] text-zinc-200" /></label>
                <p className="mt-2 text-[9px] leading-relaxed text-zinc-600">
                    タイムライン上の字幕をダブルクリックしても直接編集できます。
                </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <label className="rounded-xl border border-white/[0.06] bg-black/15 p-2.5 text-[9px] text-zinc-500">
                    開始（秒）
                    <input
                        aria-label="字幕の開始時間"
                        type="number"
                        min={0}
                        step={0.05}
                        value={subtitle.start}
                        onChange={(event) => updateStart(Number(event.target.value))}
                        className="mt-1.5 w-full rounded-md border border-white/[0.08] bg-black/30 px-2 py-1.5 font-mono text-[11px] text-zinc-200 outline-none focus:border-sky-300/35"
                    />
                </label>
                <label className="rounded-xl border border-white/[0.06] bg-black/15 p-2.5 text-[9px] text-zinc-500">
                    終了（秒）
                    <input
                        aria-label="字幕の終了時間"
                        type="number"
                        min={subtitle.start + 0.05}
                        step={0.05}
                        value={subtitle.end}
                        onChange={(event) => updateEnd(Number(event.target.value))}
                        className="mt-1.5 w-full rounded-md border border-white/[0.08] bg-black/30 px-2 py-1.5 font-mono text-[11px] text-zinc-200 outline-none focus:border-sky-300/35"
                    />
                </label>
            </div>

            <IndividualSubtitleStyleEditor subtitle={subtitle} />

            <div className="grid grid-cols-2 gap-2">
                <button
                    type="button"
                    disabled={currentIndex <= 0}
                    onClick={() => focusSubtitle(ordered[currentIndex - 1])}
                    className="rounded-lg border border-white/[0.07] py-2 text-[10px] text-zinc-400 transition hover:bg-white/[0.04] disabled:opacity-30"
                >
                    ← 前の字幕
                </button>
                <button
                    type="button"
                    disabled={currentIndex < 0 || currentIndex >= ordered.length - 1}
                    onClick={() => focusSubtitle(ordered[currentIndex + 1])}
                    className="rounded-lg border border-white/[0.07] py-2 text-[10px] text-zinc-400 transition hover:bg-white/[0.04] disabled:opacity-30"
                >
                    次の字幕 →
                </button>
            </div>

            <button
                type="button"
                onClick={() => {
                    const next = ordered[currentIndex + 1] ?? ordered[currentIndex - 1]
                    removeSubtitle(subtitle.id)
                    if (next) focusSubtitle(next)
                    else select({ type: "subtitle" })
                }}
                className="w-full rounded-lg border border-red-300/12 py-2 text-[10px] text-red-300/70 transition hover:bg-red-300/[0.05] hover:text-red-200"
            >
                この字幕を削除
            </button>
        </section>
    )
}

function IndividualSubtitleStyleEditor({ subtitle }: { subtitle: TextSegment }) {
    const subtitleStyle = useDocumentStore((state) => state.subtitleStyle)
    const updateSubtitle = useDocumentStore((state) => state.updateSubtitle)
    const hasOverride = subtitle.styleOverride !== undefined
    const style = resolveSubtitleStyle(subtitleStyle, subtitle)

    const updateStyle = (partial: SubtitleStyleOverride) => {
        updateSubtitle(subtitle.id, {
            styleOverride: {
                ...(subtitle.styleOverride ?? createSubtitleStyleOverride(subtitleStyle)),
                ...partial,
            },
        })
    }

    return (
        <div
            className="space-y-3 rounded-xl border border-fuchsia-300/15 bg-fuchsia-300/[0.035] p-3"
            data-testid="subtitle-individual-settings"
        >
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-[10px] font-semibold text-fuchsia-100/85">この字幕の外観</p>
                    <p className="mt-1 text-[9px] leading-relaxed text-zinc-600">
                        {hasOverride ? "この字幕だけに設定を適用中" : "現在は字幕全体の設定を使用中"}
                    </p>
                </div>
                {hasOverride ? (
                    <button
                        type="button"
                        onClick={() => updateSubtitle(subtitle.id, { styleOverride: undefined })}
                        className="flex-none rounded-lg border border-white/[0.08] px-2 py-1.5 text-[9px] text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100"
                    >
                        全体設定に戻す
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => updateSubtitle(subtitle.id, { styleOverride: createSubtitleStyleOverride(subtitleStyle) })}
                        className="flex-none rounded-lg border border-fuchsia-300/20 bg-fuchsia-300/[0.07] px-2 py-1.5 text-[9px] font-semibold text-fuchsia-100 hover:bg-fuchsia-300/10"
                    >
                        この字幕だけ変更
                    </button>
                )}
            </div>

            {hasOverride && (
                <div className="space-y-4 border-t border-white/[0.05] pt-3">
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-medium text-zinc-400">個別フォント</label>
                        <FontPicker value={style.font} onChange={(font) => updateStyle({ font })} />
                    </div>
                    <SliderRow
                        label="個別サイズ"
                        value={style.size}
                        min={12}
                        max={300}
                        step={1}
                        unit="px"
                        onChange={(size) => updateStyle({ size })}
                    />
                    <SliderRow
                        label="個別Y位置"
                        value={style.positionY}
                        min={0}
                        max={1}
                        step={0.01}
                        display={Math.round(style.positionY * 100).toString()}
                        unit="%"
                        onChange={(positionY) => updateStyle({ positionY })}
                    />

                    <div className="space-y-2">
                        <label className="text-[10px] font-medium text-zinc-400">文字色</label>
                        <div className="flex flex-wrap items-center gap-2">
                            {COLOR_PRESETS.map((color) => (
                                <button
                                    key={color}
                                    type="button"
                                    aria-label={`個別文字色 ${color}`}
                                    onClick={() => updateStyle({ color })}
                                    className={`h-6 w-6 rounded-md border-2 transition ${style.color === color ? "scale-110 border-white" : "border-transparent"}`}
                                    style={{ backgroundColor: color }}
                                />
                            ))}
                            <input
                                aria-label="個別文字色"
                                type="color"
                                value={style.color}
                                onChange={(event) => updateStyle({ color: event.target.value })}
                                className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                        <SliderRow
                            label="個別縁取り"
                            value={style.strokeWidth}
                            min={0}
                            max={15}
                            step={1}
                            unit="px"
                            onChange={(strokeWidth) => updateStyle({ strokeWidth })}
                        />
                        <input
                            aria-label="個別縁取り色"
                            type="color"
                            value={style.strokeColor}
                            onChange={(event) => updateStyle({ strokeColor: event.target.value })}
                            className="mb-0.5 h-7 w-8 cursor-pointer rounded border-0 bg-transparent"
                        />
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                        <SliderRow
                            label="個別シャドウ"
                            value={style.shadowBlur}
                            min={0}
                            max={50}
                            step={1}
                            unit="px"
                            onChange={(shadowBlur) => updateStyle({ shadowBlur })}
                        />
                        <input
                            aria-label="個別シャドウ色"
                            type="color"
                            value={style.shadowColor.startsWith("#") ? style.shadowColor : "#000000"}
                            onChange={(event) => updateStyle({ shadowColor: event.target.value })}
                            className="mb-0.5 h-7 w-8 cursor-pointer rounded border-0 bg-transparent"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-medium text-zinc-400">追従ハイライト</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => updateStyle({ emphasisMode: "none" })}
                                className={`rounded-lg border px-2 py-2 text-[9px] font-semibold ${style.emphasisMode === "none" ? "border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-100" : "border-white/[0.06] text-zinc-500"}`}
                            >
                                個別・通常
                            </button>
                            <button
                                type="button"
                                onClick={() => updateStyle({ emphasisMode: "karaoke" })}
                                className={`rounded-lg border px-2 py-2 text-[9px] font-semibold ${style.emphasisMode === "karaoke" ? "border-yellow-300/20 bg-yellow-300/[0.08] text-yellow-100" : "border-white/[0.06] text-zinc-500"}`}
                            >
                                個別・単語追従
                            </button>
                        </div>
                        {style.emphasisMode === "karaoke" && (
                            <div className="flex items-center justify-between rounded-lg border border-white/[0.05] px-2.5 py-2">
                                <span className="text-[9px] text-zinc-500">個別強調色</span>
                                <input
                                    aria-label="個別強調色"
                                    type="color"
                                    value={style.emphasisColor}
                                    onChange={(event) => updateStyle({ emphasisColor: event.target.value })}
                                    className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent"
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

function SubtitleItem({ sub, idx, updateSubtitle }: { sub: TextSegment, idx: number, updateSubtitle: any }) {
    const [originalText, setOriginalText] = useState(sub.text)
    const needsReview = sub.flags?.includes("needs_review")
    const confidenceLabel = sub.confidence !== undefined
        ? `${Math.round(sub.confidence * 100)}%`
        : null
    const timelineClips = useDocumentStore((s) => s.timelineClips)
    const setPreviewTime = useEditorStore((s) => s.setPreviewTime)
    const setIsPlaying = useEditorStore((s) => s.setIsPlaying)
    const select = useEditorStore((s) => s.select)
    const sequenceRange = mediaRangeToSequenceRanges(timelineClips, sub.start, sub.end)[0]

    const openSubtitle = () => {
        setIsPlaying(false)
        setPreviewTime(sequenceRange?.sequenceStart ?? sub.start)
        select({ type: "subtitle", id: sub.id })
    }

    const handleFocus = () => {
        setOriginalText(sub.text)
    }

    const handleBlur = () => {
        if (originalText !== sub.text && originalText.trim() && sub.text.trim()) {
            learnScopedSubtitleCorrection(originalText, sub.text).catch(console.error)
        }
    }

    return (
        <div className={`space-y-1.5 rounded-xl border p-2.5 group ${
            needsReview
                ? "border-amber-300/20 bg-amber-300/[0.045]"
                : "border-zinc-700/30 bg-zinc-800/30"
        }`}>
            <div className="flex items-center justify-between">
                <button type="button" onClick={openSubtitle} className="text-left text-[10px] font-mono text-zinc-500 hover:text-cyan-200">
                    字幕 #{idx + 1} · {formatSubtitleTime(sub.start)} – {formatSubtitleTime(sub.end)}
                    {sequenceRange && ` · TL ${formatSubtitleTime(sequenceRange.sequenceStart)}`}
                    {sub.sourceTrack !== undefined && ` · Tr.${sub.sourceTrack}`}
                </button>
                <div className="flex items-center gap-1.5">
                    {sub.styleOverride && (
                        <span className="rounded bg-fuchsia-400/10 px-1.5 py-0.5 text-[9px] text-fuchsia-200">
                            個別外観
                        </span>
                    )}
                    {confidenceLabel && (
                        <span className={`rounded px-1.5 py-0.5 text-[9px] ${
                            needsReview
                                ? "bg-amber-400/10 text-amber-300"
                                : "bg-emerald-400/10 text-emerald-300"
                        }`}>
                            信頼度 {confidenceLabel}
                        </span>
                    )}
                    {needsReview && (
                        <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[9px] text-amber-300">
                            要確認
                        </span>
                    )}
                </div>
            </div>
            <textarea
                value={sub.text}
                onChange={(e) => updateSubtitle(sub.id, { text: e.target.value })}
                onFocus={handleFocus}
                onBlur={handleBlur}
                rows={2}
                className="w-full px-3 py-1.5 rounded-lg text-xs bg-zinc-900/40 border border-zinc-700/50 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-zinc-100 resize-y min-h-[36px]"
            />
            {needsReview && (
                <button
                    type="button"
                    onClick={openSubtitle}
                    className="w-full rounded-md border border-amber-200/10 py-1.5 text-[9px] font-medium text-amber-100/75 hover:bg-amber-200/[0.05]"
                >
                    この位置へ移動して確認
                </button>
            )}
        </div>
    )
}

function formatSubtitleTime(seconds: number) {
    const minutes = Math.floor(Math.max(0, seconds) / 60)
    const rest = (Math.max(0, seconds) % 60).toFixed(1).padStart(4, "0")
    return `${minutes}:${rest}`
}
