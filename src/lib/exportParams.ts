/**
 * exportParams.ts
 *
 * 書き出しはまず RenderSpec を作り、その RenderSpec から Rust 側の
 * ProcessParams 互換オブジェクトへ変換する。
 *
 * これにより、プレビュー/書き出し/将来のFFmpegコンパイラが同じ
 * RenderSpec を中心に動けるようにする。
 */

import type { VFocusDocument } from "../stores/document.ts"
import { buildRenderSpec, type RenderSpec } from "./renderSpec.ts"
import type { SubtitleStyleOverride } from "./types.ts"
import type { ClipColorAdjustments, ClipKeyframe, ClipMotionPreset, ClipTransition, ClipVisualEffects } from "./types.ts"
import { getTimelineClipSpeed, getTimelineClipTransform, getTimelineClipVolume } from "./timeline.ts"

export interface ExportProcessParams {
    inputPath: string
    outputPath: string
    exportFormat: "mp4" | "mov" | "gif" | "png_sequence"
    videoCodec: "h264" | "h265"
    outputWidth: number
    outputHeight: number
    outputFps: number
    videoBitrateKbps: number
    renderSpec: RenderSpec
    gpuType: string
    layout: "source" | "commentary" | "portrait" | "stage"
    enableJumpCut: boolean
    jumpCutConfig: {
        thresholdDb: number
        minDuration: number
        padding: number
    } | null
    cropData: string | null
    trimStart: number | null
    trimDuration: number | null
    clips: {
        isGap: boolean
        start: number
        end: number
        speed: number
        volume: number
        muted: boolean
        positionX: number
        positionY: number
        scale: number
        rotation: number
        flipHorizontal: boolean
        flipVertical: boolean
        opacity: number
        keyframes?: ClipKeyframe[]
        transitionIn?: ClipTransition
        transitionOut?: ClipTransition
        motionPreset?: ClipMotionPreset
        color?: ClipColorAdjustments
        effects?: ClipVisualEffects
        speedCurve?: import("./types.ts").SpeedCurvePoint[]
        reverse?: boolean
        freezeFrame?: number
        freezeDuration?: number
        audioEffects?: import("./types.ts").ClipAudioEffects
    }[] | null
    gameY: number
    gameScale: number
    text: {
        content: string | null
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
    }
    subtitle: {
        segments: {
            id: string
            text: string
            startTime: number
            endTime: number
            emotion: string
            styleOverride?: SubtitleStyleOverride
        }[]
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
        start: number | null
        timelineStart: number
        timelineEnd: number
    } | null
    seSlots: {
        path: string
        volume: number
        triggerTime: number
    }[] | null
    overlayImages: {
        path: string
        x: number
        y: number
        scale: number
        startTime: number
        endTime: number
    }[] | null
    trackClips: RenderSpec["layers"]["trackClips"] | null
    ducking: {
        enabled: boolean
        preset: string
        mainVoice: number
        bgm: number
        se: number
    } | null
}

export interface ExportSettings {
    format: ExportProcessParams["exportFormat"]
    codec: ExportProcessParams["videoCodec"]
    width: number
    height: number
    fps: number
    bitrateKbps: number
}

/** width/height/fps の 0 は元動画を維持する指定。 */
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = { format: "mp4", codec: "h264", width: 0, height: 0, fps: 0, bitrateKbps: 12000 }

export function resolveSourceExportSettings(
    settings: ExportSettings,
    videoInfo: VFocusDocument["videoInfo"],
): ExportSettings {
    return {
        ...settings,
        width: settings.width > 0 ? settings.width : Math.max(128, videoInfo?.width ?? 1920),
        height: settings.height > 0 ? settings.height : Math.max(128, videoInfo?.height ?? 1080),
        fps: settings.fps > 0 ? settings.fps : Math.max(1, videoInfo?.fps ?? 30),
    }
}

function buildOutputPath(inputPath: string, format: ExportSettings["format"] = "mp4") {
    const lastSlash = Math.max(inputPath.lastIndexOf("\\"), inputPath.lastIndexOf("/"))
    const lastDot = inputPath.lastIndexOf(".")
    const base = lastDot > lastSlash ? inputPath.slice(0, lastDot) : inputPath
    // Rust側はH.264/AACのMP4を書き出すため、素材の拡張子には引きずられない。
    if (format === "png_sequence") return `${base}_tateclip_roughcut_%05d.png`
    return `${base}_tateclip_roughcut.${format}`
}

