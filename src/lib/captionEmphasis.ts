export interface CaptionChunk {
    text: string
    start: number
    end: number
    weight: number
}

export function splitCaptionChunks(text: string): CaptionChunk[] {
    const characters = Array.from(text)
    const hasWhitespace = characters.some((character) => /\s/.test(character))
    const result: CaptionChunk[] = []
    let buffer = ""
    let bufferStart = 0
    let index = 0
    let visibleCount = 0

    const push = () => {
        if (!buffer) return
        result.push({
            text: buffer,
            start: bufferStart,
            end: index,
            weight: Math.max(1, Array.from(buffer).filter((character) => !/\s/.test(character)).length),
        })
        buffer = ""
        visibleCount = 0
        bufferStart = index
    }

    for (const character of characters) {
        if (!buffer) bufferStart = index
        buffer += character
        index += character.length
        if (!/\s/.test(character)) visibleCount += 1
        if ((hasWhitespace && /\s/.test(character)) || /[、。！？!?]/.test(character) || (!hasWhitespace && visibleCount >= 3)) push()
    }
    push()
    return result
}

export function activeCaptionRange(text: string, progress: number) {
    const chunks = splitCaptionChunks(text)
    if (chunks.length === 0) return null
    const totalWeight = chunks.reduce((total, chunk) => total + chunk.weight, 0)
    const target = Math.max(0, Math.min(0.999999, progress)) * totalWeight
    let cursor = 0
    for (const chunk of chunks) {
        cursor += chunk.weight
        if (target < cursor) return { start: chunk.start, end: chunk.end }
    }
    const last = chunks.at(-1)!
    return { start: last.start, end: last.end }
}

