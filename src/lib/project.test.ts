import test, { beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
    CURRENT_SCHEMA_VERSION,
    collectProjectAssetReferences,
    deserializeProject,
    serializeProject,
} from "./project.ts"
import { useDocumentStore } from "../stores/document.ts"
import { useEditorStore } from "../stores/editor.ts"

beforeEach(() => {
    useDocumentStore.getState().resetDocument()
    useDocumentStore.temporal.getState().clear()
    useEditorStore.getState().resetPlayback()
})

test("v15は編集データとKEEP/没判断だけをallowlistで保存する", () => {
    const state = useDocumentStore.getState()
    state.setInputPath("C:\\captures\\match.mp4")
    state.setBgmPath("C:\\audio\\bgm.wav")
    state.setTrimStart(1)
    state.setTrimEnd(8)
    useEditorStore.getState().setPreviewTime(4)
    useEditorStore.getState().setIsPlaying(true)
    useEditorStore.getState().setVolume(0.25)
    useEditorStore.getState().setActiveTool("razor")
    useEditorStore.getState().setWorkspaceIn(2)
    state.setWaveformData([0.1, 0.8])
    state.rejectHighlightCandidate(1)
    state.setProcessing({
        analysisGameId: "fps",
        enableAutoReframe: true,
        enableJumpCut: true,
        isProcessing: true,
        progress: 73,
        phase: "encoding",
        status: "running",
        lastError: "runtime only",
    })

    const saved = JSON.parse(serializeProject())

    assert.equal(saved.version, CURRENT_SCHEMA_VERSION)
    assert.equal(saved.document.inputPath, "C:\\captures\\match.mp4")
    assert.equal(saved.document.bgmPath, "C:\\audio\\bgm.wav")
    assert.equal(saved.document.isPlaying, undefined)
    assert.equal(saved.document.volume, undefined)
    assert.equal(saved.document.waveformData, undefined)
    assert.equal(saved.document.analysisArtifacts, undefined)
    assert.equal(saved.document.analysisJobs, undefined)
    assert.deepEqual(saved.document.rejectedHighlightCandidateIndices, [1])
    assert.deepEqual(saved.document.trim, { start: 1, end: 8 })
    assert.deepEqual(Object.keys(saved.document.processing).sort(), [
        "analysisGameId",
        "enableAutoReframe",
        "enableJumpCut",
        "jumpCutConfig",
    ])
})

test("v1とv2をv15へ移行し旧構図を保ったままlegacy auto-reframeを無効化する", () => {
    const legacyDocuments = [
        {
            inputPath: "C:\\legacy\\v1.mp4",
            avatarPath: "",
            videoInfo: null,
            trim: { start: 1, end: 8, previewTime: 4 },
            text: {},
            avatar: {},
            game: {},
            processing: { enableAutoReframe: true },
            subtitles: [],
        },
        {
            version: 2,
            project: { inputPath: "C:\\legacy\\v2.mp4", avatarPath: "", videoInfo: null },
            timeline: { trim: { start: 2, end: 9, previewTime: 5 } },
            text: { text: {}, subtitles: [] },
            avatar: { avatar: {}, game: {} },
            processing: { processing: { enableAutoReframe: true } },
        },
    ]

    for (const [index, fixture] of legacyDocuments.entries()) {
        deserializeProject(JSON.stringify(fixture))
        const state = useDocumentStore.getState()
        assert.equal(state.inputPath, `C:\\legacy\\v${index + 1}.mp4`)
        assert.equal(state.processing.enableAutoReframe, false)
        assert.equal(state.game.layoutMode, "commentary")
        assert.equal(useEditorStore.getState().isPlaying, false)
        assert.equal(useEditorStore.getState().previewTime, 0)
        assert.equal(state.waveformData.length, 0)
    }
})

test("v3〜v5の旧BGM開始位置を素材トリムへ移行する", () => {
    for (const version of [3, 4, 5]) {
        deserializeProject(JSON.stringify({
            version,
            document: {
                inputPath: `C:\\legacy\\v${version}.mp4`,
                bgmPath: "C:\\legacy\\bgm.wav",
                bgmStart: 12.5,
                processing: {},
            },
        }))
        const state = useDocumentStore.getState()
        assert.equal(state.bgmStart, 0)
        assert.equal(state.bgmTrimStart, 12.5)
        assert.equal(state.bgmEnd, null)
    }
})

test("v6〜v14を旧構図で補完し、読み込み前のundo履歴を破棄する", () => {
    for (let version = 6; version <= 14; version += 1) {
        useDocumentStore.getState().setBgmVolume(0.2)
        assert.ok(useDocumentStore.temporal.getState().pastStates.length > 0)

        deserializeProject(JSON.stringify({
            version,
            document: {
                inputPath: `C:\\projects\\v${version}.mp4`,
                text: { content: `v${version}` },
            },
        }))

        const state = useDocumentStore.getState()
        assert.equal(state.inputPath, `C:\\projects\\v${version}.mp4`)
        assert.equal(state.text.content, `v${version}`)
        assert.equal(state.processing.isProcessing, false)
        assert.equal(state.game.layoutMode, "commentary")
        assert.equal(useDocumentStore.temporal.getState().pastStates.length, 0)
    }
})

