import test from "node:test"
import assert from "node:assert/strict"
import { buildPublicSiteUrl } from "./publicSiteUrl.ts"

test("公開サイトURLは設定したHTTPSオリジン内だけ許可する", () => {
    assert.equal(
        buildPublicSiteUrl("https://erabiflow.example", "/gear.html"),
        "https://erabiflow.example/gear.html",
    )
    assert.equal(buildPublicSiteUrl("http://erabiflow.example", "/gear.html"), null)
    assert.equal(buildPublicSiteUrl("https://erabiflow.example", "//evil.example/gear.html"), null)
    assert.equal(buildPublicSiteUrl("https://user:pass@erabiflow.example", "/gear.html"), null)
})

test("ベースURLへパス・クエリ・ハッシュを混ぜない", () => {
    assert.equal(buildPublicSiteUrl("https://erabiflow.example/base", "/gear.html"), null)
    assert.equal(buildPublicSiteUrl("https://erabiflow.example/?source=app", "/gear.html"), null)
})
