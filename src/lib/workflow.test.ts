import test from "node:test"
import assert from "node:assert/strict"
import { computeWorkflowPresentation, computeWorkflowSummary } from "./workflow.ts"

function document(overrides: Record<string, unknown> = {}) {
    return {
        inputPath: "",
        videoInfo: null,
        timelineClips: [],
        trim: { start: 0, end: 0, previewTime: 0 },
        subtitles: [],
        text: { content: "" },
        bgmPath: "",
        seSlots: [],
        recommendedCuts: [],
        analysisArtifacts: [],
        agentThinking: "",
        ...overrides,
    } as any
}

test("素材未選択では素材工程が次の行動になる", () => {
    const summary = computeWorkflowSummary(document())

    assert.equal(summary.activeStepId, "source")
    assert.equal(summary.steps.find((step) => step.id === "source")?.state, "active")
    assert.equal(summary.steps.find((step) => step.id === "analysis")?.state, "locked")
    assert.equal(summary.stats.exportErrors, 3)
})

test("素材読み込み直後はAI初稿工程を促し、仕上げと出力は完了扱いにしない", () => {
    const summary = computeWorkflowSummary(document({
        inputPath: "C:\\video.mp4",
        videoInfo: { duration: 120, width: 1920, height: 1080 },
        timelineClips: [],
    }))

    assert.equal(summary.activeStepId, "analysis")
    assert.equal(summary.steps.find((step) => step.id === "source")?.state, "complete")
    assert.equal(summary.steps.find((step) => step.id === "analysis")?.state, "active")
    assert.equal(summary.steps.find((step) => step.id === "review")?.state, "locked")
    assert.equal(summary.steps.find((step) => step.id === "edit")?.state, "locked")
    assert.equal(summary.steps.find((step) => step.id === "export")?.state, "locked")
    assert.equal(summary.stats.adoptedClipCount, 0)
    assert.equal(summary.stats.exportErrors, 1)
})

test("AI初稿があるのに候補未採用ならレビュー工程を促す", () => {
    const summary = computeWorkflowSummary(document({
        inputPath: "C:\\video.mp4",
        videoInfo: { duration: 120, width: 1920, height: 1080 },
        recommendedCuts: [
            { start: 10, end: 25, label: "見どころ", reason: "盛り上がり", excitement: 88 },
        ],
        timelineClips: [{ id: "source", mediaStart: 0, mediaEnd: 120 }],
    }))

    assert.equal(summary.activeStepId, "review")
    assert.equal(summary.steps.find((step) => step.id === "analysis")?.state, "complete")
    assert.equal(summary.steps.find((step) => step.id === "review")?.state, "attention")
    assert.equal(summary.stats.adoptedClipCount, 0)
})

test("採用済みシーケンスに要確認字幕があれば仕上げ工程を促す", () => {
    const summary = computeWorkflowSummary(document({
        inputPath: "C:\\video.mp4",
        videoInfo: { duration: 120, width: 1920, height: 1080 },
        recommendedCuts: [
            { start: 10, end: 25, label: "見どころ", reason: "盛り上がり", excitement: 88 },
        ],
        timelineClips: [{ id: "clip1", mediaStart: 10, mediaEnd: 25 }],
        subtitles: [
            { id: "sub1", text: "怪しい字幕", start: 12, end: 14, flags: ["needs_review"] },
        ],
    }))

    assert.equal(summary.activeStepId, "edit")
    assert.equal(summary.steps.find((step) => step.id === "review")?.state, "complete")
    assert.equal(summary.steps.find((step) => step.id === "edit")?.state, "attention")
    assert.equal(summary.stats.reviewSubtitleCount, 1)
})

test("警告なしで書き出せる状態では出力工程が次の行動になる", () => {
    const summary = computeWorkflowSummary(document({
        inputPath: "C:\\video.mp4",
        videoInfo: { duration: 120, width: 1920, height: 1080 },
        recommendedCuts: [
            { start: 10, end: 25, label: "見どころ", reason: "盛り上がり", excitement: 88 },
        ],
        timelineClips: [{ id: "clip1", mediaStart: 10, mediaEnd: 25 }],
        subtitles: [
            { id: "sub1", text: "OK字幕", start: 12, end: 14 },
        ],
        bgmPath: "C:\\audio\\bgm.wav",
        seSlots: [{ id: "se1", path: "C:\\audio\\hit.wav", volume: 0.8, triggerTime: 2 }],
    }))

    assert.equal(summary.activeStepId, "export")
    assert.equal(summary.steps.find((step) => step.id === "edit")?.state, "complete")
    assert.equal(summary.steps.find((step) => step.id === "export")?.state, "active")
    assert.equal(summary.stats.exportErrors, 0)
})

