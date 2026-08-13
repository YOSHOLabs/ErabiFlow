import { BarChart3, Database, Download, Settings2, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { save } from "@tauri-apps/plugin-dialog"
import { writeTextFile } from "@tauri-apps/plugin-fs"
import {
    clearHighlightFeedback,
    getHighlightFeedbackStatus,
    getHighlightFeedbackSummary,
    HIGHLIGHT_FEEDBACK_CHANGED_EVENT,
    isHighlightFeedbackEnabled,
    setHighlightFeedbackEnabled,
} from "@/lib/highlightFeedback"
import type { HighlightFeedbackStatus } from "@/lib/highlightFeedback"
import type { HighlightFeedbackSummary } from "@/lib/highlightFeedback"
import { createHighlightFeedbackCsv, serializeHighlightFeedbackSummary } from "@/lib/highlightFeedbackReport"

function formatBytes(bytes: number) {
    if (bytes <= 0) return "記録なし"
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatRate(value: number | null) {
    return value === null ? "—" : `${Math.round(value * 100)}%`
}

export function HighlightFeedbackControl() {
    const [enabled, setEnabled] = useState(isHighlightFeedbackEnabled)
    const [status, setStatus] = useState<HighlightFeedbackStatus | null>(null)
    const [summary, setSummary] = useState<HighlightFeedbackSummary | null>(null)
    const [confirmClear, setConfirmClear] = useState(false)
    const [message, setMessage] = useState("")
    const [busy, setBusy] = useState(false)

    const refreshStatus = async () => {
        try {
            const [nextStatus, nextSummary] = await Promise.all([
                getHighlightFeedbackStatus(),
                getHighlightFeedbackSummary(),
            ])
            setStatus(nextStatus)
            setSummary(nextSummary)
        } catch {
            setMessage("保存量を確認できません")
        }
    }

    const exportSummary = async (format: "json" | "csv") => {
        try {
            setBusy(true)
            // 追記queueが空になるまで待ち、ダイアログを開く直前の集計を書き出す。
            const latestSummary = await getHighlightFeedbackSummary()
            if (!latestSummary) {
                setMessage("デスクトップ版で集計後に書き出せます")
                return
            }
            setSummary(latestSummary)
            const path = await save({
                defaultPath: `erabiflow-highlight-feedback.${format}`,
                filters: [{ name: format === "json" ? "JSON" : "CSV", extensions: [format] }],
            })
            if (!path) return
            await writeTextFile(path, format === "json"
                ? serializeHighlightFeedbackSummary(latestSummary)
                : createHighlightFeedbackCsv(latestSummary))
            setMessage(`${format.toUpperCase()}を書き出しました`)
        } catch {
            setMessage("集計を書き出せませんでした")
        } finally {
            setBusy(false)
        }
    }

    useEffect(() => {
        const syncEnabled = () => setEnabled(isHighlightFeedbackEnabled())
        window.addEventListener(HIGHLIGHT_FEEDBACK_CHANGED_EVENT, syncEnabled)
        return () => window.removeEventListener(HIGHLIGHT_FEEDBACK_CHANGED_EVENT, syncEnabled)
    }, [])

    const toggleEnabled = async () => {
        const next = !enabled
        setEnabled(next)
        setBusy(true)
        try {
            const result = await setHighlightFeedbackEnabled(next)
            setMessage(result.persisted
                ? next ? "記録を再開しました" : "記録を停止しました"
                : next ? "今回の起動中だけ再開しました" : "今回の起動中だけ停止しました")
        } catch {
            setEnabled(!next)
            setMessage("設定を変更できませんでした")
        } finally {
            setBusy(false)
        }
    }

    const handleClear = async () => {
        if (!confirmClear) {
            setConfirmClear(true)
            setMessage("もう一度押すと履歴を削除します")
            return
        }
        try {
            setBusy(true)
            await clearHighlightFeedback()
            setConfirmClear(false)
            setMessage("履歴を削除しました")
            await refreshStatus()
        } catch {
            setMessage("履歴を削除できませんでした")
        } finally {
            setBusy(false)
        }
    }

    return (
        <details
            className="group relative"
            onToggle={(event) => {
                if (event.currentTarget.open) void refreshStatus()
            }}
        >
            <summary
                className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-transparent text-zinc-400 transition hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-zinc-100 [&::-webkit-details-marker]:hidden"
                aria-label="ローカル編集履歴の設定"
                title="ローカル編集履歴"
            >
                <Settings2 className="h-4 w-4" />
            </summary>
            <div className="absolute right-0 top-11 z-[100] w-80 rounded-xl border border-white/10 bg-[#111821] p-3 shadow-2xl">
                <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 rounded-lg bg-cyan-300/[0.08] p-1.5 text-cyan-200">
                        <Database className="h-3.5 w-3.5" />
                    </span>
                    <div>
                        <p className="text-[11px] font-semibold text-zinc-100">ローカル編集履歴</p>
                        <p className="mt-1 text-[9px] leading-relaxed text-zinc-500">
                            候補操作・候補区間・4軸スコアと、手動追加した見逃し区間の種類・時間だけを端末内に保存します。動画、パス、字幕、候補文は保存しません。
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    onClick={() => void toggleEnabled()}
                    disabled={busy}
                    className="mt-3 flex w-full items-center justify-between rounded-lg border border-white/[0.07] bg-black/15 px-2.5 py-2 text-left"
                >
                    <span className="text-[10px] font-medium text-zinc-300">編集結果を記録</span>
                    <span className={`relative h-5 w-9 rounded-full transition ${enabled ? "bg-cyan-300" : "bg-zinc-700"}`}>
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${enabled ? "left-[18px]" : "left-0.5"}`} />
                    </span>
                </button>
                <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/15 p-2.5" data-testid="highlight-feedback-summary">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-300"><BarChart3 className="h-3 w-3" />候補の利用状況</span>
                        <span className="text-[8px] text-zinc-600">端末内集計</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                        {[
                            ["採用率", formatRate(summary?.acceptedPerShown ?? null)],
                            ["却下率", formatRate(summary?.rejectionPerShown ?? null)],
                            ["出力到達", formatRate(summary?.exportPerAccepted ?? null)],
                            ["見逃し", summary ? String(summary.missedRanges) : "—"],
                            ["未カバー", summary ? String(summary.uncoveredMissedRanges) : "—"],
                            ["境界 前/後", summary?.boundaryEdits.sampleCount
                                ? `${summary.boundaryEdits.meanStartDeltaSeconds.toFixed(1)}/${summary.boundaryEdits.meanEndDeltaSeconds.toFixed(1)}s`
                                : "—"],
                        ].map(([label, value]) => (
                            <div key={label} className="rounded-md border border-white/[0.05] px-1.5 py-1.5 text-center">
                                <div className="text-[8px] text-zinc-600">{label}</div>
                                <div className="mt-0.5 font-mono text-[10px] text-zinc-200">{value}</div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                        <button type="button" onClick={() => void exportSummary("json")} disabled={busy || !summary} className="flex items-center justify-center gap-1 rounded-md border border-white/[0.06] py-1 text-[8px] text-zinc-500 hover:text-zinc-200 disabled:opacity-35"><Download className="h-2.5 w-2.5" />JSON</button>
                        <button type="button" onClick={() => void exportSummary("csv")} disabled={busy || !summary} className="flex items-center justify-center gap-1 rounded-md border border-white/[0.06] py-1 text-[8px] text-zinc-500 hover:text-zinc-200 disabled:opacity-35"><Download className="h-2.5 w-2.5" />CSV</button>
                    </div>
                    <p className="mt-1.5 text-[8px] text-zinc-700">正解ラベルによる検出精度ではありません</p>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[9px] text-zinc-600">
                        保存量 {status ? formatBytes(status.bytes + status.previousBytes) : "—"}
                    </span>
                    <button
                        type="button"
                        onClick={() => void handleClear()}
                        disabled={busy}
                        onBlur={() => setConfirmClear(false)}
                        className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] transition ${
                            confirmClear
                                ? "border-red-300/30 bg-red-300/10 text-red-200"
                                : "border-white/[0.07] text-zinc-500 hover:border-red-300/20 hover:text-red-200"
                        }`}
                    >
                        <Trash2 className="h-3 w-3" />
                        {confirmClear ? "もう一度押して削除" : "履歴を削除"}
                    </button>
                </div>
                {message && <p role="status" className="mt-2 text-[9px] text-zinc-500">{message}</p>}
            </div>
        </details>
    )
}
