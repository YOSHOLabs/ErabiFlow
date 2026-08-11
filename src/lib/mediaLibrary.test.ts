import test from "node:test"
import assert from "node:assert/strict"
import { createMediaAsset, detectMediaKind, mediaFileName, normalizeMediaLibrary } from "./mediaLibrary.ts"

test("動画・画像・音声の拡張子を大文字小文字に関係なく分類する", () => {
    assert.equal(detectMediaKind("C:\\素材\\MATCH.MP4"), "video")
    assert.equal(detectMediaKind("/clips/stamp.webp"), "image")
    assert.equal(detectMediaKind("/audio/voice.FLAC"), "audio")
    assert.equal(detectMediaKind("notes.txt"), null)
})

test("素材エントリはフォルダと追加時刻を保存する", () => {
    assert.deepEqual(
        createMediaAsset("C:\\素材\\MATCH.MP4", "folder-1", () => "asset-1", () => "2026-07-27T00:00:00.000Z"),
        {
            id: "asset-1",
            kind: "video",
            path: "C:\\素材\\MATCH.MP4",
            name: "MATCH.MP4",
            folderId: "folder-1",
            favorite: false,
            addedAt: "2026-07-27T00:00:00.000Z",
        },
    )
    assert.equal(mediaFileName("/clips/scene.mov"), "scene.mov")
})

test("旧プロジェクトの動画・BGM・画像を重複なく素材ライブラリへ移行する", () => {
    const result = normalizeMediaLibrary({
        mediaFolders: [{ id: "folder-1", name: "本編", createdAt: "2026-07-27T00:00:00.000Z" }],
        mediaAssets: [{
            id: "asset-1",
            kind: "video",
            path: "C:\\素材\\main.mp4",
            name: "main.mp4",
            folderId: "missing-folder",
            favorite: true,
            addedAt: "2026-07-27T00:00:00.000Z",
        }],
        inputPath: "c:\\素材\\MAIN.MP4",
        videoInfo: { duration: 30, width: 1920, height: 1080, fps: 30 },
        bgmPath: "C:\\素材\\bgm.mp3",
        bgmSourceDuration: 60,
        images: [{
            id: "image-1",
            path: "C:\\素材\\logo.png",
            position: { x: 0.5, y: 0.5 },
            scale: 0.25,
            startTime: 0,
            endTime: 5,
            label: "logo",
        }],
    })

    assert.equal(result.mediaAssets.length, 3)
    assert.equal(result.mediaAssets[0].folderId, null)
    assert.equal(result.mediaAssets[0].favorite, true)
    assert.equal(result.mediaAssets.find((asset) => asset.kind === "audio")?.duration, 60)
    assert.equal(result.mediaAssets.find((asset) => asset.kind === "image")?.name, "logo.png")
})
