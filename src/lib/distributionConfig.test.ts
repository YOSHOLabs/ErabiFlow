import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function readJson<T>(relativePath: string): T {
    return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"))
}

interface ProductionConfig {
    productName: string
    identifier: string
    bundle: {
        targets: string
        createUpdaterArtifacts: boolean
        windows: {
            allowDowngrades: boolean
            webviewInstallMode: { type: string; silent: boolean }
            wix: { upgradeCode: string }
        }
        resources: Record<string, string>
    }
    plugins: { updater: { endpoints: string[] } }
}

interface ReleaseMetadata {
    supportEmail: string
    supportUrl: string
    privacyPolicyUrl: string
    termsUrl: string
    downloadUrl: string
}

test("一般配布metadataはErabiFlow v0.1.0とWindows MSIの識別子を一致させる", () => {
    const packageJson = readJson<{ version: string }>("../../package.json")
    const development = readJson<{ version: string; identifier: string }>("../../src-tauri/tauri.conf.json")
    const production = readJson<ProductionConfig>("../../src-tauri/tauri.production.conf.json")
    const cargoToml = readFileSync(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8")

    assert.equal(packageJson.version, "0.1.0")
    assert.match(cargoToml, /^version = "0\.1\.0"$/m)
    assert.equal(development.version, packageJson.version)
    assert.equal(development.identifier, "com.yosholabs.erabiflow.dev")
    assert.equal(production.productName, "ErabiFlow")
    assert.equal(production.identifier, "com.yosholabs.erabiflow")
    assert.equal(production.bundle.targets, "msi")
    assert.equal(production.bundle.windows.allowDowngrades, false)
    assert.deepEqual(production.bundle.windows.webviewInstallMode, {
        type: "downloadBootstrapper",
        silent: true,
    })
    assert.equal(production.bundle.windows.wix.upgradeCode, "92a6d8f9-c8ab-459e-a6db-6f27376dc45b")
})

test("初回一般配布は自動updaterを無効化しplaceholder URLを含めない", () => {
    const production = readJson<ProductionConfig>("../../src-tauri/tauri.production.conf.json")
    const metadata = readJson<ReleaseMetadata>("../../release/metadata.json")
    const serialized = JSON.stringify({ production, metadata })

    assert.equal(production.bundle.createUpdaterArtifacts, false)
    assert.match(production.plugins.updater.endpoints[0], /^https:\/\/github\.com\/YOSHOLabs\/ErabiFlow\//)
    assert.doesNotMatch(serialized, /example\.invalid|support@example/i)
    assert.equal(metadata.supportEmail, "")
    assert.equal(metadata.supportUrl, "https://github.com/YOSHOLabs/ErabiFlow/issues")
    assert.equal(metadata.privacyPolicyUrl, "", "Privacyは外部公開順序に依存せずアプリ同梱本文を表示する")
    assert.equal(metadata.termsUrl, "", "法務確定前のEULAを配布アプリから開かない")
    assert.equal(metadata.downloadUrl, "https://github.com/YOSHOLabs/ErabiFlow/releases")

    const capability = readFileSync(new URL("../../src-tauri/capabilities/default.json", import.meta.url), "utf8")
    assert.match(capability, /github\.com\/YOSHOLabs\/ErabiFlow\/issues/)
    assert.match(capability, /github\.com\/YOSHOLabs\/ErabiFlow\/releases/)
    assert.doesNotMatch(capability, /github\.com\/YOSHOLabs\/ErabiFlow\/blob\/main\/docs\/PRIVACY\.md/)
})

test("MSIはprivacy・配布要件・third-party noticeを同梱する", () => {
    const production = readJson<ProductionConfig>("../../src-tauri/tauri.production.conf.json")
    const resources = production.bundle.resources

    assert.equal(resources["resources/THIRD_PARTY_NOTICES.txt"], "THIRD_PARTY_NOTICES.txt")
    assert.equal(resources["resources/licenses/"], "licenses/")
    assert.equal(resources["../docs/PRIVACY.md"], "PRIVACY.md")
    assert.equal(resources["../docs/WINDOWS_DISTRIBUTION.md"], "WINDOWS_DISTRIBUTION.md")
    assert.equal(resources["../docs/EULA.md"], "EULA.md")
})

test("一般配布アプリと子プロセスはWindowsでconsole windowを表示しない", () => {
    const main = readFileSync(new URL("../../src-tauri/src/main.rs", import.meta.url), "utf8")
    const daemonSpec = readFileSync(new URL("../../python-sidecar/build_daemon.spec", import.meta.url), "utf8")
    const daemon = readFileSync(new URL("../../src-tauri/src/daemon.rs", import.meta.url), "utf8")
    const audioCommands = readFileSync(new URL("../../src-tauri/src/commands/audio.rs", import.meta.url), "utf8")
    const systemCommands = readFileSync(new URL("../../src-tauri/src/commands/system.rs", import.meta.url), "utf8")
    const audioAnalysis = readFileSync(new URL("../../python-sidecar/pipeline/audio_analysis.py", import.meta.url), "utf8")
    const transcriber = readFileSync(new URL("../../python-sidecar/pipeline/transcriber.py", import.meta.url), "utf8")

    assert.match(main, /windows_subsystem\s*=\s*"windows"/)
    assert.match(daemonSpec, /console=False/)
    assert.doesNotMatch(daemonSpec, /console=True/)
    assert.match(daemon, /cmd\.creation_flags\(0x0800_0000\)/)
    assert.match(audioCommands, /ffprobe_command\.creation_flags\(0x0800_0000\)/)
    assert.match(systemCommands, /\.creation_flags\(0x0800_0000\)/)
    assert.match(audioAnalysis, /creationflags=no_window_creation_flags\(\)/)
    assert.match(transcriber, /creationflags=no_window_creation_flags\(\)/)
})
