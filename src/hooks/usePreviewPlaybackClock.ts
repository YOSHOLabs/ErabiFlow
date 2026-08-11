import { useEffect, type MutableRefObject, type RefObject } from "react"
import { getTimelineClipSpeed, type TimelineLayoutClip } from "../lib/timeline.ts"
import type { TimelineClip } from "../lib/types.ts"
import {
    advancePreviewSequenceTime,
    hasReachedPreviewEnd,
    sequenceTimeFromPresentedMedia,
} from "../lib/previewClock.ts"
import { useEditorStore } from "../stores/editor.ts"

export interface PreviewMediaTimeInfo {
    clip: TimelineLayoutClip
    clipIdx: number
    clipAccTime: number
    mediaTime: number
}

interface PreviewPlaybackClockInput {
    videoRef: RefObject<HTMLVideoElement | null>
    audioRef: RefObject<HTMLAudioElement | null>
    isPlaying: boolean
    sequenceDuration: number
    sourceFps: number
    playbackSequenceTimeRef: MutableRefObject<number>
    drawFrameRef: MutableRefObject<(sequenceTime?: number, mediaTime?: number) => void>
    getMediaTimeInfo: (sequenceTime: number) => PreviewMediaTimeInfo | null
    syncBgm: (sequenceTime: number, shouldPlay: boolean, tolerance?: number) => void
    syncAdditionalTracks: (sequenceTime: number, shouldPlay: boolean, tolerance?: number) => void
    applyClipPlayback: (video: HTMLVideoElement, clip: TimelineClip | null, localTime?: number) => void
}

/**
 * メディア要素の時刻をSequence Timeへ写像する再生時計。
 * React描画とは独立して進み、UIへのpublishだけを12fpsへ抑える。
 */
