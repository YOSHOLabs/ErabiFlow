import type { PreflightItem, PreflightSeverity, PreflightSummary } from "@/lib/preflight"

const SEVERITY_STYLE: Record<PreflightSeverity, {
    row: string
    title: string
}> = {
    error: {
        row: "border-red-400/35",
        title: "text-red-100",
    },
    warning: {
        row: "border-amber-300/35",
        title: "text-amber-100",
    },
    info: {
        row: "border-white/[0.12]",
        title: "text-zinc-200",
    },
    ok: {
        row: "border-emerald-400/35",
        title: "text-emerald-100",
    },
}

function formatTime(seconds: number) {
    const minutes = Math.floor(seconds / 60)
    const rest = Math.floor(seconds % 60).toString().padStart(2, "0")
    return `${minutes}:${rest}`
}

export function ExportPreflightPanel({ summary }: { summary: PreflightSummary }) {
    const priorityItems = [
        ...summary.items.filter((item) => item.severity === "error"),
        ...summary.items.filter((item) => item.severity === "warning"),
        ...summary.items.filter((item) => item.severity === "ok").slice(0, 2),
        ...summary.items.filter((item) => item.severity === "info").slice(0, 2),
    ].slice(0, 6)

    return (
        <section className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
            <div className="flex items-start justify-between gap-3">
                <div className={`border-l-2 pl-3 ${summary.canExport ? "border-emerald-300" : "border-red-300"}`}>
                    <div>
                        <h3 className="text-[12px] font-semibold text-zinc-100">書き出し前チェック</h3>
                        <p className="text-[9px] text-zinc-600">
                            {summary.canExport ? "書き出し可能です" : "修正が必要です"}
                        </p>
                    </div>
                </div>

                <div className="text-right">
                    <p className="font-mono text-[13px] font-semibold text-zinc-100">{formatTime(summary.sequenceDuration)}</p>
                    <p className="mt-0.5 text-[9px] text-zinc-600">
                        {summary.sequenceClipCount} clips · {summary.subtitleCount} subs
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-1">
                <Badge label="エラー" value={summary.counts.error} tone={summary.counts.error > 0 ? "error" : "ok"} />
                <Badge label="警告" value={summary.counts.warning} tone={summary.counts.warning > 0 ? "warning" : "ok"} />
                <Badge label="要確認字幕" value={summary.reviewSubtitleCount} tone={summary.reviewSubtitleCount > 0 ? "warning" : "ok"} />
            </div>

            <div className="space-y-1.5">
                {priorityItems.map((item) => (
                    <PreflightRow key={item.id} item={item} />
                ))}
            </div>
        </section>
    )
}

function Badge({
    label,
    value,
    tone,
}: {
    label: string
    value: number
    tone: "error" | "warning" | "ok"
}) {
    const className = tone === "error"
        ? "border-red-400/30 text-red-200"
        : tone === "warning"
            ? "border-amber-300/30 text-amber-200"
            : "border-emerald-400/25 text-emerald-200"

    return (
        <div className={`border-b px-2 py-1.5 text-center ${className}`}>
            <div className="font-mono text-[13px] font-semibold">{value}</div>
            <div className="mt-0.5 text-[8px] tracking-wider opacity-60">{label}</div>
        </div>
    )
}

function PreflightRow({ item }: { item: PreflightItem }) {
    const style = SEVERITY_STYLE[item.severity]
    return (
        <div className={`border-l-2 px-3 py-2 ${style.row}`}>
            <div className="min-w-0">
                <p className={`text-[10px] font-semibold ${style.title}`}>{item.title}</p>
                <p className="mt-0.5 text-[9px] leading-relaxed text-zinc-500">{item.detail}</p>
            </div>
        </div>
    )
}
