import { useState } from "react"
import { Crown } from "lucide-react"
import { PRODUCT_PLANS } from "@/lib/entitlements"
import { useEntitlementStore } from "@/stores/entitlement"
import { CreatorUpgradeModal } from "@/features/premium/CreatorUpgradeModal"

/** 本番版のライセンス状態と有効化画面への入口。開発版はDevPlanSwitcherを使う。 */
export function PlanStatusButton() {
    const [open, setOpen] = useState(false)
    const plan = useEntitlementStore((state) => state.plan)
    const status = useEntitlementStore((state) => state.status)

    if (import.meta.env.DEV) return null

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[8px] font-bold tracking-[0.08em] transition ${
                    plan === "creator"
                        ? "border-amber-300/20 bg-amber-300/[0.1] text-amber-200 hover:bg-amber-300/[0.15]"
                        : "border-white/[0.07] bg-white/[0.025] text-zinc-500 hover:text-zinc-200"
                }`}
                title="プランとライセンスを確認"
            >
                <Crown className="h-3 w-3" />
                {status === "loading" ? "CHECK" : PRODUCT_PLANS[plan].shortLabel}
            </button>
            <CreatorUpgradeModal isOpen={open} onClose={() => setOpen(false)} />
        </>
    )
}
