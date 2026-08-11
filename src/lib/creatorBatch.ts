import type { VFocusDocument } from "../stores/document.ts"
import type { CreatorBatchClip, OverlayImage, SeSlot, TimelineClip } from "./types.ts"
import { buildRenderSpec } from "./renderSpec.ts"
import { renderSpecToProcessParams, type ExportProcessParams } from "./exportParams.ts"
import { createFullSourceClip, layoutTimelineClips } from "./timeline.ts"

function activeTimeline(document: VFocusDocument): TimelineClip[] {
    if (document.timelineClips.length > 0) return document.timelineClips
    const duration = document.videoInfo?.duration ?? 0
    if (duration <= 0) return []
    const start = document.trim.start > 0 ? document.trim.start : 0
    const end = document.trim.end > start ? document.trim.end : duration
    return [{ ...createFullSourceClip(duration, () => "source"), mediaStart: start, mediaEnd: end }]
}

/** Windows/macOSのファイル名として危険な文字を除き、日本語はそのまま残す。 */
export function sanitizeOutputFilePart(value: string, fallback = "clip"): string {
    const sanitized = value
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[. ]+$/g, "")
        .replace(/\s/g, "_")
        .slice(0, 40)
    return sanitized || fallback
}

export function buildCreatorBatchOutputPath(
    inputPath: string,
    index: number,
    label: string,
    runId: string,
): string {
    const lastSlash = Math.max(inputPath.lastIndexOf("\\"), inputPath.lastIndexOf("/"))
    const directory = inputPath.slice(0, lastSlash + 1)
    const fileName = inputPath.slice(lastSlash + 1)
    const lastDot = fileName.lastIndexOf(".")
    // 元ファイル名はOS上で既に有効。Rust側の安全なprefix検証と一致させるため保持する。
    const base = lastDot > 0 ? fileName.slice(0, lastDot) : fileName
    const safeLabel = sanitizeOutputFilePart(label)
    const safeRunId = sanitizeOutputFilePart(runId, "batch")
    return `${directory}${base}_tateclip_${safeRunId}_${String(index + 1).padStart(2, "0")}_${safeLabel}.mp4`
}

function remapSeSlots(document: VFocusDocument, item: CreatorBatchClip): SeSlot[] {
    const timeline = layoutTimelineClips(activeTimeline(document))
    return document.seSlots.flatMap((slot) => {
        const clip = timeline.find((entry) =>
            !entry.isGap && slot.triggerTime >= entry.sequenceStart && slot.triggerTime < entry.sequenceStart + entry.duration
        )
        if (!clip) return []
        const mediaTime = clip.mediaStart + slot.triggerTime - clip.sequenceStart
        if (mediaTime < item.mediaStart || mediaTime >= item.mediaEnd) return []
        return [{ ...slot, triggerTime: mediaTime - item.mediaStart, linkedClipId: item.id }]
    })
}

function remapImages(document: VFocusDocument, item: CreatorBatchClip): OverlayImage[] {
    const timeline = layoutTimelineClips(activeTimeline(document))
    return document.images.flatMap((image) => timeline.flatMap((clip) => {
        if (clip.isGap) return []
        const sequenceStart = Math.max(image.startTime, clip.sequenceStart)
        const sequenceEnd = Math.min(image.endTime, clip.sequenceStart + clip.duration)
        if (sequenceStart >= sequenceEnd) return []

        const mediaStart = clip.mediaStart + sequenceStart - clip.sequenceStart
        const mediaEnd = clip.mediaStart + sequenceEnd - clip.sequenceStart
        const overlapStart = Math.max(mediaStart, item.mediaStart)
        const overlapEnd = Math.min(mediaEnd, item.mediaEnd)
        if (overlapStart >= overlapEnd) return []

        return [{
            ...image,
            id: `${image.id}_${clip.id}_${item.id}`,
            startTime: overlapStart - item.mediaStart,
            endTime: overlapEnd - item.mediaStart,
            linkedClipId: item.id,
        }]
    }))
}

export function buildCreatorBatchDocument(
    document: VFocusDocument,
    item: CreatorBatchClip,
): VFocusDocument {
    const duration = Math.max(0.1, item.mediaEnd - item.mediaStart)
    return {
        ...document,
        timelineClips: [{
            id: item.id,
            mediaStart: item.mediaStart,
            mediaEnd: item.mediaEnd,
            label: item.label,
        }],
        trim: {
            ...document.trim,
            start: item.mediaStart,
            end: item.mediaEnd,
        },
        text: { ...document.text, content: item.title.trim() },
        // 各投稿動画を単体で使えるよう、BGMは同じ頭出し位置から適用する。
        bgmStart: 0,
        bgmEnd: document.bgmPath ? duration : null,
        seSlots: remapSeSlots(document, item),
        images: remapImages(document, item),
        creatorBatch: [],
    }
}

export function buildCreatorBatchExportParams(
    document: VFocusDocument,
    item: CreatorBatchClip,
    index: number,
    runId: string,
    cropData: string | null = null,
): ExportProcessParams {
    const isolated = buildCreatorBatchDocument(document, item)
    const renderSpec = buildRenderSpec(isolated, cropData)
    const outputPath = buildCreatorBatchOutputPath(document.inputPath, index, item.label, runId)
    return renderSpecToProcessParams(isolated, renderSpec, outputPath)
}
