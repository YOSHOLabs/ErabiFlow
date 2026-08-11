import test from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_PUBLISHING } from "./types.ts"
import { buildPostText, normalizeHashtags } from "./verticalTrends.ts"

test("投稿タグを正規化して重複を除く", () => {
    assert.equal(normalizeHashtags("#ゲーム, 実況  #ゲーム"), "#ゲーム #実況")
})

test("投稿文は説明・CTA・タグを空行でつなぐ", () => {
    assert.equal(buildPostText({
        publishing: { ...DEFAULT_PUBLISHING, caption: "逆転した瞬間", cta: "あなたならどうする？", hashtags: "ゲーム 実況" },
    }), "逆転した瞬間\n\nあなたならどうする？\n\n#ゲーム #実況")
})
