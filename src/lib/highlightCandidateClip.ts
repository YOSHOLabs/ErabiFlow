export function highlightCandidateId(analysisId: string, index: number): string {
    return `${analysisId}:candidate:${index}`
}

export function highlightCandidateClipPrefix(analysisId: string, index: number): string {
    return `${highlightCandidateId(analysisId, index)}:clip:`
}

/** 同じ時間範囲の手動クリップを巻き込まないよう、候補由来IDだけを正本にする。 */
export function isHighlightCandidateClipId(clipId: string, analysisId: string, index: number): boolean {
    return clipId.startsWith(highlightCandidateClipPrefix(analysisId, index))
}

export function parseHighlightCandidateClipId(clipId: string): {
    analysisId: string
    candidateId: string
    candidateIndex: number
} | null {
    const match = clipId.match(/^([A-Za-z0-9_-]+):candidate:(\d+):clip:/)
    if (!match) return null
    const candidateIndex = Number(match[2])
    if (!Number.isSafeInteger(candidateIndex)) return null
    return {
        analysisId: match[1],
        candidateId: highlightCandidateId(match[1], candidateIndex),
        candidateIndex,
    }
}
