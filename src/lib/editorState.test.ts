import test, { beforeEach } from "node:test"
import assert from "node:assert/strict"
import { useDocumentStore } from "../stores/document.ts"
import { useEditorStore } from "../stores/editor.ts"

beforeEach(() => {
    useDocumentStore.getState().resetDocument()
    useEditorStore.getState().resetPlayback()
})

test("再生状態はdocumentとは独立して更新される", () => {
    const editor = useEditorStore.getState()
    editor.setPreviewTime(12.5)
    editor.setIsPlaying(true)
    editor.setVolume(0.4)
    editor.setWorkspaceIn(2)
    editor.setWorkspaceOut(8)
    editor.setActiveTool("razor")

    assert.deepEqual({
        previewTime: useEditorStore.getState().previewTime,
        isPlaying: useEditorStore.getState().isPlaying,
        volume: useEditorStore.getState().volume,
        workspaceIn: useEditorStore.getState().workspaceIn,
        workspaceOut: useEditorStore.getState().workspaceOut,
        activeTool: useEditorStore.getState().activeTool,
    }, {
        previewTime: 12.5,
        isPlaying: true,
        volume: 0.4,
        workspaceIn: 2,
        workspaceOut: 8,
        activeTool: "razor",
    })
    assert.deepEqual(useDocumentStore.getState().trim, { start: 0, end: 0 })
})

test("不正な再生位置と音量を正規化する", () => {
    useEditorStore.getState().setPreviewTime(-10)
    useEditorStore.getState().setVolume(5)
    assert.equal(useEditorStore.getState().previewTime, 0)
    assert.equal(useEditorStore.getState().volume, 1)

    useEditorStore.getState().setPreviewTime(Number.NaN)
    useEditorStore.getState().setVolume(Number.NaN)
    assert.equal(useEditorStore.getState().previewTime, 0)
    assert.equal(useEditorStore.getState().volume, 1)
})

test("候補の元動画プレビューはKEEPシーケンスの再生位置と分離する", () => {
    const editor = useEditorStore.getState()
    editor.setPreviewTime(5)
    editor.setSourcePreviewTime(90)
    assert.deepEqual({
        sequence: useEditorStore.getState().previewTime,
        source: useEditorStore.getState().sourcePreviewTime,
        playing: useEditorStore.getState().isPlaying,
    }, { sequence: 5, source: 90, playing: false })

    editor.setPreviewTime(6)
    assert.equal(useEditorStore.getState().sourcePreviewTime, null)
})

test("プレビューの一時ミュートは直前音量を復元し、チャンネル音量を分離する", () => {
    const editor = useEditorStore.getState()
    editor.setVolume(0.35)
    editor.setPreviewMainVolume(0.8)
    editor.setPreviewBgmVolume(0.6)
    editor.setPreviewTrackVolume(0.4)
    editor.togglePreviewMute()
    assert.equal(useEditorStore.getState().volume, 0)
    editor.togglePreviewMute()

    assert.deepEqual({
        master: useEditorStore.getState().volume,
        main: useEditorStore.getState().previewMainVolume,
        bgm: useEditorStore.getState().previewBgmVolume,
        track: useEditorStore.getState().previewTrackVolume,
    }, { master: 0.35, main: 0.8, bgm: 0.6, track: 0.4 })
})

test("入力動画を変更すると再生ランタイム状態をリセットする", () => {
    const editor = useEditorStore.getState()
    editor.setPreviewTime(18)
    editor.setIsPlaying(true)
    editor.setWorkspaceIn(3)
    editor.setWorkspaceOut(15)
    editor.setActiveTool("razor")
    editor.setSourcePreviewTime(90)

    useDocumentStore.getState().setInputPath("C:\\captures\\next.mp4")

    assert.equal(useEditorStore.getState().previewTime, 0)
    assert.equal(useEditorStore.getState().isPlaying, false)
    assert.equal(useEditorStore.getState().workspaceIn, null)
    assert.equal(useEditorStore.getState().workspaceOut, null)
    assert.equal(useEditorStore.getState().activeTool, "selection")
    assert.equal(useEditorStore.getState().sourcePreviewTime, null)
})

test("同じ入力動画の再選択と空projectの再初期化でも再生状態をリセットする", () => {
    useDocumentStore.getState().setInputPath("C:\\captures\\same.mp4")
    useEditorStore.getState().setPreviewTime(18)
    useEditorStore.getState().setIsPlaying(true)
    useEditorStore.getState().setWorkspaceOut(15)
    useDocumentStore.getState().setInputPath("C:\\captures\\same.mp4")
    assert.equal(useEditorStore.getState().previewTime, 0)
    assert.equal(useEditorStore.getState().isPlaying, false)
    assert.equal(useEditorStore.getState().workspaceOut, null)

    useEditorStore.getState().setPreviewTime(9)
    useDocumentStore.getState().resetDocument()
    assert.equal(useEditorStore.getState().previewTime, 0)
})