export function renderSpecToProcessParams(
    document: VFocusDocument,
    renderSpec: RenderSpec,
    outputPath?: string,
    settings: ExportSettings = DEFAULT_EXPORT_SETTINGS,
): ExportProcessParams {
    const resolvedSettings = resolveSourceExportSettings(settings, document.videoInfo)
    const title = renderSpec.layers.title
    const subtitle = renderSpec.layers.subtitles
    const avatar = renderSpec.layers.avatar
    const bgm = renderSpec.layers.bgm
    const ducking = renderSpec.audio.ducking
    const sourceLayout = renderSpec.layout.kind === "source"

    return {
        inputPath: renderSpec.source.path,
        outputPath: outputPath ?? buildOutputPath(renderSpec.source.path, settings.format),
        exportFormat: settings.format,
        videoCodec: settings.codec,
        outputWidth: Math.max(128, Math.round(resolvedSettings.width / 2) * 2),
        outputHeight: Math.max(128, Math.round(resolvedSettings.height / 2) * 2),
        outputFps: Math.max(1, Math.min(120, resolvedSettings.fps)),
        videoBitrateKbps: Math.max(256, Math.min(100000, settings.bitrateKbps)),
        renderSpec,
        gpuType: document.processing.gpuType,
        layout: renderSpec.layout.kind,
        enableJumpCut: !sourceLayout && document.processing.enableJumpCut,
        jumpCutConfig: !sourceLayout && document.processing.enableJumpCut ? {
            thresholdDb: document.processing.jumpCutConfig.thresholdDb,
            minDuration: document.processing.jumpCutConfig.minDuration,
            padding: document.processing.jumpCutConfig.padding,
        } : null,
        cropData: renderSpec.layout.cropData,
        trimStart: null,
        trimDuration: null,
        clips: renderSpec.sequence.clips.length > 0
            ? renderSpec.sequence.clips.map((clip) => {
                const transform = getTimelineClipTransform(clip)
                return {
                    isGap: !!clip.isGap,
                    start: clip.mediaStart,
                    end: clip.mediaEnd,
                    speed: getTimelineClipSpeed(clip),
                    volume: getTimelineClipVolume(clip),
                    muted: clip.muted === true,
                    positionX: transform.positionX,
                    positionY: transform.positionY,
                    scale: transform.scale,
                    rotation: transform.rotation,
                    flipHorizontal: transform.flipHorizontal,
                    flipVertical: transform.flipVertical,
                    opacity: transform.opacity,
                    ...(clip.keyframes?.length ? { keyframes: clip.keyframes } : {}),
                    ...(clip.transitionIn ? { transitionIn: clip.transitionIn } : {}),
                    ...(clip.transitionOut ? { transitionOut: clip.transitionOut } : {}),
                    ...(clip.motionPreset && clip.motionPreset !== "none" ? { motionPreset: clip.motionPreset } : {}),
                    ...(clip.color ? { color: clip.color } : {}),
                    ...(clip.effects ? { effects: clip.effects } : {}),
                    ...(clip.speedCurve?.length ? { speedCurve: clip.speedCurve } : {}),
                    ...(clip.reverse ? { reverse: true } : {}),
                    ...(clip.freezeFrame !== undefined ? { freezeFrame: clip.freezeFrame, freezeDuration: clip.freezeDuration ?? 2 } : {}),
                    ...(clip.audioEffects ? { audioEffects: clip.audioEffects } : {}),
                }
            })
            : null,
        gameY: renderSpec.layout.gameY,
        gameScale: renderSpec.layout.gameScale,
        text: {
            content: title?.text || null,
            x: title?.x ?? 540,
            y: title?.y ?? 115,
            font: title?.font ?? "Arial",
            color: title?.color ?? "#FFFFFF",
            size: title?.size ?? 44,
            strokeColor: title?.strokeColor ?? "#000000",
            strokeWidth: title?.strokeWidth ?? 3,
            shadowColor: title?.shadowColor ?? "rgba(0,0,0,0.5)",
            shadowBlur: title?.shadowBlur ?? 0,
            startTime: title?.startTime ?? 0,
            endTime: title?.endTime ?? null,
        },
        subtitle: subtitle ? {
            segments: subtitle.segments,
            font: subtitle.font,
            color: subtitle.color,
            size: subtitle.size,
            strokeColor: subtitle.strokeColor,
            strokeWidth: subtitle.strokeWidth,
            shadowColor: subtitle.shadowColor,
            shadowBlur: subtitle.shadowBlur,
            y: subtitle.y,
            emphasisMode: subtitle.emphasisMode,
            emphasisColor: subtitle.emphasisColor,
        } : null,
        avatar: avatar ? {
            path: avatar.path,
            x: avatar.x,
            y: avatar.y,
            scale: avatar.scale,
        } : null,
        bgm: bgm ? {
            path: bgm.path,
            volume: bgm.volume,
            start: bgm.trimStart > 0 ? bgm.trimStart : null,
            timelineStart: bgm.timelineStart,
            timelineEnd: bgm.timelineEnd,
        } : null,
        seSlots: renderSpec.layers.se.length > 0
            ? renderSpec.layers.se.map((se) => ({
                path: se.path,
                volume: se.volume,
                triggerTime: se.triggerTime,
            }))
            : null,
        overlayImages: renderSpec.layers.images.length > 0
            ? renderSpec.layers.images.map((image) => ({
                path: image.path,
                x: Math.round(image.position.x * renderSpec.canvas.width),
                y: Math.round(image.position.y * renderSpec.canvas.height),
                scale: image.scale,
                startTime: image.startTime,
                endTime: image.endTime,
            }))
            : null,
        trackClips: renderSpec.layers.trackClips.length > 0 ? renderSpec.layers.trackClips : null,
        ducking: ducking.enabled ? {
            enabled: true,
            preset: ducking.preset,
            mainVoice: ducking.mainVoice,
            bgm: ducking.bgm,
            se: ducking.se,
        } : null,
    }
}

/**
 * 統一ドキュメントから直接エクスポートパラメータを構築する。
 * ExportPanel は useDocumentStore.getState() を渡すだけでよい。
 */
export function buildExportParams(
    document: VFocusDocument,
    cropData: string | null = null,
    settings: ExportSettings = DEFAULT_EXPORT_SETTINGS,
): ExportProcessParams {
    const renderSpec = buildRenderSpec(document, cropData)
    return renderSpecToProcessParams(document, renderSpec, undefined, settings)
}
