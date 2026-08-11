import type { HighlightFeedbackSummary } from "./highlightFeedback.ts"

function metric(value: number | null): string {
    return value === null ? "" : String(value)
}

export function serializeHighlightFeedbackSummary(summary: HighlightFeedbackSummary): string {
    return `${JSON.stringify(summary, null, 2)}\n`
}

export function createHighlightFeedbackCsv(summary: HighlightFeedbackSummary): string {
    const rows: [string, string | number][] = [
        ["valid_event_count", summary.validEventCount],
        ["invalid_line_count", summary.invalidLineCount],
        ["shown_candidates", summary.shownCandidates],
        ["adopted_candidates", summary.adoptedCandidates],
        ["rejected_candidates", summary.rejectedCandidates],
        ["exported_candidates", summary.exportedCandidates],
        ["missed_ranges", summary.missedRanges],
        ["uncovered_missed_ranges", summary.uncoveredMissedRanges],
        ["accepted_per_shown", metric(summary.acceptedPerShown)],
        ["rejection_per_shown", metric(summary.rejectionPerShown)],
        ["export_per_accepted", metric(summary.exportPerAccepted)],
        ["missed_coverage", metric(summary.missedCoverage)],
        ["boundary_sample_count", summary.boundaryEdits.sampleCount],
        ["mean_start_delta_seconds", summary.boundaryEdits.meanStartDeltaSeconds],
        ["mean_end_delta_seconds", summary.boundaryEdits.meanEndDeltaSeconds],
        ...Object.entries(summary.categoryCounts).map(([category, count]) => [`category_${category}`, count] as [string, number]),
    ]
    return `metric,value\n${rows.map(([key, value]) => `${key},${value}`).join("\n")}\n`
}
