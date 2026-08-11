#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { sign } from "node:crypto"

function argumentsMap(values) {
    const result = new Map()
    for (let index = 0; index < values.length; index += 2) {
        const key = values[index]
        const value = values[index + 1]
        if (!key?.startsWith("--") || value === undefined) {
            throw new Error(`引数が不正です: ${key ?? ""}`)
        }
        result.set(key.slice(2), value)
    }
    return result
}

function required(args, name) {
    const value = args.get(name)?.trim()
    if (!value) throw new Error(`--${name} が必要です`)
    return value
}

const args = argumentsMap(process.argv.slice(2))
const installationId = required(args, "installation-id")
const licenseId = required(args, "license-id")
const privateKeyPath = args.get("private-key") ?? join(homedir(), ".vfocus-license", "creator-license-private.pem")
const days = args.has("days") ? Number(args.get("days")) : null
if (days !== null && (!Number.isInteger(days) || days <= 0)) {
    throw new Error("--days は1以上の整数にしてください")
}

const now = Math.floor(Date.now() / 1000)
const claims = {
    version: 1,
    licenseId,
    installationId,
    plan: "creator",
    issuedAt: now,
    expiresAt: days === null ? null : now + days * 24 * 60 * 60,
}
const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")
const privateKey = readFileSync(privateKeyPath, "utf8")
const signature = sign(null, Buffer.from(payload, "ascii"), privateKey).toString("base64url")

process.stdout.write(`vf1.${payload}.${signature}\n`)
