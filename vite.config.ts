import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Tauri expects a fixed port
  server: {
    port: 1420,
    strictPort: true,
  },
  // Build output for Tauri
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Tauri uses Chromium, so modern JS is fine
    target: "esnext",
  },
})
