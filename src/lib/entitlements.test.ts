import assert from "node:assert/strict"
import test from "node:test"
import { hasCapability, normalizeProductPlan, PRODUCT_PLANS } from "./entitlements.ts"

test("Freeは基本プランでCreator向けAI仕上げ権限を持たない", () => {
    assert.equal(hasCapability("free", "ai.autoReframe"), false)
    assert.equal(hasCapability("free", "ai.silenceCut"), false)
    assert.equal(hasCapability("free", "ai.audioDucking"), false)
})

test("CreatorはAI仕上げと将来の量産機能を利用できる", () => {
    assert.equal(hasCapability("creator", "ai.autoReframe"), true)
    assert.equal(hasCapability("creator", "clips.batchCreate"), true)
    assert.equal(hasCapability("creator", "export.batch"), true)
    assert.equal(PRODUCT_PLANS.creator.shortLabel, "CREATOR")
})

test("不明なプラン値はFreeへ安全に戻す", () => {
    assert.equal(normalizeProductPlan("creator"), "creator")
    assert.equal(normalizeProductPlan("pro"), "free")
    assert.equal(normalizeProductPlan(null), "free")
})
