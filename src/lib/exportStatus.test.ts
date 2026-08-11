import test from "node:test"
import assert from "node:assert/strict"
import { normalizeExportError, shortExportStatus } from "./exportStatus.ts"

test("書き出しエラーを画面表示向けの文字列へ正規化する", () => {
    assert.equal(normalizeExportError(new Error("ffmpeg failed")), "ffmpeg failed")
    assert.equal(normalizeExportError("Rust command failed"), "Rust command failed")
    assert.equal(normalizeExportError({ message: "missing input" }), "missing input")
    assert.equal(normalizeExportError({ code: "ENOENT", path: "ffmpeg" }), "{\n  \"code\": \"ENOENT\",\n  \"path\": \"ffmpeg\"\n}")
})

test("長い書き出しステータスは短く畳む", () => {
    assert.equal(shortExportStatus("  line1\nline2  "), "line1 line2")
    assert.equal(shortExportStatus("1234567890", 6), "12345…")
})
