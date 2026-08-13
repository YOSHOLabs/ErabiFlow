import test from "node:test"
import assert from "node:assert/strict"
import { buildExportParams } from "./exportParams.ts"
import {
    buildCreatorBatchDocument,
    buildCreatorBatchExportParams,
    buildCreatorBatchOutputPath,
    sanitizeOutputFilePart,
} from "./creatorBatch.ts"

function document(overrides: Record<string, unknown> = {}) {
    return {
        inputPath: "C:\\videos\\source.mp4",
        videoInfo: { duration: 120, width: 1920, height: 1080 },
        timelineClips: [
            { id: "clip1", mediaStart: 10, mediaEnd: 20, label: "A" },
            { id: "clip2", mediaStart: 40, mediaEnd: 50, label: "B" },
        ],
        trim: { start: 0, end: 0 },
        subtitles: [
            { id: "sub1", text: "こんにちは", start: 12, end: 14 },
            { id: "sub2", text: "ラスト", start: 45, end: 48 },
        ],
        ducking: { enabled: true, preset: "standard" },
        game: { layoutMode: "commentary", positionY: 0.34, scale: 1.4 },
        text: {
            content: "タイトル",
            font: "Arial",
            color: "#FFFFFF",
            size: 44,
            strokeColor: "#000000",
            strokeWidth: 3,
            shadowColor: "rgba(0,0,0,0.5)",
            shadowBlur: 0,
            position: { x: 0.5, y: 0.15 },
        },
        subtitleStyle: {
            font: "Arial",
            color: "#FFFFFF",
            size: 40,
            strokeColor: "#000000",
            strokeWidth: 4,
            shadowColor: "rgba(0,0,0,0.5)",
            shadowBlur: 2,
            lineHeight: 1.2,
            letterSpacing: 0,
            positionY: 0.9,
        },
        avatarPath: "",
        avatar: { position: { x: 0.5, y: 0.78 }, scale: 1 },
        bgmPath: "C:\\audio\\bgm.wav",
        bgmVolume: 0.4,
        bgmStart: 3,
        bgmEnd: 9,
        bgmTrimStart: 2,
        bgmSourceDuration: 30,
        seSlots: [
            { id: "se1", path: "C:\\audio\\hit.wav", volume: 0.8, triggerTime: 1.2, label: "hit" },
        ],
        images: [
            {
                id: "img1",
                path: "C:\\images\\stamp.png",
                position: { x: 0.25, y: 0.5 },
                scale: 0.3,
                startTime: 1,
                endTime: 3,
                label: "stamp",
            },
        ],
        processing: {
            gpuType: "CPU",
            enableJumpCut: false,
            jumpCutConfig: { thresholdDb: -35, minDuration: 0.3, padding: 0.05 },
        },
        ...overrides,
    } as any
}

function exportedClip(start: number, end: number, overrides: Record<string, unknown> = {}) {
    return {
        isGap: false,
        start,
        end,
        speed: 1,
        volume: 1,
        muted: false,
        positionX: 0,
        positionY: 0,
        scale: 1,
        rotation: 0,
        flipHorizontal: false,
        flipVertical: false,
        opacity: 1,
        ...overrides,
    }
}

test("書き出しパラメータはRenderSpecからProcessParamsへ変換される", () => {
    const params = buildExportParams(document(), "0.0,100,50,400,700")

    assert.equal(params.renderSpec.layout.cropData, "0.0,100,50,400,700")
    assert.equal(params.cropData, params.renderSpec.layout.cropData)
    assert.equal(params.gameY, params.renderSpec.layout.gameY)
    assert.deepEqual(params.clips, [
        exportedClip(10, 20),
        exportedClip(40, 50),
    ])
    assert.deepEqual(params.subtitle?.segments.map(({ text, startTime, endTime }) => ({ text, startTime, endTime })), [
        { text: "こんにちは", startTime: 2, endTime: 4 },
        { text: "ラスト", startTime: 15, endTime: 18 },
    ])
    assert.equal(params.gameScale, 1.4)
    assert.equal(params.bgm?.start, 2)
    assert.equal(params.bgm?.timelineStart, 3)
    assert.equal(params.bgm?.timelineEnd, 9)
    assert.equal(params.ducking?.mainVoice, 1)
    assert.equal(params.overlayImages?.[0].x, 270)
    assert.equal(params.overlayImages?.[0].y, 960)
})

test("タイムライン未作成でもRenderSpecのfallback sequenceを使う", () => {
    const params = buildExportParams(document({
        timelineClips: [],
        trim: { start: 5, end: 15 },
        subtitles: [{ id: "sub1", text: "trim内", start: 6, end: 8 }],
    }))

    assert.deepEqual(params.clips, [exportedClip(5, 15)])
    assert.deepEqual(params.subtitle?.segments.map(({ startTime, endTime }) => ({ startTime, endTime })), [
        { startTime: 1, endTime: 3 },
    ])
    assert.equal(params.trimStart, null)
    assert.equal(params.trimDuration, null)
})

