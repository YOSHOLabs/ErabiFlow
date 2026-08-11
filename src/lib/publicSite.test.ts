import test from "node:test"
import assert from "node:assert/strict"
import { buildPublicSiteUrl } from "./publicSiteUrl.ts"

test("公開サイトURLは設定したHTTPSオリジン内だけ許可する", () => {
    assert.equal(
        buildPublicSiteUrl("https://tateclip.example", "/gear.html"),
        "https://tateclip.example/gear.html",
    )
    assert.equal(buildPublicSiteUrl("http://tateclip.example", "/gear.html"), null)
    assert.equal(buildPublicSiteUrl("https://tateclip.example", "//evil.example/gear.html"), null)
    assert.equal(buildPublicSiteUrl("https://user:pass@tateclip.example", "/gear.html"), null)
})

test("ベースURLへパス・クエリ・ハッシュを混ぜない", () => {
    assert.equal(buildPublicSiteUrl("https://tateclip.example/base", "/gear.html"), null)
    assert.equal(buildPublicSiteUrl("https://tateclip.example/?source=app", "/gear.html"), null)
})
