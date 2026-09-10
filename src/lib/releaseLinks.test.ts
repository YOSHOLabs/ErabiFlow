import assert from "node:assert/strict"
import test from "node:test"
import { getConfiguredReleaseUrl, validateReleaseUrl } from "./releaseLinks.ts"

test("配布metadataのsupport・downloadだけを固定GitHub URLとして使う", () => {
    assert.equal(getConfiguredReleaseUrl("supportUrl"), "https://github.com/YOSHOLabs/ErabiFlow/issues")
    assert.equal(getConfiguredReleaseUrl("downloadUrl"), "https://github.com/YOSHOLabs/ErabiFlow/releases")
})

test("別repository・query・credentialを含む外部URLは拒否する", () => {
    assert.equal(validateReleaseUrl("supportUrl", "https://github.com/other/repo/issues"), null)
    assert.equal(validateReleaseUrl("supportUrl", "https://github.com/YOSHOLabs/ErabiFlow/issues?token=x"), null)
    assert.equal(validateReleaseUrl("downloadUrl", "https://user@github.com/YOSHOLabs/ErabiFlow/releases"), null)
})
