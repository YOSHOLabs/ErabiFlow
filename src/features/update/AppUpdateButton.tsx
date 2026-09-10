import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getVersion } from "@tauri-apps/api/app"
import { isTauri } from "@tauri-apps/api/core"
import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { CheckCircle2, Download, ExternalLink, LifeBuoy, LoaderCircle, RefreshCw, ShieldCheck, X } from "lucide-react"
import { openReleaseUrl } from "@/lib/publicSite"
import {
    releaseChannel,
    releaseChannelLabel,
    updaterEnabled,
} from "@/lib/releaseChannel"
import privacyPolicyText from "../../../docs/PRIVACY.md?raw"

type UpdateState = "idle" | "checking" | "available" | "current" | "downloading" | "error"

function readableError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    if (/example\.invalid|dns|resolve|connect|endpoint/i.test(message)) {
        return "この配布チャンネルの更新先は準備中です。"
    }
    return "更新情報を確認できませんでした。通信状態を確認して、もう一度お試しください。"
}

export function AppUpdateButton() {
    const [open, setOpen] = useState(false)
    const [state, setState] = useState<UpdateState>("idle")
    const [currentVersion, setCurrentVersion] = useState("0.1.0")
    const [candidate, setCandidate] = useState<Update | null>(null)
    const [error, setError] = useState("")
    const [downloaded, setDownloaded] = useState(0)
    const [downloadSize, setDownloadSize] = useState(0)
    const [privacyOpen, setPrivacyOpen] = useState(false)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const dialogRef = useRef<HTMLDivElement>(null)
    const closeRef = useRef<HTMLButtonElement>(null)

    const checkForUpdates = useCallback(async (quiet = false) => {
        if (!isTauri()) return
        if (!updaterEnabled) {
            if (!quiet) {
                setError("この配布チャンネルの更新先は準備中です。")
                setState("error")
            }
            return
        }

        setState("checking")
        setError("")
        try {
            const update = await check({ timeout: 15_000 })
            setCandidate(update)
            setState(update ? "available" : "current")
            if (update) setOpen(true)
        } catch (updateError) {
            setError(readableError(updateError))
            setState("error")
            if (!quiet) setOpen(true)
        }
    }, [])

    useEffect(() => {
        if (!isTauri()) return
        void getVersion().then(setCurrentVersion).catch(() => undefined)
        if (!updaterEnabled || releaseChannel === "dev") return
        const timer = window.setTimeout(() => void checkForUpdates(true), 4_000)
        return () => window.clearTimeout(timer)
    }, [checkForUpdates])

    useEffect(() => {
        if (!open) return
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        window.requestAnimationFrame(() => closeRef.current?.focus())
        return () => {
            const returnTarget = previousFocus && previousFocus !== document.body ? previousFocus : triggerRef.current
            window.requestAnimationFrame(() => returnTarget?.focus())
        }
    }, [open])

    useEffect(() => {
        if (!open) setPrivacyOpen(false)
    }, [open])

    const installUpdate = useCallback(async () => {
        if (!candidate) return
        setState("downloading")
        setDownloaded(0)
        setDownloadSize(0)
        try {
            let received = 0
            await candidate.downloadAndInstall((event) => {
                if (event.event === "Started") {
                    setDownloadSize(event.data.contentLength ?? 0)
                } else if (event.event === "Progress") {
                    received += event.data.chunkLength
                    setDownloaded(received)
                }
            })
            await relaunch()
        } catch (updateError) {
            setError(readableError(updateError))
            setState("error")
        }
    }, [candidate])

    const progress = useMemo(() => {
        if (!downloadSize) return null
        return Math.min(100, Math.round((downloaded / downloadSize) * 100))
    }, [downloadSize, downloaded])

    const openReleaseDestination = useCallback(async (
        kind: "supportUrl" | "downloadUrl",
    ) => {
        try {
            if (!await openReleaseUrl(kind)) {
                setError("案内先を開けませんでした。READMEの公開URLを確認してください。")
                setState("error")
            }
        } catch {
            setError("案内先を開けませんでした。通信状態と既定ブラウザーを確認してください。")
            setState("error")
        }
    }, [])

    const statusDot = state === "available"
        ? "bg-cyan-300"
        : state === "error"
            ? "bg-amber-300"
            : "bg-emerald-400"

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen(true)}
                className="flex h-7 items-center gap-1.5 rounded-lg border border-transparent bg-transparent px-2 text-[9px] font-medium text-zinc-400 transition hover:border-cyan-300/15 hover:bg-cyan-300/[0.04] hover:text-zinc-100"
                aria-label="バージョンと更新を確認"
            >
                <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
                Beta {currentVersion}
                {import.meta.env.DEV && <span className="text-cyan-300/80">{releaseChannelLabel[releaseChannel]}</span>}
            </button>

            {open && (
                <div
                    className="fixed inset-0 z-[120] flex items-center justify-center bg-black/65 p-6 backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="update-title"
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            event.preventDefault()
                            setOpen(false)
                            return
                        }
                        if (event.key !== "Tab") return
                        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
                            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                        ) ?? [])
                        const first = focusable[0]
                        const last = focusable.at(-1)
                        if (!first || !last) return
                        if (event.shiftKey && document.activeElement === first) {
                            event.preventDefault()
                            last.focus()
                        } else if (!event.shiftKey && document.activeElement === last) {
                            event.preventDefault()
                            first.focus()
                        }
                    }}
                >
                    <div ref={dialogRef} className="max-h-[calc(100vh-3rem)] w-full max-w-md overflow-y-auto rounded-xl border border-white/[0.1] bg-[#15181e] p-5 shadow-2xl">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                {import.meta.env.DEV && <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300">{releaseChannelLabel[releaseChannel]} channel</p>}
                                <h2 id="update-title" className="mt-1 text-base font-semibold text-zinc-100">ErabiFlow Beta — Version {currentVersion}</h2>
                            </div>
                            <button ref={closeRef} type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200" aria-label="閉じる"><X className="h-4 w-4" /></button>
                        </div>

                        <div className="mt-5 rounded-lg border border-white/[0.07] bg-black/20 p-4 text-xs text-zinc-400">
                            {!updaterEnabled && <p>初回公開版では自動更新を使用しません。新しい版はGitHub Releasesから手動でインストールしてください。</p>}
                            {updaterEnabled && state === "idle" && <p>このチャンネルの更新情報を確認できます。</p>}
                            {state === "checking" && <p className="flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin text-cyan-300" />更新情報を確認しています…</p>}
                            {state === "current" && <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" />最新バージョンです。</p>}
                            {state === "available" && candidate && (
                                <div>
                                    <p className="font-medium text-zinc-100">v{candidate.version} を利用できます。</p>
                                    {candidate.body && <p className="mt-2 whitespace-pre-wrap break-words text-zinc-500">{candidate.body}</p>}
                                </div>
                            )}
                            {state === "downloading" && (
                                <div>
                                    <p className="flex items-center gap-2"><Download className="h-4 w-4 text-cyan-300" />更新をダウンロードしています{progress === null ? "…" : `… ${progress}%`}</p>
                                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full bg-cyan-300 transition-all" style={{ width: `${progress ?? 12}%` }} /></div>
                                </div>
                            )}
                            {state === "error" && <p className="text-amber-200">{error}</p>}
                        </div>

                        <div className="mt-4 flex justify-end gap-2">
                            {!updaterEnabled ? (
                                <>
                                    <button type="button" onClick={() => void openReleaseDestination("downloadUrl")} className="flex items-center gap-1.5 rounded-md bg-cyan-300 px-3 py-2 text-xs font-semibold text-[#071014] hover:bg-cyan-200"><ExternalLink className="h-3.5 w-3.5" />GitHub Releasesを開く</button>
                                    <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-white/[0.1] px-3 py-2 text-xs font-medium text-zinc-200 hover:border-cyan-300/30">閉じる</button>
                                </>
                            ) : state === "available" && candidate ? (
                                <button type="button" onClick={() => void installUpdate()} className="rounded-md bg-cyan-300 px-3 py-2 text-xs font-semibold text-[#071014] hover:bg-cyan-200">更新して再起動</button>
                            ) : (
                                <button type="button" disabled={state === "checking" || state === "downloading"} onClick={() => void checkForUpdates(false)} className="flex items-center gap-2 rounded-md border border-white/[0.1] px-3 py-2 text-xs font-medium text-zinc-200 hover:border-cyan-300/30 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />更新を確認</button>
                            )}
                        </div>
                        <div className="mt-3 flex justify-end gap-3 border-t border-white/[0.06] pt-3 text-[10px] text-zinc-500">
                            <button type="button" onClick={() => void openReleaseDestination("supportUrl")} className="flex items-center gap-1 hover:text-zinc-200"><LifeBuoy className="h-3 w-3" />GitHub Issues</button>
                            <button type="button" aria-expanded={privacyOpen} aria-controls="bundled-privacy-policy" onClick={() => setPrivacyOpen((value) => !value)} className="flex items-center gap-1 hover:text-zinc-200"><ShieldCheck className="h-3 w-3" />{privacyOpen ? "プライバシーを閉じる" : "プライバシー"}</button>
                        </div>
                        {privacyOpen && (
                            <section id="bundled-privacy-policy" aria-labelledby="bundled-privacy-title" className="mt-4 rounded-lg border border-white/[0.08] bg-black/25 p-4 text-zinc-300">
                                <h3 id="bundled-privacy-title" className="text-sm font-semibold text-zinc-100">プライバシー方針（同梱版）</h3>
                                <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-[11px] leading-5 text-zinc-400">{privacyPolicyText}</pre>
                            </section>
                        )}
                    </div>
                </div>
            )}
        </>
    )
}
