import { PRODUCT_PLANS, type ProductPlan } from "@/lib/entitlements"
import { useEntitlementStore } from "@/stores/entitlement"

const PLAN_ORDER: ProductPlan[] = ["free", "creator"]

export function DevPlanSwitcher() {
    const plan = useEntitlementStore((state) => state.plan)
    const setDevelopmentPlan = useEntitlementStore((state) => state.setDevelopmentPlan)

    if (!import.meta.env.DEV) return null

    return (
        <div
            className="flex h-7 items-center overflow-hidden rounded-lg border border-white/[0.07] bg-black/10"
            title="開発版専用: Free / Creator表示を切り替えます"
        >
            {PLAN_ORDER.map((id) => {
                const active = plan === id
                return (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setDevelopmentPlan(id)}
                        aria-pressed={active}
                        className={`h-full px-2.5 text-[8px] font-bold tracking-[0.08em] transition ${
                            active
                                ? id === "creator"
                                    ? "bg-amber-300 text-amber-950"
                                    : "bg-zinc-200 text-zinc-950"
                                : "text-zinc-600 hover:bg-white/[0.05] hover:text-zinc-300"
                        }`}
                    >
                        {PRODUCT_PLANS[id].shortLabel}
                    </button>
                )
            })}
        </div>
    )
}
