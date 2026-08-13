import { test, expect } from "@playwright/test"

test("開始画面がラフカット支援の3工程を伝える", async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto("/", { waitUntil: "domcontentloaded" })

    await expect(page.getByText("ErabiFlow", { exact: true })).toBeVisible()
    await expect(page.getByText("BY YOSHOLABS", { exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: /全編を見返さず.*残す／削るを決める/ })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText("横・縦を問わない、ローカル完結のラフカットアシスタントです。", { exact: false })).toBeVisible()
    const workflow = page.getByRole("navigation", { name: "制作工程" })
    await expect(workflow.getByRole("button", { name: /見どころを見つける.*素材待ち/ })).toBeEnabled()
    await expect(workflow.getByRole("button", { name: /ラフカットを決める.*未着手/ })).toBeDisabled()
    await expect(workflow.getByRole("button", { name: /受け渡す.*未着手/ })).toBeDisabled()
})

test("見どころ・ラフカット・受け渡しを一続きで移動できる", async ({ page }) => {
    await page.goto("/?demo=1")
    const workflow = page.getByRole("navigation", { name: "制作工程" })

    await expect(workflow.getByRole("button", { name: /見どころを見つける/ })).toBeVisible()
    await expect(page.getByText("候補プレビュー", { exact: true })).toBeVisible()
    await expect(page.getByText("タイムライン", { exact: true })).toHaveCount(0)

    await workflow.getByRole("button", { name: /ラフカットを決める/ }).click()
    await expect(page.getByText("ラフカット確認", { exact: true })).toBeVisible()
    await expect(page.getByTestId("rough-cut-inspector")).toBeVisible()
    await expect(page.getByText("KEEP", { exact: true }).first()).toBeVisible()
    await expect(page.getByText("素材ライブラリ", { exact: true })).toHaveCount(0)
    await expect(page.getByText("高度なクリップ編集", { exact: true })).toHaveCount(0)

    await workflow.getByRole("button", { name: /受け渡す/ }).click()
    await expect(page.getByRole("heading", { name: "受け渡し" })).toBeVisible()
    await expect(page.getByTestId("rough-cut-handoff-panel")).toBeVisible()
})

test("AI候補をKEEPまたは没にでき、固定尺プリセットを出さない", async ({ page }) => {
    await page.goto("/?demo=review")

    await expect(page.getByRole("heading", { name: "見どころ判断" })).toBeVisible()
    await expect(page.getByText("KEEP（残す）", { exact: true }).first()).toBeVisible()
    await expect(page.getByText("没（使わない）", { exact: true }).first()).toBeVisible()
    await expect(page.getByLabel("候補尺プリセット")).toHaveCount(0)
    await expect(page.getByText("書き出しリストに追加", { exact: true })).toHaveCount(0)
    await expect(page.getByTestId("highlight-reason-0")).toContainText("声量とゲーム音")

    await page.getByTestId("adopt-highlight-0").click()
    await page.getByText("勝利リアクション", { exact: true }).click()
    await expect(page.getByTestId("source-preview-indicator")).toContainText("元動画 2:22")
    await page.getByRole("navigation", { name: "制作工程" }).getByRole("button", { name: /ラフカットを決める/ }).click()
    await expect(page.getByRole("button", { name: "映像クリップ AI: 逆転クラッチ", exact: true })).toBeVisible()
})

test("没にしたAI候補を判断画面へ戻せる", async ({ page }) => {
    await page.goto("/?demo=review")

    const firstLabel = page.getByText("逆転クラッチ", { exact: true })
    await expect(firstLabel).toBeVisible()
    await page.getByText("没（使わない）", { exact: true }).first().click()
    await expect(firstLabel).toHaveCount(0)
    await page.getByRole("button", { name: "没にした候補を戻す" }).click()
    await expect(page.getByText("逆転クラッチ", { exact: true })).toBeVisible()
})

test("保存後に解析キャッシュがなくても候補と没判断を復元できる", async ({ page }) => {
    await page.goto("/?demo=saved-review")

    await expect(page.getByRole("heading", { name: "見どころ判断" })).toBeVisible()
    await expect(page.getByText("逆転クラッチ", { exact: true })).toHaveCount(0)
    await expect(page.getByText("勝利リアクション", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "没にした候補を戻す" }).click()
    await expect(page.getByText("逆転クラッチ", { exact: true })).toBeVisible()
})

test("ラフカットではIN・OUT・分割・没・並び順だけを調整する", async ({ page }) => {
    await page.goto("/?demo=1")
    await page.getByRole("navigation", { name: "制作工程" }).getByRole("button", { name: /ラフカットを決める/ }).click()
    await page.getByRole("button", { name: "映像クリップ オープニング", exact: true }).click()

    const start = page.getByLabel("元動画 IN")
    await expect(start).toHaveValue("14.2")
    await start.fill("15.2")
    await expect(start).toHaveValue("15.2")
    await expect(page.getByRole("button", { name: "再生位置で分割" })).toBeVisible()
    await expect(page.getByRole("button", { name: "この区間を没にする" })).toBeVisible()
    await expect(page.getByRole("button", { name: "前へ" })).toBeDisabled()
    await expect(page.getByRole("button", { name: "後ろへ" })).toBeEnabled()
})

test("横動画は元画角のラフカットとNLE受け渡しを既定にする", async ({ page }) => {
    await page.goto("/?demo=1")
    await page.getByRole("navigation", { name: "制作工程" }).getByRole("button", { name: /受け渡す/ }).click()

    await expect(page.getByText("1920×1080 · 60.00fps", { exact: true })).toBeVisible()
    await expect(page.getByText(/横・縦・正方形を自動判定/)).toBeVisible()
    await expect(page.getByRole("button", { name: "ラフカット動画を書き出す" })).toBeEnabled()
    const handoff = page.getByTestId("rough-cut-handoff-panel")
    await expect(handoff.getByRole("button", { name: /JSON.*完全なKEEPデータ/ })).toBeVisible()
    await expect(handoff.getByRole("button", { name: /CSV.*表計算/ })).toBeVisible()
    await expect(handoff.getByRole("button", { name: /CMX 3600 EDL.*Premiere・DaVinci/ })).toBeVisible()
    await expect(handoff.getByRole("button", { name: /SRT字幕.*ラフカット時間軸/ })).toBeEnabled()

    const downloadPromise = page.waitForEvent("download")
    await handoff.getByRole("button", { name: /JSON.*完全なKEEPデータ/ }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe("game-commentary_erabiflow_roughcut.json")
})

test("縦動画も元画角のまま受け渡せる", async ({ page }) => {
    await page.goto("/?demo=portrait")
    await page.getByRole("navigation", { name: "制作工程" }).getByRole("button", { name: /受け渡す/ }).click()

    await expect(page.getByText("1080×1920 · 30.00fps", { exact: true })).toBeVisible()
    await expect(page.getByText("縦動画・元画角を維持", { exact: true })).toBeVisible()
})

test("ラフカット動画では誤解を招く縦横変換を行わない", async ({ page }) => {
    await page.goto("/?demo=1")
    await page.getByRole("navigation", { name: "制作工程" }).getByRole("button", { name: /受け渡す/ }).click()

    await expect(page.getByRole("button", { name: /縦 9:16/ })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /横 16:9/ })).toHaveCount(0)
    await expect(page.getByText("縦横変換やリフレームは次の動画編集ソフトで行います。", { exact: false })).toBeVisible()
})
