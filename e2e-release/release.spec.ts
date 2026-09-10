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

test("初回公開版は自動更新を行わずGitHub Releasesでの手動更新を案内する", async ({ page }) => {
    await page.goto("/?demo=1")

    await page.getByRole("button", { name: "バージョンと更新を確認" }).click()
    await expect(page.getByRole("heading", { name: "ErabiFlow Beta — Version 0.1.0" })).toBeVisible()
    await expect(page.getByRole("dialog")).toContainText("初回公開版では自動更新を使用しません")
    await expect(page.getByRole("dialog")).toContainText("GitHub Releases")
    await expect(page.getByRole("dialog").getByRole("button", { name: "更新を確認" })).toHaveCount(0)
    await expect(page.getByRole("dialog").getByRole("button", { name: "GitHub Releasesを開く" })).toBeVisible()
    await expect(page.getByRole("dialog").getByRole("button", { name: "GitHub Issues" })).toBeVisible()
    await expect(page.getByRole("dialog").getByRole("button", { name: "プライバシー" })).toBeVisible()
    await expect(page.getByRole("dialog").getByRole("button", { name: /利用規約/ })).toHaveCount(0)

    await page.evaluate(() => {
        window.open = ((url?: string | URL) => {
            document.documentElement.dataset.openedUrl = String(url || "")
            return window
        }) as typeof window.open
    })
    await page.getByRole("dialog").getByRole("button", { name: "GitHub Releasesを開く" }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.openedUrl)).toBe(
        "https://github.com/YOSHOLabs/ErabiFlow/releases",
    )
    await page.getByRole("dialog").getByRole("button", { name: "GitHub Issues" }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.openedUrl)).toBe(
        "https://github.com/YOSHOLabs/ErabiFlow/issues",
    )
    await page.getByRole("dialog").getByRole("button", { name: "プライバシー" }).click()
    await expect(page.getByRole("heading", { name: "プライバシー方針（同梱版）" })).toBeVisible()
    await expect(page.getByRole("dialog")).toContainText("動画、音声、字幕本文、AI候補、project")
    await expect(page.getByRole("dialog").getByRole("button", { name: "プライバシーを閉じる" })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.openedUrl)).toBe(
        "https://github.com/YOSHOLabs/ErabiFlow/issues",
    )
})
