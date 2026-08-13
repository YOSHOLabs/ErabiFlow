import { create } from "zustand"
import { normalizeProductPlan, type ProductPlan } from "@/lib/entitlements"
import { commands, type EntitlementSnapshot } from "@/tauri/commands"
import { isTauriEnv } from "@/lib/utils"

const DEVELOPMENT_PLAN_KEY = "erabiflow:development-plan"

type EntitlementSource = "default" | "development" | "license"
export type EntitlementStatus = "loading" | "free" | "creator" | "invalid" | "error"

interface EntitlementState {
    plan: ProductPlan
    source: EntitlementSource
    status: EntitlementStatus
    installationId: string
    licenseId: string | null
    expiresAt: number | null
    message: string | null
    hydrate: () => Promise<void>
    activateLicense: (token: string) => Promise<boolean>
    deactivateLicense: () => Promise<void>
    setDevelopmentPlan: (plan: ProductPlan) => void
}

function readDevelopmentPlan(): ProductPlan {
    if (!import.meta.env.DEV || typeof window === "undefined") return "free"

    try {
        return normalizeProductPlan(window.localStorage.getItem(DEVELOPMENT_PLAN_KEY))
    } catch {
        return "free"
    }
}

const initialPlan = readDevelopmentPlan()

function snapshotState(snapshot: EntitlementSnapshot) {
    return {
        plan: normalizeProductPlan(snapshot.plan),
        source: "license" as const,
        status: snapshot.status,
        installationId: snapshot.installationId,
        licenseId: snapshot.licenseId,
        expiresAt: snapshot.expiresAt,
        message: snapshot.message,
    }
}

export const useEntitlementStore = create<EntitlementState>((set) => ({
    plan: initialPlan,
    source: import.meta.env.DEV && initialPlan !== "free" ? "development" : "default",
    status: import.meta.env.DEV ? initialPlan : "loading",
    installationId: "",
    licenseId: null,
    expiresAt: null,
    message: null,
    hydrate: async () => {
        if (import.meta.env.DEV) return
        if (!isTauriEnv()) {
            set({ plan: "free", source: "default", status: "free", message: null })
            return
        }
        try {
            set(snapshotState(await commands.getEntitlement()))
        } catch (error) {
            set({
                plan: "free",
                source: "default",
                status: "error",
                message: error instanceof Error ? error.message : String(error),
            })
        }
    },
    activateLicense: async (token) => {
        if (import.meta.env.DEV) {
            set({ plan: "creator", source: "development", status: "creator", message: null })
            return true
        }
        if (!isTauriEnv()) {
            set({ status: "error", message: "ライセンス有効化はデスクトップ版で行ってください" })
            return false
        }
        try {
            set(snapshotState(await commands.activateCreatorLicense({ token })))
            return true
        } catch (error) {
            set({
                plan: "free",
                status: "invalid",
                message: error instanceof Error ? error.message : String(error),
            })
            return false
        }
    },
    deactivateLicense: async () => {
        if (import.meta.env.DEV) {
            set({ plan: "free", source: "development", status: "free", licenseId: null, expiresAt: null, message: null })
            return
        }
        try {
            set(snapshotState(await commands.deactivateCreatorLicense()))
        } catch (error) {
            set({ status: "error", message: error instanceof Error ? error.message : String(error) })
        }
    },
    setDevelopmentPlan: (plan) => {
        if (!import.meta.env.DEV) return

        try {
            window.localStorage.setItem(DEVELOPMENT_PLAN_KEY, plan)
        } catch {
            // localStorageが使えない開発環境でも、セッション中の切替は維持する。
        }
        set({ plan, source: "development", status: plan, message: null })
    },
}))
