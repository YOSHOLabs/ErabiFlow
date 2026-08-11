export function normalizeExportError(error: unknown): string {
    if (error instanceof Error) {
        return error.message || error.name
    }

    if (typeof error === "string") {
        return error
    }

    if (error && typeof error === "object") {
        if ("message" in error && typeof error.message === "string") {
            return error.message
        }

        try {
            return JSON.stringify(error, null, 2)
        } catch {
            return String(error)
        }
    }

    return String(error ?? "Unknown export error")
}

export function shortExportStatus(message: string, maxLength = 120): string {
    const compact = message.replace(/\s+/g, " ").trim()
    if (compact.length <= maxLength) return compact
    return `${compact.slice(0, maxLength - 1)}…`
}
