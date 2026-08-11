import { useEffect, useRef } from "react"
import { useDocumentStore } from "@/stores/document"

function disposeAudio(audio: HTMLAudioElement) {
    audio.pause()
    audio.removeAttribute("src")
    audio.load()
}

export function useSePlayback(
    previewTime: number,
    isPlaying: boolean,
    volume: number,
    enabled = true,
) {
    const seSlots = useDocumentStore(s => s.seSlots)
    
    // Audio要素を保持するRef
    const audioRefs = useRef<{ [id: string]: HTMLAudioElement }>({})
    // 既に再生済みかどうかのフラグ（同じ時間帯での重複再生防止）
    const playedFlags = useRef<{ [id: string]: boolean }>({})

    useEffect(() => {
        if (!enabled) {
            Object.values(audioRefs.current).forEach(disposeAudio)
            audioRefs.current = {}
            playedFlags.current = {}
            return
        }
        // SEスロットが更新されたらAudio要素を作り直す
        const newRefs: { [id: string]: HTMLAudioElement } = {}
        const isWindows = /Windows/i.test(navigator.userAgent)
        const protocol = isWindows ? "http://vfocus.localhost" : "vfocus://"

        seSlots.forEach((se: any) => {
            if (audioRefs.current[se.id]) {
                newRefs[se.id] = audioRefs.current[se.id]
                newRefs[se.id].volume = (se.volume ?? 1.0) * volume
            } else {
                let src = ""
                try {
                    src = `${protocol}/media/${encodeURIComponent(se.path)}`
                } catch {
                    src = ""
                }
                const audio = new Audio(src)
                audio.volume = (se.volume ?? 1.0) * volume
                newRefs[se.id] = audio
            }
        })

        // 不要になったAudio要素を破棄
        Object.keys(audioRefs.current).forEach(id => {
            if (!newRefs[id]) {
                disposeAudio(audioRefs.current[id])
            }
        })

        audioRefs.current = newRefs
    }, [seSlots, volume, enabled])

    useEffect(() => () => {
        Object.values(audioRefs.current).forEach(disposeAudio)
        audioRefs.current = {}
        playedFlags.current = {}
    }, [])

    // 再生位置の監視とトリガー
    useEffect(() => {
        if (!enabled || !isPlaying) {
            Object.values(audioRefs.current).forEach((audio) => audio.pause())
            playedFlags.current = {}
            return
        }

        seSlots.forEach((se: any) => {
            const triggerTime = se.triggerTime
            // previewTimeがtriggerTimeを0.1秒以内の誤差で通過し、かつ未再生の場合
            if (
                previewTime >= triggerTime &&
                previewTime <= triggerTime + 0.15 &&
                !playedFlags.current[se.id]
            ) {
                const audio = audioRefs.current[se.id]
                if (audio) {
                    audio.currentTime = 0
                    audio.play().catch(e => console.warn("SE playback failed:", e))
                    playedFlags.current[se.id] = true
                }
            } else if (previewTime < triggerTime) {
                // 時間が巻き戻った場合はフラグをリセット
                playedFlags.current[se.id] = false
            }
        })
    }, [previewTime, isPlaying, seSlots, enabled])
}
