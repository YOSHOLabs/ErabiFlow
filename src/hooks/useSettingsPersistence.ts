/**
 * useSettingsPersistence.ts — ユーザー設定の永続化フック
 *
 * enableJumpCut, jumpCutConfig, ducking 等のユーザー設定を
 * localStorage に自動保存・復元する。
 *
 * 設計方針:
 *   - ドキュメントストアにsubscribeし、設定変更時にdebounceで保存
 *   - アプリ起動時に復元
 *   - 巨大データ(解析結果等)は保存しない
 */

import { useEffect } from "react"
import { useDocumentStore } from "@/stores/document"

const STORAGE_KEY = "vfocus-user-settings"
const SETTINGS_VERSION = 2
const SAVE_DEBOUNCE_MS = 500

interface PersistedSettings {
    version: number
    enableJumpCut: boolean
    jumpCutConfig: {
        thresholdDb: number
        minDuration: number
        padding: number
    }
    enableAutoReframe: boolean
    ducking: {
        enabled: boolean
        preset: string
    }
    bgmVolume: number
}

/** 保存対象の設定値を抽出する */
function extractSettings(): PersistedSettings {
    const state = useDocumentStore.getState()
    return {
        version: SETTINGS_VERSION,
        enableJumpCut: state.processing.enableJumpCut,
        jumpCutConfig: { ...state.processing.jumpCutConfig },
        enableAutoReframe: state.processing.enableAutoReframe,
        ducking: { enabled: state.ducking.enabled, preset: state.ducking.preset },
        bgmVolume: state.bgmVolume,
    }
}

/** localStorage から設定を読み込んで適用する */
function loadSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return

        const saved: Partial<PersistedSettings> = JSON.parse(raw)
        const store = useDocumentStore.getState()
        const isLegacySettings = saved.version !== SETTINGS_VERSION

        if (saved.enableJumpCut !== undefined || saved.jumpCutConfig || saved.enableAutoReframe !== undefined) {
            store.setProcessing({
                ...(saved.enableJumpCut !== undefined && { enableJumpCut: saved.enableJumpCut }),
                // v1では顔検出が意図せず標準ONだったため、一度だけOFFへ移行する。
                enableAutoReframe: isLegacySettings ? false : (saved.enableAutoReframe ?? false),
                ...(saved.jumpCutConfig && { jumpCutConfig: { ...store.processing.jumpCutConfig, ...saved.jumpCutConfig } }),
            })
        }

        if (saved.ducking) {
            store.setDucking(saved.ducking as any)
        }

        if (saved.bgmVolume !== undefined) {
            store.setBgmVolume(saved.bgmVolume)
        }

        if (isLegacySettings) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(extractSettings()))
        }

    } catch (e) {
        console.warn("[settings] Failed to load settings:", e)
    }
}

/** localStorage に設定を保存する */
function saveSettings() {
    try {
        const settings = extractSettings()
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (e) {
        console.warn("[settings] Failed to save settings:", e)
    }
}

/**
 * アプリルートで1回だけ呼び出す。
 * - マウント時に localStorage から復元
 * - ストア変更をsubscribeしてdebounce保存
 */
export function useSettingsPersistence() {
    useEffect(() => {
        // 起動時復元
        loadSettings()

        // ストアのサブスクライブ（debounce付き）
        let timer: ReturnType<typeof setTimeout> | null = null
        const unsub = useDocumentStore.subscribe(() => {
            if (timer) clearTimeout(timer)
            timer = setTimeout(saveSettings, SAVE_DEBOUNCE_MS)
        })

        return () => {
            unsub()
            if (timer) clearTimeout(timer)
        }
    }, [])
}
