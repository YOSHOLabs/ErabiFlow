/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_TATECLIP_CHANNEL?: "dev" | "beta" | "stable"
    readonly VITE_TATECLIP_UPDATER_ENABLED?: "true" | "false"
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
