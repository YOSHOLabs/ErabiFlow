import { useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, CheckCircle2, Crown, Film, RotateCcw, Square, Trash2, XCircle } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { requestCreatorBatchStop, runCreatorBatch } from "@/controllers/backgroundJobs"
import { hasCapability } from "@/lib/entitlements"
import { isActiveBackgroundJob } from "@/lib/backgroundJob"
import { isTauriEnv } from "@/lib/utils"
import { useBackgroundJobStore } from "@/stores/backgroundJobs"
import { useDocumentStore } from "@/stores/document"
import { useEntitlementStore } from "@/stores/entitlement"
import { CreatorUpgradeModal } from "@/features/premium/CreatorUpgradeModal"

function formatRange(start: number, end: number) {
    const value = (seconds: number) => {
        const minutes = Math.floor(seconds / 60)
        return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, "0")}`
    }
    return `${value(start)} – ${value(end)} · ${(end - start).toFixed(1)}秒`
}

export function CreatorBatchPanel() {
    const plan = useEntitlementStore((s) => s.plan)
    const canBatchExport = hasCapability(plan, "export.batch")
    const queue = useDocumentStore((s) => s.creatorBatch)
    const setQueue = useDocumentStore((s) => s.setCreatorBatch)
    const updateItem = useDocumentStore((s) => s.updateCreatorBatchClip)
    const removeItem = useDocumentStore((s) => s.removeCreatorBatchClip)
    const clearQueue = useDocumentStore((s) => s.clearCreatorBatch)
    const processing = useDocumentStore((s) => s.processing)
    const inputPath = useDocumentStore((s) => s.inputPath)
    const batchJob = useBackgroundJobStore((state) => state.jobs["creator-batch"])
    const results = batchJob?.itemResults ?? {}
    const batchRunning = isActiveBackgroundJob(batchJob)
    const [showUpgrade, setShowUpgrade] = useState(false)
    const hiddenVideoRef = useRef<HTMLVideoElement>(null)

    const videoUrl = useMemo(() => {
        if (!inputPath || !processing.enableAutoReframe || !isTauriEnv()) return null
        const protocol = /Windows/i.test(navigator.userAgent) ? "http://vfocus.localhost" : "vfocus://"
        return `${protocol}/media/${encodeURIComponent(inputPath)}`
    }, [inputPath, processing.enableAutoReframe])

    if (!canBatchExport && queue.length === 0) return null

    const moveItem = (index: number, delta: number) => {
        const target = index + delta
        if (target < 0 || target >= queue.length || processing.isProcessing) return
        const next = [...queue]
        ;[next[index], next[target]] = [next[target], next[index]]
        setQueue(next)
    }

    const runBatch = async (onlyIds?: Set<string>) => {
        if (!canBatchExport) {
            setShowUpgrade(true)
            return
        }
        if (!isTauriEnv() || processing.isProcessing || queue.length === 0) return

        await runCreatorBatch({ video: hiddenVideoRef.current, onlyIds })
    }

    const failedIds = new Set(Object.entries(results).filter(([, result]) => result.state === "failed").map(([id]) => id))

    return (
        <>
            {videoUrl && <video ref={hiddenVideoRef} src={videoUrl} crossOrigin="anonymous" className="hidden" preload="auto" />}
            <section data-testid="creator-batch-panel" className="overflow-hidden rounded-2xl border border-amber-300/15 bg-amber-300/[0.025]">
                <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-3.5 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-300/10 text-amber-200">
                            <Crown className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                            <h3 className="truncate text-[12px] font-semibold text-zinc-100">複数クリップ書き出し</h3>
                            <p className="truncate text-[9px] text-zinc-600">候補ごとに別のMP4を連続生成</p>
                        </div>
                    </div>
                    <span className="rounded-full border border-amber-300/15 bg-amber-300/[0.06] px-2 py-1 text-[8px] font-semibold text-amber-200">
                        {queue.length}本
                    </span>
                </header>

                <div className="space-y-3 p-3.5">
                    {queue.length > 0 ? (
                        <div className="space-y-2">
                            {queue.map((item, index) => {
                                const result = results[item.id] ?? { state: "pending" as const }
                                return (
                                    <div key={item.id} data-testid={`creator-queue-item-${index}`} className="rounded-xl border border-white/[0.06] bg-black/20 p-2.5">
                                        <div className="flex items-start gap-2">
                                            <span className="mt-1 font-mono text-[9px] text-zinc-600">{String(index + 1).padStart(2, "0")}</span>
                                            <div className="min-w-0 flex-1">
                                                <input
                                                    aria-label={`クリップ${index + 1}のタイトル`}
                                                    value={item.title}
                                                    disabled={processing.isProcessing}
                                                    onChange={(event) => updateItem(item.id, { title: event.target.value })}
                                                    className="w-full rounded-md border border-white/[0.06] bg-black/20 px-2 py-1.5 text-[10px] font-semibold text-zinc-100 outline-none focus:border-amber-300/25"
                                                />
                                                <p className="mt-1 truncate text-[8px] text-zinc-600">{formatRange(item.mediaStart, item.mediaEnd)}</p>
                                            </div>
                                            <div className="flex gap-0.5">
                                                <QueueIconButton label="上へ" disabled={index === 0 || processing.isProcessing} onClick={() => moveItem(index, -1)}><ArrowUp /></QueueIconButton>
                                                <QueueIconButton label="下へ" disabled={index === queue.length - 1 || processing.isProcessing} onClick={() => moveItem(index, 1)}><ArrowDown /></QueueIconButton>
                                                <QueueIconButton label="削除" disabled={processing.isProcessing} onClick={() => removeItem(item.id)}><Trash2 /></QueueIconButton>
                                            </div>
                                        </div>
                                        {result.state !== "pending" && (
                                            <div className={`mt-2 flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[8px] ${
                                                result.state === "success" ? "bg-emerald-400/[0.07] text-emerald-200" :
                                                    result.state === "failed" ? "bg-red-400/[0.07] text-red-200" : "bg-cyan-400/[0.07] text-cyan-200"
                                            }`}>
                                                {result.state === "success" ? <CheckCircle2 className="h-3 w-3 flex-none" /> : result.state === "failed" ? <XCircle className="h-3 w-3 flex-none" /> : <Film className="h-3 w-3 flex-none animate-pulse" />}
                                                <span className="min-w-0 break-all">{result.outputPath ?? result.error ?? "書き出し中..."}</span>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <div className="rounded-xl border border-dashed border-white/[0.08] px-3 py-5 text-center text-[10px] text-zinc-600">
                            上のAI候補から「書き出しリストに追加」を選びます。候補ごとに別々のMP4を作ります。
                        </div>
                    )}

                    {batchRunning && batchJob && (
                        <div className="rounded-xl border border-cyan-300/10 bg-cyan-300/[0.035] p-3">
                            <div className="mb-2 flex items-center justify-between gap-2 text-[9px] text-cyan-100">
                                <span className="truncate">{batchJob.message}</span>
                                <span className="font-mono">{Math.round(batchJob.detailProgress ?? batchJob.progress)}%</span>
                            </div>
                            <Progress value={batchJob.detailProgress ?? batchJob.progress} />
                        </div>
                    )}

                    <div className="grid grid-cols-[1fr_auto] gap-2">
                        <button
                            type="button"
                            data-testid="creator-batch-export"
                            disabled={queue.length === 0 || (processing.isProcessing && !batchRunning) || (!isTauriEnv() && canBatchExport)}
                            onClick={() => batchRunning ? requestCreatorBatchStop() : void runBatch()}
                            className="flex items-center justify-center gap-2 rounded-xl bg-amber-300 px-3 py-2.5 text-[10px] font-bold text-amber-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                            {batchRunning ? <><Square className="h-3 w-3" />現在の1本で停止</> : <><Film className="h-3.5 w-3.5" />{queue.length}本を書き出す</>}
                        </button>
                        <button type="button" disabled={processing.isProcessing || queue.length === 0} onClick={clearQueue} className="rounded-xl border border-white/[0.07] px-3 text-[9px] text-zinc-500 hover:text-zinc-200 disabled:opacity-30">全削除</button>
                    </div>

                    {!isTauriEnv() && canBatchExport && (
                        <p className="text-center text-[8px] text-zinc-600">実際の書き出しはデスクトップ版で利用できます。</p>
                    )}
                    {failedIds.size > 0 && !processing.isProcessing && (
                        <button type="button" onClick={() => void runBatch(failedIds)} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-300/15 bg-red-300/[0.04] py-2 text-[9px] text-red-200 hover:bg-red-300/[0.08]">
                            <RotateCcw className="h-3 w-3" />失敗した{failedIds.size}本だけ再実行
                        </button>
                    )}
                </div>
            </section>
            <CreatorUpgradeModal isOpen={showUpgrade} onClose={() => setShowUpgrade(false)} featureName="Creator一括書き出し" />
        </>
    )
}

function QueueIconButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactElement<{ className?: string }> }) {
    return (
        <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-600 hover:bg-white/[0.05] hover:text-zinc-200 disabled:opacity-20">
            {children}
        </button>
    )
}
