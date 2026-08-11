import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
    args.set(process.argv[index], process.argv[index + 1])
}

const endpoint = args.get("--url")
if (!endpoint) throw new Error("--url は必須です")

const url = new URL(endpoint)
if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("更新URLは認証情報とハッシュを含まないHTTPS URLにしてください")
}
if (url.hostname === "example.invalid") {
    throw new Error("仮の更新URLは設定できません")
}

const configPath = resolve(root, "src-tauri", "tauri.production.conf.json")
const config = JSON.parse(await readFile(configPath, "utf8"))
config.plugins ??= {}
config.plugins.updater ??= {}
config.plugins.updater.endpoints = [url.href]
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
console.log(`stable 更新URLを設定しました: ${url.href}`)
