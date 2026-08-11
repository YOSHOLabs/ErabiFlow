import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, ClipboardList, Cpu, RefreshCw, XCircle } from "lucide-react"
import { normalizeExportError } from "@/lib/exportStatus"
import { computeRuntimeReadiness, type RuntimeCheckItem } from "@/lib/runtimeReadiness"
import { isTauriEnv } from "@/lib/utils"
import { commands, type FfmpegRuntimeStatus, type WhisperModelStatus } from "@/tauri/commands"

interface DaemonHealth {
    status?: string
    engine_loaded?: boolean
    device?: string
    hardware_gpu?: string
}

interface DaemonDiagnostics {
    alive: boolean
    pendingRequests: number
    stderrTail: string[]
    restartCount: number
    lastStartError: string | null
}

function itemClass(severity: RuntimeCheckItem["severity"]) {
    if (severity === "ok") return "border-emerald-400/15 bg-emerald-400/[0.045] text-emerald-100"
    if (severity === "error") return "border-red-400/15 bg-red-400/[0.055] text-red-100"
    return "border-amber-300/15 bg-amber-300/[0.045] text-amber-100"
}

function ItemIcon({ severity }: { severity: RuntimeCheckItem["severity"] }) {
    if (severity === "ok") return <CheckCircle2 className="h-3.5 w-3.5" />
    if (severity === "error") return <XCircle className="h-3.5 w-3.5" />
    return <AlertTriangle className="h-3.5 w-3.5" />
}

