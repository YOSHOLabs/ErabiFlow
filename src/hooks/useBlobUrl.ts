/**
 * useBlobUrl.ts
 *
 * ローカルファイルパスを Blob URL に変換するカスタムフック。
 * Tauri の readFile API を使ってバイナリを読み込み、
 * ブラウザの Blob URL を生成する。
 *
 * asset protocol (https://asset.localhost/) が CORS の制約で
 * Canvas 描画に使えない問題を回避する。
 */

import { useEffect, useState } from "react"
import { readFile } from "@tauri-apps/plugin-fs"

/**
 * ファイルパスを Blob URL に変換する
 * @param filePath ローカルファイルパス（空文字なら null を返す）
 * @param mimeType MIME タイプ（"video/mp4" など）
 */
export function useBlobUrl(filePath: string, mimeType: string): string | null {
    const [blobUrl, setBlobUrl] = useState<string | null>(null)

    useEffect(() => {
        if (!filePath) {
            setBlobUrl(null)
            return
        }

        let revoked = false
        let currentUrl: string | null = null

            ; (async () => {
                try {
                    const bytes = await readFile(filePath)
                    if (revoked) return
                    const blob = new Blob([bytes], { type: mimeType })
                    currentUrl = URL.createObjectURL(blob)
                    setBlobUrl(currentUrl)
                } catch (err) {
                    console.warn("useBlobUrl: ファイル読み込み失敗:", filePath, err)
                    setBlobUrl(null)
                }
            })()

        return () => {
            revoked = true
            if (currentUrl) {
                URL.revokeObjectURL(currentUrl)
            }
        }
    }, [filePath, mimeType])

    return blobUrl
}
