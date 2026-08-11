import type { VFocusDocument } from "../stores/document.ts"
import type { OverlayImage, SeSlot, TimelineClip, TrackMediaClip } from "./types.ts"
import { DUCKING_PRESETS } from "./types.ts"
import { DEFAULT_WATERMARK } from "./types.ts"
import type { SequenceSubtitle } from "./timeline.ts"
import { getSequenceDuration, subtitlesToSequence } from "./timeline.ts"
import { getEffectiveBgmEnd } from "./bgm.ts"
import { toRoughCutClips } from "./roughCut.ts"

export interface RenderSpec {
    version: 2
    canvas: {
        width: number
        height: number
        aspect: string
    }
    source: {
        path: string
        duration: number
        width: number
        height: number
    }
    sequence: {
        clips: TimelineClip[]
    }
    layout: {
        kind: "source" | "commentary" | "portrait" | "stage"
        gameY: number
        gameScale: number
        cropData: string | null
    }
    layers: {
        title: {
            text: string
            x: number
            y: number
            font: string
            color: string
            size: number
            strokeColor: string
            strokeWidth: number
            shadowColor: string
            shadowBlur: number
            startTime: number
            endTime: number | null
        } | null
        watermark: {
            text: string
            font: string
            color: string
            size: number
            opacity: number
            position: import("./types.ts").WatermarkPosition
        } | null
        subtitles: {
            segments: SequenceSubtitle[]
            font: string
            color: string
            size: number
            strokeColor: string
            strokeWidth: number
            shadowColor: string
            shadowBlur: number
            y: number
            emphasisMode: "none" | "karaoke"
            emphasisColor: string
        } | null
        avatar: {
            path: string
            x: number
            y: number
            scale: number
        } | null
        bgm: {
            path: string
            volume: number
            timelineStart: number
            timelineEnd: number
            trimStart: number
        } | null
        se: SeSlot[]
        images: OverlayImage[]
        trackClips: (TrackMediaClip & {
            sourceFps?: number
            trackOrder: number
            renderVideo: boolean
            renderAudio: boolean
        })[]
    }
    audio: {
        ducking: {
            enabled: boolean
            preset: string
            mainVoice: number
            bgm: number
            se: number
        }
    }
}

function effectiveClips(document: VFocusDocument): TimelineClip[] {
    const duration = document.videoInfo?.duration ?? 0
    if (document.timelineClips.length > 0) return document.timelineClips
    if (duration <= 0) return []

    const start = document.trim.start > 0 ? document.trim.start : 0
    const end = document.trim.end > start ? document.trim.end : duration
    return [{ id: "source", mediaStart: start, mediaEnd: end }]
}

