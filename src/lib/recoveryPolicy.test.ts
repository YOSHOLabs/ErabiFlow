import test from "node:test"
import assert from "node:assert/strict"
import { manualSaveRecoveryAction } from "./recoveryPolicy.ts"

test("保存完了時のdocumentが保存snapshotと同じなら復旧データを消す", () => {
    assert.deepEqual(manualSaveRecoveryAction("saved", "saved", true), {
        kind: "clear",
        lastSavedJson: "saved",
    })
})

test("保存中に編集された最新documentは復旧snapshotとして残す", () => {
    assert.deepEqual(manualSaveRecoveryAction("old", "edited-during-save", true), {
        kind: "save",
        projectJson: "edited-during-save",
        lastSavedJson: "edited-during-save",
    })
})

test("空の新規projectでは復旧データを消す", () => {
    assert.deepEqual(manualSaveRecoveryAction(undefined, "empty-project", false), {
        kind: "clear",
        lastSavedJson: "",
    })
})
