export function mixPreviewVolume(...levels: number[]): number {
    return levels.reduce((mixed, level) => {
        const safe = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 1
        return mixed * safe
    }, 1)
}
