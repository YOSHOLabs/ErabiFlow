import type { TextSegment } from "./types.ts"

function parseTime(value: string) {
    const match = /^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value.trim())
    if (!match) return null
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000
}

function formatTime(value: number) {
    const totalMs = Math.max(0, Math.round(value * 1000))
    const hours = Math.floor(totalMs / 3_600_000)
    const minutes = Math.floor(totalMs % 3_600_000 / 60_000)
    const seconds = Math.floor(totalMs % 60_000 / 1000)
    const ms = totalMs % 1000
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(ms).padStart(3, "0")}`
}

export function parseSrt(input: string): TextSegment[] {
    return input.replace(/^\uFEFF/, "").split(/\r?\n\s*\r?\n/).flatMap((block, index) => {
        const lines = block.trim().split(/\r?\n/)
        const timingIndex = lines.findIndex((line) => line.includes("-->"))
        if (timingIndex < 0) return []
        const [rawStart, rawEnd] = lines[timingIndex].split("-->")
        const start = parseTime(rawStart)
        const end = parseTime(rawEnd?.trim().split(/\s+/)[0] ?? "")
        if (start === null || end === null || end <= start) return []
        let text = lines.slice(timingIndex + 1).join("\n").trim()
        const speakerMatch = /^\[([^\]]+)]\s*/.exec(text)
        if (speakerMatch) text = text.slice(speakerMatch[0].length)
        return [{ id: globalThis.crypto?.randomUUID?.() ?? `srt-${Date.now()}-${index}`, start, end, text, ...(speakerMatch ? { speaker: speakerMatch[1] } : {}) }]
    }).sort((a, b) => a.start - b.start)
}

export function createSrt(subtitles: readonly TextSegment[]) {
    return [...subtitles].sort((a, b) => a.start - b.start).map((subtitle, index) => [
        index + 1,
        `${formatTime(subtitle.start)} --> ${formatTime(subtitle.end)}`,
        `${subtitle.speaker ? `[${subtitle.speaker}] ` : ""}${subtitle.text}`,
    ].join("\r\n")).join("\r\n\r\n") + (subtitles.length ? "\r\n" : "")
}

/** 分離済み音声トラックを優先し、混合音声では長い間を会話ターン境界として推定する。 */
export function assignSpeakerLabels(subtitles: readonly TextSegment[]): TextSegment[] {
    let turn = 0
    return [...subtitles].sort((a, b) => a.start - b.start).map((subtitle, index, ordered) => {
        const previous = ordered[index - 1]
        if (previous && subtitle.sourceTrack === undefined && subtitle.start - previous.end >= 0.8) turn = (turn + 1) % 2
        const speaker = subtitle.sourceTrack !== undefined ? `話者 ${subtitle.sourceTrack + 1}` : `話者 ${turn + 1}`
        return { ...subtitle, speaker }
    })
}