test("全面9:16レイアウトを書き出し仕様へ渡す", () => {
    const params = buildExportParams(document({
        game: { layoutMode: "portrait", positionY: 0.5, scale: 1 },
    }))
    assert.equal(params.layout, "portrait")
    assert.equal(params.renderSpec.layout.kind, "portrait")
})

test("上下余白つき3:4レイアウトを書き出し仕様へ渡す", () => {
    const params = buildExportParams(document({
        game: { layoutMode: "stage", positionY: 0.5, scale: 1 },
    }))
    assert.equal(params.layout, "stage")
    assert.equal(params.renderSpec.layout.kind, "stage")
})

test("有効な透かしだけをRenderSpecへ保存する", () => {
    const enabled = buildExportParams(document({
        watermark: { enabled: true, text: "@creator", font: "Arial", color: "#FFFFFF", size: 32, opacity: 0.45, position: "top-right" },
    }))
    assert.deepEqual(enabled.renderSpec.layers.watermark, {
        text: "@creator", font: "Arial", color: "#FFFFFF", size: 32, opacity: 0.45, position: "top-right",
    })

    const disabled = buildExportParams(document({
        watermark: { enabled: false, text: "@creator", font: "Arial", color: "#FFFFFF", size: 32, opacity: 0.45, position: "top-right" },
    }))
    assert.equal(disabled.renderSpec.layers.watermark, null)
})

test("追加動画トラックの素材FPSを書き出し仕様へ渡す", () => {
    const params = buildExportParams(document({
        mediaAssets: [{ id: "asset-24fps", path: "C:\\videos\\camera.mp4", kind: "video", fps: 24 }],
        editorTracks: [{ id: "track-v2", kind: "video", name: "V2", locked: false, hidden: false, muted: false }],
        trackMediaClips: [{
            id: "camera",
            assetId: "asset-24fps",
            trackId: "track-v2",
            path: "C:\\videos\\camera.mp4",
            kind: "video",
            timelineStart: 0,
            timelineEnd: 2,
            sourceStart: 0,
            sourceEnd: 2,
            volume: 1,
            muted: false,
            hasAudio: false,
            transform: { positionX: 0, positionY: 0, scale: 1, rotation: 0, flipHorizontal: false, flipVertical: false, opacity: 1 },
        }],
    }))

    assert.equal(params.renderSpec.layers.trackClips[0]?.sourceFps, 24)
})

test("Creator一括書き出しは候補ごとに独立したRenderSpecを作る", () => {
    const source = document({
        seSlots: [{ id: "se2", path: "C:\\audio\\hit.wav", volume: 0.8, triggerTime: 12, label: "hit" }],
        images: [{
            id: "img2",
            path: "C:\\images\\stamp.png",
            position: { x: 0.25, y: 0.5 },
            scale: 0.3,
            startTime: 11,
            endTime: 14,
            label: "stamp",
        }],
    })
    const item = {
        id: "candidate-2",
        label: "Bサイト / ACE?",
        title: "逆転エース",
        mediaStart: 40,
        mediaEnd: 50,
        excitement: 5,
    }

    const isolated = buildCreatorBatchDocument(source, item)
    assert.deepEqual(isolated.timelineClips, [{
        id: "candidate-2",
        mediaStart: 40,
        mediaEnd: 50,
        label: "Bサイト / ACE?",
    }])
    assert.equal(isolated.text.content, "逆転エース")
    assert.equal(isolated.bgmStart, 0)
    assert.equal(isolated.bgmEnd, 10)
    assert.equal(isolated.seSlots[0]?.triggerTime, 2)
    assert.deepEqual(isolated.images.map(({ startTime, endTime }) => ({ startTime, endTime })), [
        { startTime: 1, endTime: 4 },
    ])

    const params = buildCreatorBatchExportParams(source, item, 1, "260717120000")
    assert.deepEqual(params.clips, [exportedClip(40, 50)])
    assert.equal(params.text.content, "逆転エース")
    assert.deepEqual(params.subtitle?.segments.map(({ text, startTime, endTime }) => ({ text, startTime, endTime })), [
        { text: "ラスト", startTime: 5, endTime: 8 },
    ])
    assert.equal(params.outputPath, "C:\\videos\\source_erabiflow_260717120000_02_Bサイト_ACE.mp4")
})

