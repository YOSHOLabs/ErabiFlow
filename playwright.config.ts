import { defineConfig } from "@playwright/test"

export default defineConfig({
    testDir: "./e2e",
    timeout: 60_000,
    use: {
        baseURL: "http://127.0.0.1:1420",
        viewport: { width: 1440, height: 900 },
    },
    webServer: {
        command: "npm run dev -- --host 127.0.0.1",
        url: "http://127.0.0.1:1420",
        reuseExistingServer: true,
        timeout: 90_000,
    },
})
