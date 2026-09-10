import releaseMetadata from "../../release/metadata.json" with { type: "json" }

export type ReleaseLinkKind = "supportUrl" | "downloadUrl"

const ALLOWED_PATHS: Record<ReleaseLinkKind, string> = {
    supportUrl: "/YOSHOLabs/ErabiFlow/issues",
    downloadUrl: "/YOSHOLabs/ErabiFlow/releases",
}

export function validateReleaseUrl(kind: ReleaseLinkKind, value: string): string | null {
    try {
        const url = new URL(value)
        if (
            url.protocol !== "https:"
            || url.hostname !== "github.com"
            || url.port
            || url.username
            || url.password
            || url.search
            || url.hash
            || url.pathname !== ALLOWED_PATHS[kind]
        ) return null
        return url.href
    } catch {
        return null
    }
}

export function getConfiguredReleaseUrl(kind: ReleaseLinkKind): string | null {
    return validateReleaseUrl(kind, String(releaseMetadata[kind] || "").trim())
}