test("クリップ固有の速度・変形・音量を書き出しパラメータへ渡す", () => {
    const params = buildExportParams(document({
        timelineClips: [{
            id: "styled",
            mediaStart: 10,
            mediaEnd: 20,
            speed: 2,
            volume: 0.4,
            muted: false,
            transform: {
                positionX: 0.5,
                positionY: -0.25,
                scale: 1.5,
                rotation: 90,
                flipHorizontal: true,
                flipVertical: false,
                opacity: 0.6,
            },
        }],
    }))

    assert.equal(params.renderSpec.version, 2)
    assert.deepEqual(params.clips, [exportedClip(10, 20, {
        speed: 2,
        volume: 0.4,
        positionX: 0.5,
        positionY: -0.25,
        scale: 1.5,
        rotation: 90,
        flipHorizontal: true,
        opacity: 0.6,
    })])
})

test("Creator出力名は危険文字を除去し、素材形式に関係なくMP4にする", () => {
    assert.equal(sanitizeOutputFilePart('  A/B:*? サイト.  '), "A_B_サイト")
    assert.equal(
        buildCreatorBatchOutputPath("D:\\録画\\match.mkv", 0, 'A/B:*? サイト', "run:01"),
        "D:\\録画\\match_erabiflow_run_01_01_A_B_サイト.mp4",
    )
    assert.equal(
        buildCreatorBatchOutputPath("D:\\録画\\VALORANT match.mkv", 1, "ACE", "run01"),
        "D:\\録画\\VALORANT match_erabiflow_run01_02_ACE.mp4",
    )

    const params = buildExportParams(document({ inputPath: "C:\\videos\\source.mkv" }))
    assert.equal(params.outputPath, "C:\\videos\\source_erabiflow_roughcut.mp4")
})

test("MOV・GIF・PNG連番と解像度・FPS・H.265設定をRustへ渡す", () => {
    const mov = buildExportParams(document({ inputPath: "C:\\videos\\source.mkv" }), null, { format: "mov", codec: "h265", width: 720, height: 1280, fps: 60, bitrateKbps: 8000 })
    assert.equal(mov.outputPath, "C:\\videos\\source_erabiflow_roughcut.mov")
    assert.deepEqual([mov.exportFormat, mov.videoCodec, mov.outputWidth, mov.outputHeight, mov.outputFps, mov.videoBitrateKbps], ["mov", "h265", 720, 1280, 60, 8000])
    const png = buildExportParams(document({ inputPath: "C:\\videos\\source.mp4" }), null, { format: "png_sequence", codec: "h264", width: 1080, height: 1920, fps: 30, bitrateKbps: 12000 })
    assert.equal(png.outputPath, "C:\\videos\\source_erabiflow_roughcut_%05d.png")
})

test("sourceレイアウトは横・縦の元画角とFPSを既定で維持し装飾を焼き込まない", () => {
    const landscape = buildExportParams(document({
        game: { layoutMode: "source", positionY: 0.5, scale: 2 },
        videoInfo: { duration: 7200, width: 3840, height: 2160, fps: 59.94 },
        processing: {
            gpuType: "CPU",
            enableJumpCut: true,
            jumpCutConfig: { thresholdDb: -35, minDuration: 0.3, padding: 0.05 },
        },
    }))
    assert.deepEqual([landscape.outputWidth, landscape.outputHeight, landscape.outputFps], [3840, 2160, 59.94])
    assert.deepEqual(landscape.renderSpec.canvas, { width: 3840, height: 2160, aspect: "3840:2160" })
    assert.equal(landscape.layout, "source")
    assert.equal(landscape.text.content, null)
    assert.equal(landscape.subtitle, null)
    assert.equal(landscape.bgm, null)
    assert.equal(landscape.seSlots, null)
    assert.equal(landscape.overlayImages, null)
    assert.equal(landscape.enableJumpCut, false)
    assert.equal(landscape.jumpCutConfig, null)

    const portrait = buildExportParams(document({
        game: { layoutMode: "source", positionY: 0.5, scale: 1 },
        videoInfo: { duration: 300, width: 1080, height: 1920, fps: 60 },
    }))
    assert.deepEqual([portrait.outputWidth, portrait.outputHeight, portrait.outputFps], [1080, 1920, 60])
    assert.deepEqual(portrait.renderSpec.canvas, { width: 1080, height: 1920, aspect: "1080:1920" })
})

test("sourceレイアウトは旧編集効果を捨てて元動画のIN/OUTだけを書き出す", () => {
    const params = buildExportParams(document({
        game: { layoutMode: "source", positionY: 0.5, scale: 2 },
        timelineClips: [{
            id: "legacy",
            mediaStart: 10,
            mediaEnd: 20,
            speed: 2,
            reverse: true,
            freezeFrame: 15,
            volume: 0.2,
            muted: true,
            transform: { positionX: 1, positionY: -1, scale: 2, rotation: 90, flipHorizontal: true, flipVertical: true, opacity: 0.5 },
        }],
    }))
    assert.deepEqual(params.renderSpec.sequence.clips, [{ id: "legacy", mediaStart: 10, mediaEnd: 20 }])
    assert.deepEqual(params.clips, [exportedClip(10, 20)])
})
