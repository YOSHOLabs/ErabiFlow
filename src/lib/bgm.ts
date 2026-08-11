export interface BgmTiming {
    sequenceDuration: number
    start: number
    end: number | null
    trimStart: number
    sourceDuration: number | null
}

/**
 * 明示的な終端、BGM素材の残り尺、動画シーケンス終端のうち最も早い位置を返す。
 * 素材尺がまだ取得できていない場合はシーケンス終端を使う。
 */
export function getEffectiveBgmEnd(timing: BgmTiming): number {
    const sequenceEnd = Math.max(0, timing.sequenceDuration)
    const start = Math.max(0, Math.min(timing.start, sequenceEnd))
    const naturalEnd = timing.sourceDuration !== null && Number.isFinite(timing.sourceDuration)
        ? start + Math.max(0, timing.sourceDuration - Math.max(0, timing.trimStart))
        : sequenceEnd
    const requestedEnd = timing.end ?? naturalEnd
    return Math.max(start, Math.min(sequenceEnd, naturalEnd, requestedEnd))
}

export function getBgmPlaybackDuration(timing: BgmTiming): number {
    return Math.max(0, getEffectiveBgmEnd(timing) - Math.max(0, timing.start))
}
