import { defineConfig } from "@playwright/test"

export default defineConfig({
    testDir: "./e2e-release",
    timeout: 60_000,
    use: {
        baseURL: "http://127.0.0.1:1422",
        viewport: { width: 1440, height: 900 },
    },
    webServer: {
        command: "npm run preview -- --host 127.0.0.1 --port 1422",
        url: "http://127.0.0.1:1422",
        reuseExistingServer: false,
        timeout: 30_000,
    },
})