test("詳細工程を3つの成果ベース制作空間へ一貫して集約する", () => {
    const presentation = computeWorkflowPresentation(document({
        inputPath: "C:\\captures\\match.mp4",
        videoInfo: { duration: 184.2, width: 1920, height: 1080 },
        mediaAssets: [{ id: "media-1" }],
        recommendedCuts: [
            { start: 10, end: 25, label: "見どころ", reason: "盛り上がり", excitement: 88 },
        ],
        timelineClips: [{ id: "source", mediaStart: 0, mediaEnd: 184.2 }],
    }))

    assert.deepEqual(presentation.workspaces.map((workspace) => workspace.id), [
        "draft",
        "edit",
        "export",
    ])
    assert.equal(presentation.project.fileName, "match.mp4")
    assert.equal(presentation.project.sourceMeta, "1920×1080 · 3:04")
    assert.equal(presentation.workspaces[0].state, "attention")
    assert.equal(presentation.workspaces[0].nextId, "edit")
    assert.equal(presentation.workspaces[0].nextLabel, "ラフカットを決める")
    assert.equal(presentation.workspaces[2].nextId, null)
})

test("採用・仕上げ・出力準備を制作空間の進捗へ反映する", () => {
    const presentation = computeWorkflowPresentation(document({
        inputPath: "C:\\video.mp4",
        videoInfo: { duration: 120, width: 1920, height: 1080 },
        mediaAssets: [],
        recommendedCuts: [
            { start: 10, end: 25, label: "見どころ", reason: "盛り上がり", excitement: 88 },
        ],
        timelineClips: [{ id: "clip1", mediaStart: 10, mediaEnd: 25 }],
        subtitles: [{ id: "sub1", text: "OK字幕", start: 12, end: 14 }],
        bgmPath: "C:\\audio\\bgm.wav",
        seSlots: [{ id: "se1", path: "C:\\audio\\hit.wav", volume: 0.8, triggerTime: 2 }],
    }))

    assert.deepEqual(
        presentation.workspaces.map(({ id, state }) => [id, state]),
        [
            ["draft", "complete"],
            ["edit", "complete"],
            ["export", "ready"],
        ],
    )
    assert.equal(presentation.completedCount, 2)
})

test("AIを実行していない手動シーケンスをAI初稿完了とは表示しない", () => {
    const presentation = computeWorkflowPresentation(document({
        inputPath: "C:\\video.mp4",
        videoInfo: { duration: 120, width: 1920, height: 1080 },
        mediaAssets: [],
        timelineClips: [{ id: "manual", mediaStart: 10, mediaEnd: 25 }],
        processing: { phase: "idle", lastOutputPath: null, lastError: null },
    }))

    assert.equal(presentation.workspaces.find((workspace) => workspace.id === "draft")?.state, "ready")
})

test("書き出しエラーと成功を出力空間の状態へ正しく反映する", () => {
    const base = {
        inputPath: "C:\\video.mp4",
        videoInfo: { duration: 120, width: 1920, height: 1080 },
        mediaAssets: [],
        timelineClips: [],
    }
    const blocked = computeWorkflowPresentation(document({
        ...base,
        processing: { phase: "idle", lastOutputPath: null, lastError: null },
    }))
    const completed = computeWorkflowPresentation(document({
        ...base,
        timelineClips: [{ id: "clip", mediaStart: 10, mediaEnd: 25 }],
        processing: {
            phase: "complete",
            lastOutputPath: "C:\\video_erabiflow.mp4",
            lastError: null,
        },
    }))

    assert.equal(blocked.workspaces.find((workspace) => workspace.id === "export")?.state, "attention")
    assert.equal(completed.workspaces.find((workspace) => workspace.id === "export")?.state, "complete")
    assert.equal(completed.workspaces.find((workspace) => workspace.id === "export")?.metric, "動画出力済み")
})

test("投稿メモは主制作工程の進捗を増やさない", () => {
    const withoutMemo = computeWorkflowPresentation(document({
        inputPath: "C:\\video.mp4",
        videoInfo: { duration: 120, width: 1920, height: 1080 },
        mediaAssets: [],
        timelineClips: [{ id: "clip", mediaStart: 10, mediaEnd: 25 }],
        processing: { phase: "idle", lastOutputPath: null, lastError: null },
    }))
    const withMemo = computeWorkflowPresentation(document({
        inputPath: "C:\\video.mp4",
        videoInfo: { duration: 120, width: 1920, height: 1080 },
        mediaAssets: [],
        timelineClips: [{ id: "clip", mediaStart: 10, mediaEnd: 25 }],
        publishing: { rightsChecked: true, caption: "投稿本文" },
        processing: { phase: "idle", lastOutputPath: null, lastError: null },
    }))

    assert.deepEqual(withMemo.workspaces.map((workspace) => workspace.id), ["draft", "edit", "export"])
    assert.equal(withMemo.completedCount, withoutMemo.completedCount)
})
