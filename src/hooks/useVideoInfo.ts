import { useDocumentStore } from "@/stores/document"
/**
 * useVideoInfo.ts
 *
 * inputPath が変化したら get_video_info コマンドを呼び出し、
 * Zustand ストアの videoInfo を更新するカスタムフック。
 * 同時に波形データも取得する。
 */

import { useEffect, useState } from "react"
import { commands } from "@/tauri/commands"
import { isTauriEnv } from "@/lib/utils"
import { createFullSourceClip } from "@/lib/timeline"
import { createMediaAsset } from "@/lib/mediaLibrary"

export function useVideoInfo() {
    const [runtimeRevision, setRuntimeRevision] = useState(0)
    const inputPath = useDocumentStore((s) => s.inputPath)
    const setVideoInfo = useDocumentStore((s) => s.setVideoInfo)
    const setWaveformData = useDocumentStore((s) => s.setWaveformData)
    const setTimelineClips = useDocumentStore((s) => s.setTimelineClips)
    const addMediaAssets = useDocumentStore((s) => s.addMediaAssets)
    const updateMediaAsset = useDocumentStore((s) => s.updateMediaAsset)

    useEffect(() => {
        const handleRuntimeReady = () => setRuntimeRevision((value) => value + 1)
        window.addEventListener("vfocus:ffmpeg-runtime-ready", handleRuntimeReady)
        return () => window.removeEventListener("vfocus:ffmpeg-runtime-ready", handleRuntimeReady)
    }, [])

    useEffect(() => {
        if (!inputPath) {
            setVideoInfo(null)
            setWaveformData([])
            return
        }
        if (!isTauriEnv()) return

        let cancelled = false

        commands.getVideoInfo({ inputPath })
            .then((info) => {
                if (cancelled) return
                setVideoInfo(info)

                // 素材を開いた時点から通常の動画編集を始められるよう、
                // 新規素材だけ元動画全体を最初のクリップとして配置する。
                const current = useDocumentStore.getState()
                const libraryAsset = current.mediaAssets.find((asset) => asset.path.toLocaleLowerCase() === inputPath.toLocaleLowerCase())
                if (libraryAsset) {
                    updateMediaAsset(libraryAsset.id, {
                        duration: info.duration,
                        width: info.width,
                        height: info.height,
                    fps: info.fps,
                    hasAudio: info.hasAudio,
                    })
                } else {
                    const asset = createMediaAsset(inputPath)
                    if (asset) addMediaAssets([{ ...asset, ...info }])
                }
                if (current.inputPath === inputPath && current.timelineClips.length === 0 && info.duration > 0) {
                    setTimelineClips([createFullSourceClip(info.duration)])
                }
            })
            .catch((err) => {
                // Rust 側の取得失敗時は VideoPreview の loadeddata に任せる
                console.warn("get_video_info failed (will use video element fallback):", err)
            })

        // 波形データも非同期で取得 (拡大時にも綺麗に見えるよう100SPSで高精細に取得)
        commands.getWaveformData({ inputPath, samplesPerSecond: 100 })
            .then((data) => {
                if (!cancelled) {
                    setWaveformData(data)
                }
            })
            .catch((err) => {
                console.warn("get_waveform_data failed:", err)
            })

        return () => { cancelled = true }
    }, [addMediaAssets, inputPath, runtimeRevision, setTimelineClips, setVideoInfo, setWaveformData, updateMediaAsset])
}
