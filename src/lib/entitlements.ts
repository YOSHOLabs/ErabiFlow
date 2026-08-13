/**
 * ErabiFlowの商品プランと機能権限。
 *
 * 編集ドキュメントとは分離し、プロジェクトファイルへは保存しない。
 * 将来はライセンスサーバーが返す署名済み権限をこのモデルへ変換する。
 */

export type ProductPlan = "free" | "creator"

export type ProductCapability =
    | "ai.autoReframe"
    | "ai.silenceCut"
    | "ai.audioDucking"
    | "clips.extendedCandidates"
    | "clips.batchCreate"
    | "export.batch"

export interface ProductPlanDefinition {
    id: ProductPlan
    label: string
    shortLabel: string
    description: string
    capabilities: readonly ProductCapability[]
}

const CREATOR_CAPABILITIES = [
    "ai.autoReframe",
    "ai.silenceCut",
    "ai.audioDucking",
    "clips.extendedCandidates",
    "clips.batchCreate",
    "export.batch",
] as const satisfies readonly ProductCapability[]

export const PRODUCT_PLANS: Record<ProductPlan, ProductPlanDefinition> = {
    free: {
        id: "free",
        label: "ErabiFlow Free",
        shortLabel: "FREE",
        description: "見どころを判断し、ラフカットを受け渡す基本プラン",
        capabilities: [],
    },
    creator: {
        id: "creator",
        label: "ErabiFlow Creator",
        shortLabel: "CREATOR",
        description: "より多くの候補から長時間素材を判断するプラン",
        capabilities: CREATOR_CAPABILITIES,
    },
}

export function hasCapability(plan: ProductPlan, capability: ProductCapability): boolean {
    return PRODUCT_PLANS[plan].capabilities.includes(capability)
}

export function normalizeProductPlan(value: unknown): ProductPlan {
    return value === "creator" ? "creator" : "free"
}