test("v14の明示的なsource構図は保ち、新規v15の既定はsourceにする", () => {
    deserializeProject(JSON.stringify({ version: 14, document: { game: { layoutMode: "source" } } }))
    assert.equal(useDocumentStore.getState().game.layoutMode, "source")

    deserializeProject(JSON.stringify({ version: 15, document: {} }))
    assert.equal(useDocumentStore.getState().game.layoutMode, "source")
})

test("候補と没判断を保存・再読込してレビューを再開できる", () => {
    const state = useDocumentStore.getState()
    state.setRecommendedCuts([{
        start: 10,
        end: 20,
        label: "reaction",
        reason: "voice and event",
        excitement: 80,
    }])
    state.rejectHighlightCandidate(0)

    const json = serializeProject()
    useDocumentStore.getState().resetDocument()
    deserializeProject(json)

    assert.equal(useDocumentStore.getState().recommendedCuts[0]?.reason, "voice and event")
    assert.deepEqual(useDocumentStore.getState().rejectedHighlightCandidateIndices, [0])
    assert.deepEqual(useDocumentStore.getState().analysisArtifacts, [])
})

test("v14の投稿メモに保存したカバー時刻とUI回避ガイド設定を維持する", () => {
    deserializeProject(JSON.stringify({
        version: 14,
        document: {
            publishing: {
                coverTime: 12.3,
                showSafeZone: false,
            },
        },
    }))

    assert.equal(useDocumentStore.getState().publishing.coverTime, 12.3)
    assert.equal(useDocumentStore.getState().publishing.showSafeZone, false)
})

test("v13以前に混入した再生ランタイム状態を読み捨てる", () => {
    useEditorStore.getState().setPreviewTime(99)
    useEditorStore.getState().setIsPlaying(true)
    useEditorStore.getState().setVolume(0.1)
    useEditorStore.getState().setWorkspaceOut(20)
    useEditorStore.getState().setActiveTool("razor")

    deserializeProject(JSON.stringify({
        version: 13,
        document: {
            inputPath: "C:\\projects\\legacy-runtime.mp4",
            trim: {
                start: 2,
                end: 12,
                previewTime: 7,
                workspaceIn: 3,
                workspaceOut: 9,
                activeTool: "razor",
            },
            isPlaying: true,
            volume: 0.2,
        },
    }))

    assert.deepEqual(useDocumentStore.getState().trim, { start: 2, end: 12 })
    assert.deepEqual({
        previewTime: useEditorStore.getState().previewTime,
        isPlaying: useEditorStore.getState().isPlaying,
        volume: useEditorStore.getState().volume,
        workspaceIn: useEditorStore.getState().workspaceIn,
        workspaceOut: useEditorStore.getState().workspaceOut,
        activeTool: useEditorStore.getState().activeTool,
    }, {
        previewTime: 0,
        isPlaying: false,
        volume: 1,
        workspaceIn: null,
        workspaceOut: null,
        activeTool: "selection",
    })
})

test("未知のschema versionは拒否する", () => {
    assert.throws(
        () => deserializeProject(JSON.stringify({ version: 999, document: {} })),
        /未対応のプロジェクトファイルバージョン: 999/,
    )
})

test("再認可対象assetを正規化・重複排除して列挙する", () => {
    const refs = collectProjectAssetReferences(JSON.stringify({
        version: 14,
        document: {
            inputPath: "C:\\media\\SOURCE.MP4",
            avatarPath: "C:\\media\\avatar.png",
            bgmPath: "C:\\media\\music.wav",
            mediaAssets: [
                { id: "source", kind: "video", path: "c:\\media\\source.mp4", proxyPath: "C:\\proxy\\source.mp4" },
                { id: "extra", kind: "audio", path: "C:\\media\\extra.wav" },
            ],
            editorTracks: [{ id: "v2", kind: "video", name: "V2" }],
            trackMediaClips: [{
                id: "overlay",
                trackId: "v2",
                assetId: "source",
                path: "C:\\media\\source.mp4",
                kind: "video",
                timelineStart: 0,
                timelineEnd: 2,
                sourceStart: 0,
                sourceEnd: 2,
                volume: 1,
                muted: false,
                hasAudio: true,
                transform: {},
                color: { lutPath: "C:\\looks\\film.cube" },
            }],
            images: [{ id: "logo", path: "C:\\media\\logo.png" }],
            seSlots: [{ id: "hit", path: "C:\\audio\\hit.wav" }],
            seFileEntries: [{ id: "rise", path: "C:\\audio\\rise.wav" }],
            customFonts: [{ id: "font", path: "C:\\fonts\\jp.ttf" }],
        },
    }))

    assert.deepEqual(refs, [
        { path: "C:\\media\\SOURCE.MP4", kind: "video" },
        { path: "C:\\media\\avatar.png", kind: "image" },
        { path: "C:\\media\\music.wav", kind: "audio" },
        { path: "C:\\proxy\\source.mp4", kind: "proxy" },
        { path: "C:\\media\\extra.wav", kind: "audio" },
        { path: "C:\\media\\logo.png", kind: "image" },
        { path: "C:\\looks\\film.cube", kind: "lut" },
        { path: "C:\\audio\\hit.wav", kind: "audio" },
        { path: "C:\\audio\\rise.wav", kind: "audio" },
        { path: "C:\\fonts\\jp.ttf", kind: "font" },
    ])
})
