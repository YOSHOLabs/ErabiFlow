/**
 * 公開サイトの設定オリジン内だけへ遷移できるURLを作る。
 * アプリの特権WebViewから任意の外部URLを開かないための純粋関数。
 */
export function buildPublicSiteUrl(origin: string, path: string): string | null {
    let base: URL
    let target: URL
    try {
        base = new URL(origin)
        target = new URL(path, base)
    } catch {
        return null
    }

    if (base.protocol !== "https:" || base.username || base.password) return null
    if (base.pathname !== "/" || base.search || base.hash) return null
    if (target.protocol !== "https:" || target.origin !== base.origin) return null
    return target.toString()
}