export function RuntimeCheckPanel() {
    const tauri = isTauriEnv()
    const [daemon, setDaemon] = useState<DaemonHealth | null>(null)
    const [daemonError, setDaemonError] = useState<string | null>(null)
    const [daemonDiagnostics, setDaemonDiagnostics] = useState<DaemonDiagnostics | null>(null)
    const [whisperModel, setWhisperModel] = useState<WhisperModelStatus | null>(null)
    const [whisperModelError, setWhisperModelError] = useState<string | null>(null)
    const [ffmpegRuntime, setFfmpegRuntime] = useState<FfmpegRuntimeStatus | null>(null)
    const [ffmpegRuntimeError, setFfmpegRuntimeError] = useState<string | null>(null)
    const [isChecking, setIsChecking] = useState(false)
    const [checkedAt, setCheckedAt] = useState<string | null>(null)

    const summary = useMemo(() => computeRuntimeReadiness({
        isTauri: tauri,
        daemon,
        daemonError,
        whisperModel,
        whisperModelError,
        ffmpegRuntime,
        ffmpegRuntimeError,
    }), [tauri, daemon, daemonError, ffmpegRuntime, ffmpegRuntimeError, whisperModel, whisperModelError])

    const runCheck = async () => {
        setIsChecking(true)
        setDaemonError(null)
        setDaemonDiagnostics(null)
        setWhisperModelError(null)
        setFfmpegRuntimeError(null)

        if (!tauri) {
            setCheckedAt(new Date().toISOString())
            setIsChecking(false)
            return
        }

        const [daemonResult, diagnosticsResult, whisperModelResult, ffmpegRuntimeResult] = await Promise.allSettled([
            commands.checkDaemonHealth(),
            commands.getDaemonDiagnostics(),
            commands.getWhisperModelStatus(),
            commands.getFfmpegRuntimeStatus(),
        ])

        if (daemonResult.status === "fulfilled") {
            setDaemon(daemonResult.value)
        } else {
            setDaemon(null)
            setDaemonError(normalizeExportError(daemonResult.reason))
        }

        if (diagnosticsResult.status === "fulfilled") {
            setDaemonDiagnostics(diagnosticsResult.value)
        }

        if (whisperModelResult.status === "fulfilled") {
            setWhisperModel(whisperModelResult.value)
        } else {
            setWhisperModel(null)
            setWhisperModelError(normalizeExportError(whisperModelResult.reason))
        }

        if (ffmpegRuntimeResult.status === "fulfilled") {
            setFfmpegRuntime(ffmpegRuntimeResult.value)
        } else {
            setFfmpegRuntime(null)
            setFfmpegRuntimeError(normalizeExportError(ffmpegRuntimeResult.reason))
        }

        setCheckedAt(new Date().toISOString())
        setIsChecking(false)
    }

    useEffect(() => {
        runCheck()
        // 初回表示時だけ自動チェックする。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const checkedLabel = checkedAt
        ? new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(checkedAt))
        : "未確認"

    const copyDaemonDiagnostics = () => {
        if (!daemonDiagnostics) return
        void navigator.clipboard?.writeText([
            "TateClip Daemon Diagnostics",
            `alive: ${daemonDiagnostics.alive}`,
            `pendingRequests: ${daemonDiagnostics.pendingRequests}`,
            `restartCount: ${daemonDiagnostics.restartCount}`,
            `lastStartError: ${daemonDiagnostics.lastStartError ?? "none"}`,
            "",
            "[stderr tail]",
            ...daemonDiagnostics.stderrTail,
        ].join("\n"))
    }

    return (
        <section className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
            <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-3.5 py-3">
                <div className="flex min-w-0 items-start gap-2.5">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-200">
                        <Cpu className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                        <h3 className="text-[12px] font-semibold text-zinc-100">実行環境チェック</h3>
                        <p className="mt-1 text-[9px] text-zinc-600">AI解析・書き出し前に必要なローカル環境を確認します</p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={runCheck}
                    disabled={isChecking}
                    className="flex h-7 flex-none items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.035] px-2.5 text-[10px] font-semibold text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-50"
                >
                    <RefreshCw className={`h-3 w-3 ${isChecking ? "animate-spin" : ""}`} />
                    再チェック
                </button>
            </div>

            <div className="space-y-2 p-3.5">
                <div className="grid grid-cols-3 gap-2">
                    <Metric label="AI" value={summary.canRunAi ? "OK" : "確認"} tone={summary.canRunAi ? "ok" : "warn"} />
                    <Metric label="Export" value={summary.canExport ? "OK" : "Desktop"} tone={summary.canExport ? "ok" : "warn"} />
                    <Metric label="Checked" value={checkedLabel} tone="neutral" />
                </div>

                <div className="space-y-1.5">
                    {summary.items.map((item) => (
                        <div key={item.id} className={`rounded-xl border px-3 py-2.5 ${itemClass(item.severity)}`}>
                            <div className="flex items-start gap-2">
                                <span className="mt-0.5 flex-none opacity-80">
                                    <ItemIcon severity={item.severity} />
                                </span>
                                <div className="min-w-0">
                                    <p className="text-[10px] font-semibold">{item.title}</p>
                                    <p className="mt-1 break-words text-[9px] leading-relaxed opacity-65">{item.detail}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {daemonDiagnostics && (
                    <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-300">
                                <ClipboardList className="h-3 w-3 text-cyan-300" />
                                daemon診断
                            </div>
                            <button
                                type="button"
                                onClick={copyDaemonDiagnostics}
                                className="rounded-md border border-white/[0.08] px-2 py-1 text-[9px] font-medium text-zinc-500 hover:text-cyan-200"
                            >
                                コピー
                            </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-[9px]">
                            <div className="rounded-lg bg-white/[0.025] px-2 py-1.5 text-zinc-500">
                                alive: <span className={daemonDiagnostics.alive ? "text-emerald-300" : "text-red-300"}>{daemonDiagnostics.alive ? "yes" : "no"}</span>
                            </div>
                            <div className="rounded-lg bg-white/[0.025] px-2 py-1.5 text-zinc-500">
                                pending: <span className="text-zinc-300">{daemonDiagnostics.pendingRequests}</span>
                            </div>
                            <div className="rounded-lg bg-white/[0.025] px-2 py-1.5 text-zinc-500">
                                restarts: <span className="text-zinc-300">{daemonDiagnostics.restartCount}</span>
                            </div>
                        </div>
                        {daemonDiagnostics.stderrTail.length > 0 && (
                            <div className="mt-2 max-h-28 overflow-y-auto rounded-lg bg-black/20 p-2 font-mono text-[8px] leading-relaxed text-zinc-600">
                                {daemonDiagnostics.stderrTail.slice(-8).map((line, index) => (
                                    <div key={`${index}-${line}`} className="break-words">{line}</div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <p className="px-1 text-[8px] leading-relaxed text-zinc-700">
                    メディア処理にはBtbN公式GitHubから検証付きで取得するFFmpeg（LGPL-3.0-or-later）を使用します。
                    第三者ライセンスはインストール先のTHIRD_PARTY_NOTICES.txtに記載しています。
                </p>
            </div>
        </section>
    )
}

function Metric({
    label,
    value,
    tone,
}: {
    label: string
    value: string
    tone: "ok" | "warn" | "neutral"
}) {
    const valueClass = tone === "ok" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : "text-zinc-300"
    return (
        <div className="rounded-xl border border-white/[0.06] bg-black/15 px-2.5 py-2">
            <div className="text-[8px] font-semibold uppercase tracking-[0.14em] text-zinc-700">{label}</div>
            <div className={`mt-1 truncate font-mono text-[10px] font-semibold ${valueClass}`}>{value}</div>
        </div>
    )
}