export function usePreviewPlaybackClock({
    videoRef,
    audioRef,
    isPlaying,
    sequenceDuration,
    sourceFps,
    playbackSequenceTimeRef,
    drawFrameRef,
    getMediaTimeInfo,
    syncBgm,
    syncAdditionalTracks,
    applyClipPlayback,
}: PreviewPlaybackClockInput) {
    useEffect(() => {
        const video = videoRef.current
        const audio = audioRef.current
        if (!video) return
        const editor = useEditorStore.getState()

        if (isPlaying) {
            const initialSequenceTime = editor.previewTime
            playbackSequenceTimeRef.current = initialSequenceTime
            const initialInfo = getMediaTimeInfo(initialSequenceTime)
            if (initialInfo && !initialInfo.clip.isGap) {
                applyClipPlayback(video, initialInfo.clip, initialSequenceTime - initialInfo.clipAccTime)
                if (Math.abs(video.currentTime - initialInfo.mediaTime) > 0.05) video.currentTime = initialInfo.mediaTime
                video.play().catch((error) => {
                    console.error("Playback failed:", error)
                    useEditorStore.getState().setIsPlaying(false)
                })
            } else {
                video.pause()
            }
            syncBgm(initialSequenceTime, true)
            syncAdditionalTracks(initialSequenceTime, true)
        } else {
            video.pause()
            syncBgm(editor.previewTime, false)
            syncAdditionalTracks(editor.previewTime, false)
        }

        let rafId = 0
        let lastTimestamp = performance.now()
        let lastUiPublish = 0
        let lastFallbackDraw = 0
        const hasVideoFrameCallback = typeof video.requestVideoFrameCallback === "function"

        const publishSequenceTime = (time: number, timestamp: number, force = false) => {
            playbackSequenceTimeRef.current = time
            if (force || timestamp - lastUiPublish >= 1000 / 12) {
                lastUiPublish = timestamp
                useEditorStore.getState().setPreviewTime(time)
            }
        }

        const stopAt = (time: number) => {
            useEditorStore.getState().setPreviewTime(time)
            useEditorStore.getState().setIsPlaying(false)
        }

        const play = (clip: TimelineClip, localTime: number, failureContext: string) => {
            applyClipPlayback(video, clip, localTime)
            video.play().catch((error) => {
                console.error(failureContext, error)
                useEditorStore.getState().setIsPlaying(false)
            })
        }

        const loop = (timestamp: number) => {
            if (!useEditorStore.getState().isPlaying) return
            const deltaSec = (timestamp - lastTimestamp) / 1000
            lastTimestamp = timestamp
            const currentSequenceTime = playbackSequenceTimeRef.current
            syncBgm(currentSequenceTime, true, 0.35)
            syncAdditionalTracks(currentSequenceTime, true, 0.35)

            if (hasReachedPreviewEnd(currentSequenceTime, sequenceDuration)) {
                video.pause()
                audio?.pause()
                playbackSequenceTimeRef.current = 0
                stopAt(0)
                return
            }

            const info = getMediaTimeInfo(currentSequenceTime)
            if (!info) {
                stopAt(sequenceDuration)
                return
            }

            const clip = info.clip
            let nextSequenceTime = currentSequenceTime
            let forcePublish = false

            if (clip.isGap) {
                video.pause()
                nextSequenceTime = advancePreviewSequenceTime(
                    currentSequenceTime,
                    deltaSec,
                    info.clipAccTime + clip.mediaStart,
                )
                if (nextSequenceTime >= info.clipAccTime + clip.mediaStart) {
                    const nextInfo = getMediaTimeInfo(nextSequenceTime + 0.01)
                    if (nextInfo && !nextInfo.clip.isGap) {
                        video.currentTime = nextInfo.clip.mediaStart
                        play(nextInfo.clip, 0, "Playback failed after gap:")
                        nextSequenceTime = nextInfo.clipAccTime
                        forcePublish = true
                    }
                }
            } else if (clip.reverse || clip.freezeFrame !== undefined || clip.speedCurve?.length) {
                video.pause()
                nextSequenceTime = advancePreviewSequenceTime(
                    currentSequenceTime,
                    deltaSec,
                    info.clipAccTime + clip.duration,
                )
                const advancedInfo = getMediaTimeInfo(Math.min(nextSequenceTime, info.clipAccTime + clip.duration - 0.0001))
                if (advancedInfo && !advancedInfo.clip.isGap && Math.abs(video.currentTime - advancedInfo.mediaTime) > 0.015) {
                    video.currentTime = advancedInfo.mediaTime
                }
                if (nextSequenceTime >= info.clipAccTime + clip.duration) forcePublish = true
            } else {
                applyClipPlayback(video, clip, currentSequenceTime - info.clipAccTime)
                if (video.currentTime >= clip.mediaEnd) {
                    const nextInfo = getMediaTimeInfo(info.clipAccTime + clip.duration + 0.01)
                    if (!nextInfo) {
                        stopAt(sequenceDuration)
                        return
                    }
                    if (!nextInfo.clip.isGap) {
                        video.currentTime = nextInfo.clip.mediaStart
                        play(nextInfo.clip, 0, "Playback failed after clip change:")
                    } else {
                        video.pause()
                    }
                    nextSequenceTime = nextInfo.clipAccTime
                    forcePublish = true
                } else {
                    nextSequenceTime = sequenceTimeFromPresentedMedia({
                        mediaTime: video.currentTime,
                        mediaStart: clip.mediaStart,
                        sequenceStart: info.clipAccTime,
                        sequenceEnd: info.clipAccTime + clip.duration,
                        speed: getTimelineClipSpeed(clip),
                    })
                }
            }

            publishSequenceTime(nextSequenceTime, timestamp, forcePublish)
            const fps = Math.max(1, Math.min(120, sourceFps))
            if (!hasVideoFrameCallback && timestamp - lastFallbackDraw >= 1000 / fps) {
                lastFallbackDraw = timestamp
                drawFrameRef.current(nextSequenceTime, video.currentTime)
            }
            rafId = requestAnimationFrame(loop)
        }

        if (isPlaying) rafId = requestAnimationFrame(loop)
        return () => {
            if (rafId) cancelAnimationFrame(rafId)
            video.pause()
            audio?.pause()
            const sequenceTime = useEditorStore.getState().previewTime
            syncBgm(sequenceTime, false)
            syncAdditionalTracks(sequenceTime, false)
        }
    }, [
        applyClipPlayback,
        audioRef,
        drawFrameRef,
        getMediaTimeInfo,
        isPlaying,
        playbackSequenceTimeRef,
        sequenceDuration,
        sourceFps,
        syncAdditionalTracks,
        syncBgm,
        videoRef,
    ])
}
