import type { VFocusDocument } from "../stores/document.ts"
import type { TimelineClip } from "./types.ts"
import { getTimelineClipDuration, subtitlesToSequence } from "./timeline.ts"

export interface RoughCutEntry {
    id: string
    index: number
    label: string
    sourceIn: number
    sourceOut: number
    timelineIn: number
    timelineOut: number
    duration: number
}

export interface RoughCutManifest {
    format: "erabiflow-rough-cut"
    version: 1
    source: {
        path: string
        fileName: string
        duration: number
        width: number
        height: number
        fps: number
        orientation: "landscape" | "portrait" | "square"
    }
    summary: {
        keepCount: number
        keptDuration: number
        removedDuration: number
        keepRatio: number
    }
    entries: RoughCutEntry[]
}

export type RoughCutDocument = Pick<VFocusDocument, "inputPath" | "videoInfo" | "timelineClips" | "subtitles">

function roundMillis(value: number) {
    return Number(Math.max(0, value).toFixed(3))
}

/**
 * A rough cut deliberately carries only source ranges, gaps, ordering, and labels.
 * Legacy editor properties (speed, transforms, effects, transitions, and audio
 * treatment) belong in the downstream NLE and must not leak into handoff files.
 */
export function toRoughCutClips(clips: readonly TimelineClip[]): TimelineClip[] {
    return clips.map((clip) => ({
        id: clip.id,
        ...(clip.isGap ? { isGap: true } : {}),
        mediaStart: clip.mediaStart,
        mediaEnd: clip.mediaEnd,
        ...(clip.label ? { label: clip.label } : {}),
    }))
}

function sourceCoverage(clips: readonly TimelineClip[], sourceDuration: number) {
    const ranges = clips
        .filter((clip) => !clip.isGap)
        .map((clip) => ({
            start: Math.max(0, Math.min(sourceDuration, clip.mediaStart)),
            end: Math.max(0, Math.min(sourceDuration, clip.mediaEnd)),
        }))
        .filter((range) => range.end > range.start)
        .sort((a, b) => a.start - b.start || a.end - b.end)

    const merged: Array<{ start: number; end: number }> = []
    for (const range of ranges) {
        const previous = merged.at(-1)
        if (!previous || range.start > previous.end) merged.push({ ...range })
        else previous.end = Math.max(previous.end, range.end)
    }
    return merged.reduce((total, range) => total + range.end - range.start, 0)
}

export function buildRoughCutManifest(document: RoughCutDocument): RoughCutManifest {
    const sourceDuration = Math.max(0, document.videoInfo?.duration ?? 0)
    const width = Math.max(0, document.videoInfo?.width ?? 0)
    const height = Math.max(0, document.videoInfo?.height ?? 0)
    let timelineCursor = 0
    const entries: RoughCutEntry[] = []

    const clips = toRoughCutClips(document.timelineClips)
    for (const clip of clips) {
        const duration = getTimelineClipDuration(clip)
        if (clip.isGap) {
            timelineCursor += duration
            continue
        }
        if (duration <= 0 || clip.mediaEnd <= clip.mediaStart) continue
        const timelineIn = timelineCursor
        timelineCursor += duration
        entries.push({
            id: clip.id,
            index: entries.length + 1,
            label: clip.label?.trim() || `KEEP ${entries.length + 1}`,
            sourceIn: roundMillis(clip.mediaStart),
            sourceOut: roundMillis(clip.mediaEnd),
            timelineIn: roundMillis(timelineIn),
            timelineOut: roundMillis(timelineCursor),
            duration: roundMillis(duration),
        })
    }

    const keptDuration = entries.reduce((total, entry) => total + entry.duration, 0)
    const coveredSourceDuration = sourceCoverage(clips, sourceDuration)
    const fileName = document.inputPath.split(/[\\/]/).pop() || document.inputPath

    return {
        format: "erabiflow-rough-cut",
        version: 1,
        source: {
            path: document.inputPath,
            fileName,
            duration: roundMillis(sourceDuration),
            width,
            height,
            fps: Math.max(1, Math.min(120, document.videoInfo?.fps ?? 30)),
            orientation: width === height ? "square" : width > height ? "landscape" : "portrait",
        },
        summary: {
            keepCount: entries.length,
            keptDuration: roundMillis(keptDuration),
            removedDuration: roundMillis(Math.max(0, sourceDuration - coveredSourceDuration)),
            keepRatio: sourceDuration > 0 ? Number((coveredSourceDuration / sourceDuration).toFixed(4)) : 0,
        },
        entries,
    }
}

