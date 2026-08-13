import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { chromium } from "@playwright/test"

const rootDir = path.resolve(import.meta.dirname, "..")
const outputDir = path.join(rootDir, "docs", "portfolio")
const configuredUrl = process.env.ERABIFLOW_DEMO_URL
const baseUrl = configuredUrl ?? "http://127.0.0.1:1420"

let server = null
if (!configuredUrl) {
    server = spawn(process.execPath, [
        path.join(rootDir, "node_modules", "vite", "bin", "vite.js"),
        "--host", "127.0.0.1",
        "--port", "1420",
        "--strictPort",
    ], {
        cwd: rootDir,
        stdio: "ignore",
        windowsHide: true,
    })

    let ready = false
    for (let attempt = 0; attempt < 60; attempt += 1) {
        if (server.exitCode !== null) break
        try {
            const response = await fetch(baseUrl)
            if (response.ok) {
                ready = true
                break
            }
        } catch {
            // Vite is still starting.
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
    }
    if (!ready) {
        server.kill()
        throw new Error("The ErabiFlow demo server did not become ready.")
    }
}

await mkdir(outputDir, { recursive: true })

const browser = await chromium.launch()
try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
    })

    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" })
    await page.getByRole("heading", { name: /全編を見返さず.*残す／削るを決める/ }).waitFor()
    await page.screenshot({ path: path.join(outputDir, "portfolio-01-overview.png"), fullPage: true })

    await page.goto(`${baseUrl}/?demo=review`, { waitUntil: "networkidle" })
    await page.getByRole("heading", { name: "見どころ判断" }).waitFor()
    await page.screenshot({ path: path.join(outputDir, "portfolio-02-highlight-review.png"), fullPage: true })

    await page.goto(`${baseUrl}/?demo=1`, { waitUntil: "networkidle" })
    const workflow = page.getByRole("navigation", { name: "制作工程" })
    await workflow.getByRole("button", { name: /ラフカットを決める/ }).click()
    await page.getByText("ラフカット確認", { exact: true }).waitFor()
    await page.screenshot({ path: path.join(outputDir, "portfolio-03-rough-cut.png"), fullPage: true })

    await workflow.getByRole("button", { name: /受け渡す/ }).click()
    await page.getByRole("heading", { name: "受け渡し" }).waitFor()
    await page.screenshot({ path: path.join(outputDir, "portfolio-04-handoff.png"), fullPage: true })
} finally {
    await browser.close()
    server?.kill()
}

console.log(`Portfolio screenshots written to ${outputDir}`)
