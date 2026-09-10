export interface AnalysisErrorState {
    jobId: string
    sourcePath: string
    message: string
}

export function visibleAnalysisError(
    error: AnalysisErrorState | null,
    currentSourcePath: string | null,
    currentJobIds: readonly string[],
): string {
    return error?.sourcePath === currentSourcePath && currentJobIds.includes(error.jobId)
        ? error.message
        : ""
}
