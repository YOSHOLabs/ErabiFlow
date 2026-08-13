import { Check, ExternalLink, X } from "lucide-react"
import { useState } from "react"
import { useEntitlementStore } from "@/stores/entitlement"
import { isCreatorSalesEnabled, isPublicSiteConfigured, openPublicSitePath } from "@/lib/publicSite"

export function CreatorUpgradeModal({
    isOpen,
    onClose,
    featureName,
}: {
    isOpen: boolean
    onClose: () => void
    featureName?: string
}) {
    const [token, setToken] = useState("")
    const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle")
    const plan = useEntitlementStore((state) => state.plan)
    const status = useEntitlementStore((state) => state.status)
    const installationId = useEntitlementStore((state) => state.installationId)
    const licenseId = useEntitlementStore((state) => state.licenseId)
    const expiresAt = useEntitlementStore((state) => state.expiresAt)
    const message = useEntitlementStore((state) => state.message)
    const activateLicense = useEntitlementStore((state) => state.activateLicense)
    const deactivateLicense = useEntitlementStore((state) => state.deactivateLicense)
    const setDevelopmentPlan = useEntitlementStore((state) => state.setDevelopmentPlan)
    const publicSiteReady = isPublicSiteConfigured()
    const creatorSalesEnabled = isCreatorSalesEnabled()

    if (!isOpen) return null

    const enableCreatorInDevelopment = () => {
        setDevelopmentPlan("creator")
        onClose()
    }

    const activate = async () => {
        if (!token.trim()) return
        if (await activateLicense(token.trim())) {
            setToken("")
            onClose()
        }
    }

    const copyInstallationId = async () => {
        try {
            await navigator.clipboard.writeText(installationId)
            setCopyStatus("copied")
        } catch {
            setCopyStatus("failed")
        }
        window.setTimeout(() => setCopyStatus("idle"), 2000)
    }

    const expiresLabel = expiresAt
        ? new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(expiresAt * 1000))
        : "期限なし"

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <div className="relative w-full max-w-[440px] overflow-hidden rounded border border-amber-300/20 bg-[#151518]">
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-white/[0.04] hover:text-white"
                    aria-label="閉じる"
                >
                    <X className="h-4 w-4" />
                </button>

                <div className="border-b border-amber-300/15 px-7 py-6">
                    <p className="border-l-2 border-amber-300 pl-3 text-[11px] font-medium text-amber-200">Creatorプラン</p>
                    <h2 className="mt-3 text-lg font-semibold text-zinc-50">
                        {plan === "creator"
                            ? "ErabiFlow Creator 有効"
                            : featureName ? `「${featureName}」はCreator機能です` : "ErabiFlow Creator"}
                    </h2>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                        長時間素材からより多くの見どころ候補を確認し、KEEP／没の判断を短縮するためのプランです。
                    </p>
                </div>

                <div className="p-7">
                    {plan === "creator" ? (
                        <div className="space-y-3">
                            <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.05] p-3 text-[10px] text-emerald-100">
                                <div>ライセンス: {licenseId ?? "開発版"}</div>
                                <div className="mt-1 text-emerald-200/60">有効期限: {expiresLabel}</div>
                            </div>
                            {!import.meta.env.DEV && (
                                <button
                                    type="button"
                                    onClick={() => void deactivateLicense()}
                                    className="w-full rounded-xl border border-white/[0.08] py-2.5 text-[10px] font-semibold text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
                                >
                                    このPCのCreatorライセンスを解除
                                </button>
                            )}
                        </div>
                    ) : <div className="space-y-2">
                        {[
                            "Freeより多くのハイライト候補を確認",
                            "追加候補も同じKEEP／没フローで判断",
                            "ローカル処理のまま長時間素材を整理",
                            "ラフカット動画とNLE受け渡しデータを出力",
                        ].map((item) => (
                            <div key={item} className="flex items-start gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
                                <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-amber-300" />
                                <span className="text-[10px] leading-relaxed text-zinc-300">{item}</span>
                            </div>
                        ))}
                    </div>}

                    {plan !== "creator" && import.meta.env.DEV ? (
                        <button
                            type="button"
                            onClick={enableCreatorInDevelopment}
                            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-300 py-3 text-[11px] font-bold text-amber-950 transition hover:bg-amber-200"
                        >
                            開発版をCreatorへ切り替える
                        </button>
                    ) : plan !== "creator" ? (
                        <div className="mt-5 space-y-3">
                            {creatorSalesEnabled && publicSiteReady ? (
                                <button
                                    type="button"
                                    onClick={() => void openPublicSitePath("/index.html#plans")}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] py-2.5 text-[10px] font-semibold text-amber-100 transition hover:bg-amber-300/[0.1]"
                                >
                                    料金・購入方法を見る
                                    <ExternalLink className="h-3 w-3" />
                                </button>
                            ) : (
                                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[9px] leading-relaxed text-zinc-500">
                                    Creatorの一般販売は準備中です。現在はFree版をご利用ください。
                                </div>
                            )}
                            {creatorSalesEnabled && <>
                                <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="text-[8px] uppercase tracking-[0.14em] text-zinc-600">このPCのID</div>
                                            <div className="mt-1 truncate font-mono text-[9px] text-zinc-300">{installationId || "取得中..."}</div>
                                        </div>
                                        <button type="button" disabled={!installationId} onClick={() => void copyInstallationId()} className="flex-none rounded-md border border-white/[0.07] px-2 py-1.5 text-[8px] text-zinc-400 hover:text-white disabled:opacity-30">
                                            {copyStatus === "copied" ? "コピー済み" : copyStatus === "failed" ? "コピー失敗" : "コピー"}
                                        </button>
                                    </div>
                                </div>
                                <textarea
                                    data-testid="creator-license-token"
                                    value={token}
                                    onChange={(event) => setToken(event.target.value)}
                                    rows={3}
                                    placeholder="vf1. で始まるCreatorライセンスキー"
                                    className="w-full resize-none rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2.5 font-mono text-[9px] leading-relaxed text-zinc-200 outline-none focus:border-amber-300/25"
                                />
                                {message && status !== "free" && (
                                    <div className="rounded-lg border border-red-300/15 bg-red-300/[0.05] px-3 py-2 text-[9px] leading-relaxed text-red-200">{message}</div>
                                )}
                                <button
                                    type="button"
                                    onClick={() => void activate()}
                                    disabled={!token.trim() || !installationId}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-300 py-3 text-[11px] font-bold text-amber-950 transition hover:bg-amber-200 disabled:opacity-35"
                                >
                                    ライセンスを有効化
                                </button>
                            </>}
                        </div>
                    ) : null}

                    {publicSiteReady && (
                        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-white/[0.05] pt-4 text-[8px] text-zinc-600">
                            <button type="button" onClick={() => void openPublicSitePath("/terms.html")} className="hover:text-zinc-300">利用規約</button>
                            <button type="button" onClick={() => void openPublicSitePath("/privacy.html")} className="hover:text-zinc-300">プライバシー</button>
                            <button type="button" onClick={() => void openPublicSitePath("/support.html")} className="hover:text-zinc-300">サポート</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
