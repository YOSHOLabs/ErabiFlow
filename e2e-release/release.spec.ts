import { expect, test } from "@playwright/test"

test("配布版は開発情報と旧編集機能を隠しラフカット主導線を維持する", async ({ page }) => {
    await page.goto("/?demo=review")

    await expect(page.getByText("LOCAL VIDEO STUDIO", { exact: true })).toHaveCount(0)
    await expect(page.getByText("解析メタ情報", { exact: true })).toHaveCount(0)
    await expect(page.getByText("イベント", { exact: true })).toHaveCount(0)
    await expect(page.getByText("解析オプション", { exact: true })).toBeVisible()
    await expect(page.getByLabel("字幕用ゲーム選択")).not.toBeVisible()
    await page.getByText("解析オプション", { exact: true }).click()
    await expect(page.getByLabel("字幕用ゲーム選択")).toBeVisible()

    await page.getByText("候補にない見どころを追加", { exact: true }).click()
    await expect(page.getByLabel("見どころの種類")).toBeVisible()
    await expect(page.getByLabel("候補尺プリセット")).toHaveCount(0)
    await expect(page.locator('[data-testid^="adopt-highlight-"]')).toHaveCount(5)
    await expect(page.getByTestId("adopt-highlight-5")).toHaveCount(0)
    await expect(page.getByTestId("highlight-reason-0")).toContainText("声量とゲーム音")

    await page.getByText("長さを調整", { exact: true }).first().click()
    await expect(page.getByRole("button", { name: "前+1s" }).first()).toBeVisible()
    await page.getByTestId("adopt-highlight-0").click()

    const workflow = page.getByRole("navigation", { name: "制作工程" })
    await workflow.getByRole("button", { name: /ラフカットを決める/ }).click()
    await expect(page.locator('input[aria-label="プレビュー音量"]')).toBeVisible()
    await expect(page.getByTestId("rough-cut-inspector")).toBeVisible()
    await expect(page.getByText("ドラッグで位置調整", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "映像トラックを追加" })).toHaveCount(0)
    await expect(page.getByLabel("タイムラインの追加ツール")).toHaveCount(0)

    await workflow.getByRole("button", { name: /受け渡す/ }).click()
    await expect(page.getByTestId("rough-cut-handoff-panel")).toBeVisible()
    await expect(page.getByText("環境・診断の詳細", { exact: true })).toHaveCount(0)
})

test("配布版でも解析信号の縮退警告は確認できる", async ({ page }) => {
    await page.goto("/?demo=analysis-warning")

    const warning = page.getByRole("alert")
    await expect(warning).toContainText("一部の解析信号を利用できませんでした")
    await expect(warning).toContainText("映像信号を取得できませんでした")
    await expect(page.getByText("解析メタ情報", { exact: true })).toHaveCount(0)
})
