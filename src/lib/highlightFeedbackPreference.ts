export function readHighlightFeedbackEnabled(read: () => string | null): boolean {
    try {
        return read() !== "0"
    } catch {
        return true
    }
}

export function persistHighlightFeedbackEnabled(enabled: boolean, write: (value: string) => void): boolean {
    try {
        write(enabled ? "1" : "0")
        return true
    } catch {
        return false
    }
}
