export function advancePreviewSequenceTime(
    currentTime: number,
    deltaSeconds: number,
    boundaryTime: number,
): number {
    const current = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0
    const boundary = Number.isFinite(boundaryTime) ? Math.max(0, boundaryTime) : current
    return Math.min(boundary, current + delta)
}

export function sequenceTimeFromPresentedMedia({
    mediaTime,
    mediaStart,
    sequenceStart,
    sequenceEnd,
    speed,
}: {
    mediaTime: number
    mediaStart: number
    sequenceStart: number
    sequenceEnd: number
    speed: number
}): number {
    const safeSpeed = Number.isFinite(speed) ? Math.max(0.01, speed) : 1
    const mediaOffset = Math.max(0, mediaTime - mediaStart)
    return Math.max(sequenceStart, Math.min(sequenceEnd, sequenceStart + mediaOffset / safeSpeed))
}

export function hasReachedPreviewEnd(currentTime: number, duration: number): boolean {
    return Number.isFinite(currentTime) && Number.isFinite(duration) && currentTime >= Math.max(0, duration)
}