function csvCell(value: string | number) {
    const raw = String(value)
    // Spreadsheet apps may execute cells beginning with these characters.
    // Handoff CSV is data, so force untrusted AI labels and file names to text.
    const text = typeof value === "string" && /^[=+\-@]/.test(raw) ? `'${raw}` : raw
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function roughCutManifestToCsv(manifest: RoughCutManifest) {
    const rows = [
        ["index", "label", "source_in", "source_out", "timeline_in", "timeline_out", "duration", "source_file"],
        ...manifest.entries.map((entry) => [
            entry.index,
            entry.label,
            entry.sourceIn.toFixed(3),
            entry.sourceOut.toFixed(3),
            entry.timelineIn.toFixed(3),
            entry.timelineOut.toFixed(3),
            entry.duration.toFixed(3),
            manifest.source.fileName,
        ]),
    ]
    return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n"
}

function toTimecode(seconds: number, fps: number) {
    const nominalFps = Math.max(1, Math.round(fps))
    // CMX NON-DROP represents the real source frame index using a nominal
    // timecode base. Using nominalFps for this multiplication drifts at
    // 23.976/29.97/59.94 fps.
    const actualFps = Number.isFinite(fps) && fps > 0 ? fps : nominalFps
    const totalFrames = Math.max(0, Math.round(seconds * actualFps))
    const frames = totalFrames % nominalFps
    const totalSeconds = Math.floor(totalFrames / nominalFps)
    const secs = totalSeconds % 60
    const totalMinutes = Math.floor(totalSeconds / 60)
    const mins = totalMinutes % 60
    const hours = Math.floor(totalMinutes / 60)
    return [hours, mins, secs, frames].map((value) => String(value).padStart(2, "0")).join(":")
}

export function roughCutManifestToEdl(manifest: RoughCutManifest) {
    const title = manifest.source.fileName.replace(/\.[^.]+$/, "").slice(0, 64) || "ERABIFLOW_ROUGH_CUT"
    const lines = [`TITLE: ${title}`, "FCM: NON-DROP FRAME", ""]
    for (const entry of manifest.entries) {
        const event = String(entry.index).padStart(3, "0")
        lines.push(
            `${event}  AX       AA/V  C        ${toTimecode(entry.sourceIn, manifest.source.fps)} ${toTimecode(entry.sourceOut, manifest.source.fps)} ${toTimecode(entry.timelineIn, manifest.source.fps)} ${toTimecode(entry.timelineOut, manifest.source.fps)}`,
            `* FROM CLIP NAME: ${manifest.source.fileName}`,
            `* KEEP: ${entry.label.replace(/[\r\n]+/g, " ")}`,
            "",
        )
    }
    return lines.join("\r\n")
}

function srtTime(seconds: number) {
    const totalMs = Math.max(0, Math.round(seconds * 1000))
    const ms = totalMs % 1000
    const totalSeconds = Math.floor(totalMs / 1000)
    const secs = totalSeconds % 60
    const totalMinutes = Math.floor(totalSeconds / 60)
    const mins = totalMinutes % 60
    const hours = Math.floor(totalMinutes / 60)
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`
}

export function roughCutDocumentToSrt(document: RoughCutDocument) {
    return subtitlesToSequence(toRoughCutClips(document.timelineClips), document.subtitles)
        .filter((subtitle) => subtitle.text.trim() && subtitle.endTime > subtitle.startTime)
        .map((subtitle, index) => `${index + 1}\r\n${srtTime(subtitle.startTime)} --> ${srtTime(subtitle.endTime)}\r\n${subtitle.text.trim()}\r\n`)
        .join("\r\n")
}
