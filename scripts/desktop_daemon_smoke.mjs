import { spawn, execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { access, stat, writeFile } from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import process from "node:process"
import { promisify } from "node:util"
import { chromium } from "@playwright/test"

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(import.meta.dirname, "..")
const defaultAppPath = path.join(rootDir, "src-tauri", "target-lite", "release", "app.exe")
const appPath = path.resolve(process.argv[2] ?? defaultAppPath)
const appDir = path.dirname(appPath)
const reportPath = path.join(rootDir, "release", "desktop-daemon-smoke.local.json")

async function sha256(filePath) {
    const hash = createHash("sha256")
    for await (const chunk of createReadStream(filePath)) hash.update(chunk)
    return hash.digest("hex")
}

async function reservePort() {
    const server = net.createServer()
    await new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", resolve)
    })
    const address = server.address()
    const port = typeof address === "object" && address ? address.port : 0
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    if (!port) throw new Error("WebView2デバッグ用portを確保できません")
    return port
}

async function waitForCdp(port, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs
    let lastError = "not ready"
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/json/version`)
            if (response.ok) return
            lastError = `HTTP ${response.status}`
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error)
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(`WebView2 CDP endpointが起動しませんでした: ${lastError}`)
}

async function listDaemonChildren(parentPid) {
    if (!Number.isSafeInteger(parentPid) || parentPid <= 0) throw new Error("invalid parent PID")
    const script = [
        "$ErrorActionPreference = 'Stop'",
        `$items = @(Get-CimInstance Win32_Process -Filter \"ParentProcessId = ${parentPid}\" | Where-Object { $_.Name -eq 'gemma_daemon.exe' } | Select-Object ProcessId,ExecutablePath)`,
        "$items | ConvertTo-Json -Compress",
    ].join("; ")
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true })
    const text = stdout.trim()
    if (!text) return []
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : [parsed]
}

function assertOwnedDaemon(candidate) {
    const executablePath = path.resolve(String(candidate.ExecutablePath ?? ""))
    const appPrefix = `${appDir.toLocaleLowerCase()}${path.sep}`
    if (!executablePath.toLocaleLowerCase().startsWith(appPrefix)) {
        throw new Error(`起動したアプリ外のdaemonは停止できません: ${executablePath}`)
    }
    const pid = Number(candidate.ProcessId)
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`invalid daemon PID: ${candidate.ProcessId}`)
    return pid
}

async function stopOwnedDaemon(parentPid) {
    const children = await listDaemonChildren(parentPid)
    if (children.length !== 1) {
        throw new Error(`Gemma daemon子プロセスは1件必要です: ${children.length}件`)
    }
    const pid = assertOwnedDaemon(children[0])
    await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-Command", `Stop-Process -Id ${pid} -Force -ErrorAction Stop`],
        { windowsHide: true },
    )
    return pid
}

async function waitForExit(child, timeoutMs) {
    if (child.exitCode !== null) return true
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs)
        child.once("exit", () => {
            clearTimeout(timer)
            resolve(true)
        })
    })
}

await access(appPath)
const port = await reservePort()
const additionalArgs = [
    process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,
    `--remote-debugging-port=${port}`,
].filter(Boolean).join(" ")
const app = spawn(appPath, [], {
    cwd: appDir,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: additionalArgs },
    stdio: "ignore",
    windowsHide: true,
})

let browser
try {
    await waitForCdp(port)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const page = browser.contexts().flatMap((context) => context.pages())[0]
    if (!page) throw new Error("TateClip WebView pageが見つかりません")
    await page.waitForFunction(() => typeof window.__TAURI_INTERNALS__?.invoke === "function", null, { timeout: 20_000 })

    const firstHealth = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("check_daemon_health"))
    if (firstHealth?.status !== "healthy") {
        throw new Error(`初回health応答が不正です: ${JSON.stringify(firstHealth)}`)
    }

    const stoppedPid = await stopOwnedDaemon(app.pid)
    const recoveredHealth = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("check_daemon_health"))
    if (recoveredHealth?.status !== "healthy") {
        throw new Error(`再起動後health応答が不正です: ${JSON.stringify(recoveredHealth)}`)
    }
    const diagnostics = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("get_daemon_diagnostics"))
    if (!diagnostics?.alive || Number(diagnostics.restartCount) < 1) {
        throw new Error(`自動再起動の診断値が不正です: ${JSON.stringify(diagnostics)}`)
    }

    console.log("DESKTOP DAEMON SMOKE: PASS")
    console.log(`App: ${appPath}`)
    console.log(`Stopped daemon PID: ${stoppedPid}`)
    console.log(`Restart count: ${diagnostics.restartCount}`)
    const appFile = await stat(appPath)
    await writeFile(reportPath, `${JSON.stringify({
        testedAt: new Date().toISOString(),
        result: "pass",
        appPath,
        appBytes: appFile.size,
        appLastWriteTime: appFile.mtime.toISOString(),
        appSha256: await sha256(appPath),
        stoppedDaemonPid: stoppedPid,
        restartCount: diagnostics.restartCount,
        firstHealthStatus: firstHealth.status,
        recoveredHealthStatus: recoveredHealth.status,
    }, null, 2)}\n`, "utf8")
    console.log(`Report: ${reportPath}`)
} finally {
    if (browser) await browser.close().catch(() => {})
    if (app.exitCode === null) app.kill()
    if (!await waitForExit(app, 5_000)) {
        await execFileAsync("taskkill.exe", ["/PID", String(app.pid), "/T", "/F"], { windowsHide: true }).catch(() => {})
    }
    const remaining = await listDaemonChildren(app.pid).catch(() => [])
    for (const candidate of remaining) {
        const pid = assertOwnedDaemon(candidate)
        await execFileAsync(
            "powershell.exe",
            ["-NoProfile", "-Command", `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`],
            { windowsHide: true },
        ).catch(() => {})
    }
}
