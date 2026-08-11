import { useEffect, useMemo, useState } from "react"
import { commands } from "@/tauri/commands"

interface ResolvedPreviewFont {
    cssFamily: string
    warning: string | null
    isLoading: boolean
}

const loadedFonts = new Map<string, Promise<string>>()

function inTauri() {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

function protocolUrl(path: string) {
    const isWindows = /Windows/i.test(navigator.userAgent)
    const protocol = isWindows ? "http://vfocus.localhost" : "vfocus://"
    return `${protocol}/media/${encodeURIComponent(path)}`
}

function familyKey(path: string) {
    let hash = 2166136261
    for (let index = 0; index < path.length; index += 1) {
        hash ^= path.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return `TateClip_${(hash >>> 0).toString(16)}`
}

function loadFont(path: string) {
    const cached = loadedFonts.get(path)
    if (cached) return cached
    const promise = (async () => {
        const family = familyKey(path)
        const face = new FontFace(family, `url("${protocolUrl(path)}")`)
        await face.load()
        document.fonts.add(face)
        return family
    })()
    loadedFonts.set(path, promise)
    promise.catch(() => loadedFonts.delete(path))
    return promise
}

function browserFallback(reference: string) {
    if (reference.includes("meiryo")) return "Meiryo"
    if (reference.includes("yu-gothic")) return "Yu Gothic"
    if (reference.includes("arial")) return "Arial"
    if (reference.includes("impact")) return "Impact"
    if (reference.includes("segoe")) return "Segoe UI"
    return reference.replace(/['"]/g, "") || "sans-serif"
}

/** Rust書き出しと同じ字形対応判定を使い、実ファイルをCanvasへ読み込む。 */
export function useResolvedFont(reference: string, text: string): ResolvedPreviewFont {
    const glyphSample = useMemo(() => {
        const unique = Array.from(new Set(Array.from(text || "TateClip")))
        return unique.slice(0, 2048).join("")
    }, [text])
    const [state, setState] = useState<ResolvedPreviewFont>({
        cssFamily: browserFallback(reference),
        warning: null,
        isLoading: inTauri(),
    })

    useEffect(() => {
        let active = true
        if (!inTauri()) {
            setState({ cssFamily: browserFallback(reference), warning: null, isLoading: false })
            return
        }
        setState((current) => ({ ...current, isLoading: true }))
        commands.resolveFontPreview({ fontRef: reference, text: glyphSample })
            .then(async (resolution) => {
                const cssFamily = await loadFont(resolution.path)
                if (active) {
                    setState({ cssFamily, warning: resolution.warning, isLoading: false })
                }
            })
            .catch((cause) => {
                if (active) {
                    setState({
                        cssFamily: browserFallback(reference),
                        warning: `フォントを読み込めません: ${String(cause)}`,
                        isLoading: false,
                    })
                }
            })
        return () => {
            active = false
        }
    }, [reference, glyphSample])

    return state
}
