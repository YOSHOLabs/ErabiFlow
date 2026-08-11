import { openUrl } from "@tauri-apps/plugin-opener"
import { isTauriEnv } from "./utils"
import { buildPublicSiteUrl } from "./publicSiteUrl"
import releaseMetadata from "../../release/metadata.json"

export { buildPublicSiteUrl } from "./publicSiteUrl"

const FALLBACK_PUBLIC_SITE_ORIGIN = "https://example.invalid"

export function getConfiguredPublicSiteUrl(path: string): string | null {
    const configured = releaseMetadata.publicSiteUrl?.trim() || FALLBACK_PUBLIC_SITE_ORIGIN
    return buildPublicSiteUrl(configured, path)
}

export function isPublicSiteConfigured(): boolean {
    const url = getConfiguredPublicSiteUrl("/")
    return Boolean(url && !url.includes("example.invalid"))
}

/** Creatorの購入・ライセンス入力は一般販売を明示的に有効化した時だけ表示する。 */
export function isCreatorSalesEnabled(): boolean {
    return releaseMetadata.salesEnabled === true
}

/** 設定済みの同一HTTPSオリジンだけをOS標準ブラウザで開く。 */
export async function openPublicSitePath(path: string): Promise<boolean> {
    const url = getConfiguredPublicSiteUrl(path)
    if (!url || !isPublicSiteConfigured()) return false

    if (isTauriEnv()) {
        await openUrl(url)
        return true
    }

    const opened = window.open(url, "_blank", "noopener,noreferrer")
    return opened !== null
}
