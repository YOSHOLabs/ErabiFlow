export type ManualSaveRecoveryAction =
    | { kind: "clear"; lastSavedJson: string }
    | { kind: "save"; projectJson: string; lastSavedJson: string }

export function manualSaveRecoveryAction(
    savedProjectJson: string | undefined,
    currentProjectJson: string,
    hasInputPath: boolean,
): ManualSaveRecoveryAction {
    if (!hasInputPath) return { kind: "clear", lastSavedJson: "" }
    if (savedProjectJson === currentProjectJson) {
        return { kind: "clear", lastSavedJson: currentProjectJson }
    }
    return {
        kind: "save",
        projectJson: currentProjectJson,
        lastSavedJson: currentProjectJson,
    }
}
