import type { VFocusDocument } from "../stores/document.ts"
import { buildRoughCutManifest, toRoughCutClips } from "./roughCut.ts"
import { getSequenceDuration, isFullSourceTimeline, mediaRangeToSequenceRanges, subtitlesToSequence } from "./timeline.ts"

export type PreflightSeverity = "error" | "warning" | "info" | "ok"
export type ExportPreflightDocument = Pick<
    VFocusDocument,
    "inputPath" | "videoInfo" | "timelineClips" | "subtitles"
>

export interface PreflightItem {
    id: string
    severity: PreflightSeverity
    title: string
    detail: string
}

export interface PreflightSummary {
    canExport: boolean
    sequenceDuration: number
    removedDuration: number
    sequenceClipCount: number
    subtitleCount: number
    reviewSubtitleCount: number
    items: PreflightItem[]
    counts: Record<PreflightSeverity, number>
}

function countReviewSubtitlesInSequence(document: ExportPreflightDocument, roughCutClips = toRoughCutClips(document.timelineClips)) {
    return document.subtitles.filter((subtitle) =>
        subtitle.flags?.includes("needs_review") &&
        mediaRangeToSequenceRanges(roughCutClips, subtitle.start, subtitle.end).length > 0
    ).length
}

function makeCounts(items: PreflightItem[]): Record<PreflightSeverity, number> {
    return {
        error: items.filter((item) => item.severity === "error").length,
        warning: items.filter((item) => item.severity === "warning").length,
        info: items.filter((item) => item.severity === "info").length,
        ok: items.filter((item) => item.severity === "ok").length,
    }
}

function formatDuration(seconds: number) {
    const safe = Math.max(0, seconds)
    const hours = Math.floor(safe / 3600)
    const minutes = Math.floor((safe % 3600) / 60)
    const secs = Math.floor(safe % 60)
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
        : `${minutes}:${String(secs).padStart(2, "0")}`
}

export function computeExportPreflight(document: ExportPreflightDocument): PreflightSummary {
    const roughCutClips = toRoughCutClips(document.timelineClips)
    const sequenceDuration = getSequenceDuration(roughCutClips)
    const sequenceClips = roughCutClips.filter((clip) => !clip.isGap)
    const sequenceSubtitles = subtitlesToSequence(roughCutClips, document.subtitles)
    const reviewSubtitleCount = countReviewSubtitlesInSequence(document, roughCutClips)
    const mediaDuration = document.videoInfo?.duration ?? 0
    const manifest = buildRoughCutManifest(document)
    const items: PreflightItem[] = []

    if (!document.inputPath) {
        items.push({ id: "missing-input", severity: "error", title: "動画が未選択です", detail: "ラフカットには元動画ファイルが必要です。" })
    } else {
        items.push({ id: "input-ok", severity: "ok", title: "元動画を確認済み", detail: document.inputPath.split(/[\\/]/).pop() || document.inputPath })
    }

    if (!document.videoInfo || mediaDuration <= 0 || document.videoInfo.width <= 0 || document.videoInfo.height <= 0) {
        items.push({ id: "missing-video-info", severity: "error", title: "動画情報を取得できません", detail: "尺と画角を確認してから受け渡してください。" })
    } else {
        const orientation = document.videoInfo.width > document.videoInfo.height ? "横" : document.videoInfo.width < document.videoInfo.height ? "縦" : "正方形"
        items.push({ id: "source-format", severity: "ok", title: `${orientation}動画・元画角を維持`, detail: `${document.videoInfo.width}×${document.videoInfo.height} · ${formatDuration(mediaDuration)}` })
    }

    if (sequenceDuration <= 0 || sequenceClips.length === 0) {
        items.push({ id: "empty-sequence", severity: "error", title: "KEEP区間がありません", detail: "残したい区間を1つ以上タイムラインへ追加してください。" })
    } else {
        items.push({
            id: "rough-cut-ready",
            severity: "ok",
            title: `${sequenceClips.length}区間をつないで受け渡せます`,
            detail: `完成尺 ${formatDuration(sequenceDuration)} · 削除候補 ${formatDuration(manifest.summary.removedDuration)}。尺の上限はありません。`,
        })
    }

    if (mediaDuration > 0 && isFullSourceTimeline(roughCutClips, mediaDuration)) {
        items.push({ id: "original-only", severity: "info", title: "まだ元動画全体がKEEPです", detail: "このままでも出力できます。無駄を削る場合は、見どころ判断かタイムラインで没区間を作ります。" })
    }

    if (reviewSubtitleCount > 0) {
        items.push({ id: "subtitle-review", severity: "info", title: "要確認字幕があります", detail: `${reviewSubtitleCount}件です。動画には焼き込まず、SRTとして編集ソフトへ渡せます。` })
    } else if (sequenceSubtitles.length > 0) {
        items.push({ id: "subtitles-ready", severity: "ok", title: "字幕をSRTで受け渡せます", detail: `${sequenceSubtitles.length}件をラフカットの時間軸へ変換します。` })
    }

    const counts = makeCounts(items)
    return {
        canExport: counts.error === 0,
        sequenceDuration,
        removedDuration: manifest.summary.removedDuration,
        sequenceClipCount: sequenceClips.length,
        subtitleCount: sequenceSubtitles.length,
        reviewSubtitleCount,
        items,
        counts,
    }
}
