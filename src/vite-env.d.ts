/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_ERABIFLOW_CHANNEL?: "dev" | "beta" | "stable"
    readonly VITE_ERABIFLOW_UPDATER_ENABLED?: "true" | "false"
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