export function buildRenderSpec(document: VFocusDocument, cropData: string | null = null): RenderSpec {
    const sourceLayout = document.game.layoutMode === "source"
    const effectiveSequence = effectiveClips(document)
    const clips = sourceLayout ? toRoughCutClips(effectiveSequence) : effectiveSequence
    const sequenceDuration = getSequenceDuration(clips)
    const bgmTrimStart = document.bgmTrimStart ?? 0
    const exportSubtitles = subtitlesToSequence(clips, document.subtitles)
    const duckingPreset = DUCKING_PRESETS[document.ducking.preset]
    const watermark = document.watermark ?? DEFAULT_WATERMARK
    const sourceWidth = Math.max(2, document.videoInfo?.width ?? 1920)
    const sourceHeight = Math.max(2, document.videoInfo?.height ?? 1080)
    const canvasWidth = sourceLayout ? sourceWidth : 1080
    const canvasHeight = sourceLayout ? sourceHeight : 1920

    return {
        version: 2,
        canvas: {
            width: canvasWidth,
            height: canvasHeight,
            aspect: sourceLayout ? `${canvasWidth}:${canvasHeight}` : "9:16",
        },
        source: {
            path: document.inputPath,
            duration: document.videoInfo?.duration ?? 0,
            width: sourceWidth,
            height: sourceHeight,
        },
        sequence: {
            clips,
        },
        layout: {
            kind: document.game.layoutMode ?? "source",
            gameY: Math.round(document.game.positionY * canvasHeight),
            gameScale: sourceLayout ? 1 : document.game.scale ?? 1,
            cropData: sourceLayout ? null : cropData,
        },
        layers: {
            title: !sourceLayout && document.text.content ? {
                text: document.text.content,
                x: Math.round(document.text.position.x * canvasWidth),
                y: Math.round(document.text.position.y * canvasHeight),
                font: document.text.font,
                color: document.text.color,
                size: document.text.size,
                strokeColor: document.text.strokeColor,
                strokeWidth: document.text.strokeWidth,
                shadowColor: document.text.shadowColor,
                shadowBlur: document.text.shadowBlur,
                startTime: document.text.startTime,
                endTime: document.text.endTime,
            } : null,
            watermark: !sourceLayout && watermark.enabled && watermark.text.trim() ? {
                text: watermark.text.trim(),
                font: watermark.font,
                color: watermark.color,
                size: watermark.size,
                opacity: watermark.opacity,
                position: watermark.position,
            } : null,
            subtitles: !sourceLayout && exportSubtitles.length > 0 ? {
                segments: exportSubtitles,
                font: document.subtitleStyle.font,
                color: document.subtitleStyle.color,
                size: document.subtitleStyle.size,
                strokeColor: document.subtitleStyle.strokeColor,
                strokeWidth: document.subtitleStyle.strokeWidth,
                shadowColor: document.subtitleStyle.shadowColor,
                shadowBlur: document.subtitleStyle.shadowBlur,
                y: document.subtitleStyle.positionY,
                emphasisMode: document.subtitleStyle.emphasisMode,
                emphasisColor: document.subtitleStyle.emphasisColor,
            } : null,
            avatar: !sourceLayout && document.avatarPath ? {
                path: document.avatarPath,
                x: Math.round(document.avatar.position.x * canvasWidth),
                y: Math.round(document.avatar.position.y * canvasHeight),
                scale: document.avatar.scale,
            } : null,
            bgm: !sourceLayout && document.bgmPath ? {
                path: document.bgmPath,
                volume: document.bgmVolume,
                timelineStart: document.bgmStart,
                timelineEnd: getEffectiveBgmEnd({
                    sequenceDuration,
                    start: document.bgmStart,
                    end: document.bgmEnd ?? null,
                    trimStart: bgmTrimStart,
                    sourceDuration: document.bgmSourceDuration ?? null,
                }),
                trimStart: bgmTrimStart,
            } : null,
            se: sourceLayout ? [] : document.seSlots,
            images: sourceLayout ? [] : document.images,
            trackClips: (sourceLayout ? [] : document.trackMediaClips ?? []).map((clip) => {
                const editorTracks = document.editorTracks ?? []
                const trackOrder = editorTracks.findIndex((track) => track.id === clip.trackId)
                const track = editorTracks[trackOrder]
                const asset = (document.mediaAssets ?? []).find((candidate) => candidate.id === clip.assetId || candidate.path === clip.path)
                return {
                    ...clip,
                    sourceFps: asset?.fps,
                    trackOrder: Math.max(0, trackOrder),
                    renderVideo: clip.kind === "video" && Boolean(track) && !track.hidden,
                    renderAudio: clip.hasAudio && !clip.muted && Boolean(track) && !track.muted,
                }
            }).filter((clip) => clip.renderVideo || clip.renderAudio),
        },
        audio: {
            ducking: {
                enabled: !sourceLayout && document.ducking.enabled,
                preset: document.ducking.preset,
                mainVoice: duckingPreset.mainVoice,
                bgm: duckingPreset.bgm,
                se: duckingPreset.se,
            },
        },
    }
}
