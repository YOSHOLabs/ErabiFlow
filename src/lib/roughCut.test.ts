import test from "node:test"
import assert from "node:assert/strict"
import { buildRoughCutManifest, roughCutDocumentToSrt, roughCutManifestToCsv, roughCutManifestToEdl } from "./roughCut.ts"

function source(overrides: Record<string, unknown> = {}) {
    return {
        inputPath: "C:\\capture\\session.mp4",
        videoInfo: { duration: 7200, width: 1920, height: 1080, fps: 30 },
        timelineClips: [
            { id: "a", mediaStart: 10, mediaEnd: 20, label: "Opening, reaction" },
            { id: "b", mediaStart: 90, mediaEnd: 105, label: "Boss" },
        ],
        subtitles: [],
        ...overrides,
    } as any
}

test("keeps arbitrary-length landscape sources without a social-duration limit", () => {
        const manifest = buildRoughCutManifest(source())
        assert.equal(manifest.source.orientation, "landscape")
        assert.equal(manifest.source.duration, 7200)
        assert.deepEqual(manifest.summary, { keepCount: 2, keptDuration: 25, removedDuration: 7175, keepRatio: 0.0035 })
        assert.deepEqual({ sourceIn: manifest.entries[1].sourceIn, sourceOut: manifest.entries[1].sourceOut, timelineIn: manifest.entries[1].timelineIn, timelineOut: manifest.entries[1].timelineOut }, { sourceIn: 90, sourceOut: 105, timelineIn: 10, timelineOut: 25 })
})

test("describes portrait sources and counts overlapping KEEP ranges only once", () => {
        const manifest = buildRoughCutManifest(source({
            videoInfo: { duration: 120, width: 1080, height: 1920, fps: 60 },
            timelineClips: [
                { id: "a", mediaStart: 0, mediaEnd: 40 },
                { id: "b", mediaStart: 30, mediaEnd: 60 },
            ],
        }))
        assert.equal(manifest.source.orientation, "portrait")
        assert.equal(manifest.summary.keptDuration, 70)
        assert.equal(manifest.summary.removedDuration, 60)
        assert.equal(manifest.summary.keepRatio, 0.5)
})

test("preserves record gaps in the interchange timeline", () => {
        const manifest = buildRoughCutManifest(source({
            videoInfo: { duration: 100, width: 1080, height: 1080, fps: 30 },
            timelineClips: [
                { id: "a", mediaStart: 5, mediaEnd: 10 },
                { id: "gap", isGap: true, mediaStart: 2, mediaEnd: 0 },
                { id: "b", mediaStart: 20, mediaEnd: 25 },
            ],
        }))
        assert.equal(manifest.source.orientation, "square")
        assert.equal(manifest.entries[1].timelineIn, 7)
        assert.equal(manifest.entries[1].timelineOut, 12)
})

test("exports escaped CSV and CMX 3600 EDL timecodes", () => {
        const manifest = buildRoughCutManifest(source())
        assert.match(roughCutManifestToCsv(manifest), /"Opening, reaction"/)
        const edl = roughCutManifestToEdl(manifest)
        assert.match(edl, /TITLE: session/)
        assert.match(edl, /00:00:10:00 00:00:20:00 00:00:00:00 00:00:10:00/)
        assert.match(edl, /\* FROM CLIP NAME: session.mp4/)
})

test("treats spreadsheet formulas as text in CSV", () => {
    const csv = roughCutManifestToCsv(buildRoughCutManifest(source({
        inputPath: "C:\\capture\\=session.mp4",
        timelineClips: [{ id: "unsafe", mediaStart: 1, mediaEnd: 2, label: "+SUM(A1:A2)" }],
    })))
    assert.match(csv, /'\+SUM\(A1:A2\)/)
    assert.match(csv, /'=session\.mp4/)
})

test("uses actual fractional frame rate for long NON-DROP EDL positions", () => {
    const edl2997 = roughCutManifestToEdl(buildRoughCutManifest(source({
        videoInfo: { duration: 3700, width: 1920, height: 1080, fps: 29.97 },
        timelineClips: [{ id: "long", mediaStart: 3600, mediaEnd: 3601 }],
    })))
    assert.match(edl2997, /00:59:56:12 00:59:57:12/)

    const edl5994 = roughCutManifestToEdl(buildRoughCutManifest(source({
        videoInfo: { duration: 3700, width: 1920, height: 1080, fps: 59.94 },
        timelineClips: [{ id: "long", mediaStart: 3600, mediaEnd: 3601 }],
    })))
    assert.match(edl5994, /00:59:56:24 00:59:57:24/)
})

test("maps source subtitles onto the kept sequence for NLE import", () => {
        const srt = roughCutDocumentToSrt(source({
            timelineClips: [
                { id: "a", mediaStart: 10, mediaEnd: 20 },
                { id: "b", mediaStart: 90, mediaEnd: 100 },
            ],
            subtitles: [
                { id: "s1", start: 12, end: 14, text: "最初" },
                { id: "s2", start: 92.5, end: 94, text: "次" },
                { id: "removed", start: 50, end: 51, text: "没" },
            ],
        }))
        assert.match(srt, /00:00:02,000 --> 00:00:04,000/)
        assert.match(srt, /00:00:12,500 --> 00:00:14,000/)
        assert.doesNotMatch(srt, /没/)
})

test("ignores legacy speed and edit effects in every rough-cut handoff", () => {
    const edited = source({
        timelineClips: [{
            id: "legacy",
            mediaStart: 10,
            mediaEnd: 20,
            speed: 2,
            reverse: true,
            freezeFrame: 15,
            freezeDuration: 5,
            transform: { positionX: 1, positionY: 1, scale: 2, rotation: 90, flipHorizontal: true, flipVertical: false, opacity: 0.5 },
        }],
        subtitles: [{ id: "s1", start: 12, end: 14, text: "raw time" }],
    })
    const manifest = buildRoughCutManifest(edited)
    assert.deepEqual(
        { duration: manifest.entries[0].duration, timelineOut: manifest.entries[0].timelineOut },
        { duration: 10, timelineOut: 10 },
    )
    assert.match(roughCutDocumentToSrt(edited), /00:00:02,000 --> 00:00:04,000/)
})
