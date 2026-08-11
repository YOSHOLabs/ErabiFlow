import { useDocumentStore } from "@/stores/document"
/**
 * VideoPreview — レイヤーベースのプレビューキャンバス
 *
 * 描画ロジックはすべて RenderEngine とレイヤーに委譲。
 * このコンポーネントは DOM 管理とイベントハンドリングのみ担当。
 */

import { useEffect, useRef, useCallback, useState, useMemo } from "react"
import { useDrag, type DragRegion } from "@/hooks/useDrag"
import { useBlobUrl } from "@/hooks/useBlobUrl"
import type { PreviewState, PreviewOverlayImage } from "@/preview/types"
import { RenderEngine } from "@/preview/engine/RenderEngine"
import { VideoLayer } from "@/preview/layers/VideoLayer"
import { TrackVideoLayer } from "@/preview/layers/TrackVideoLayer"
import { TextLayer } from "@/preview/layers/TextLayer"
import { useSePlayback } from "@/hooks/useSePlayback"
import { usePreviewPlaybackClock, type PreviewMediaTimeInfo } from "@/hooks/usePreviewPlaybackClock"
import { AvatarLayer } from "@/preview/layers/AvatarLayer"
import { ImageLayer } from "@/preview/layers/ImageLayer"
import { GuideLayer } from "@/preview/layers/GuideLayer"
import {
    getSequenceDuration,
    getTimelineClipSpeed,
    getTimelineClipVolume,
    layoutTimelineClips,
    sequenceTimeToMedia,
    timelineClipLocalTimeToMedia,
} from "@/lib/timeline"
import { useEditorStore } from "@/stores/editor"
import { learnScopedSubtitleCorrection } from "@/lib/subtitleLearning"
import { getEffectiveBgmEnd } from "@/lib/bgm"
import { findActiveSubtitle } from "@/lib/subtitleTiming"
import { useResolvedFont } from "@/hooks/useResolvedFont"
import { CONSERVATIVE_UI_GUIDE } from "@/lib/verticalTrends"
import { resolveSubtitleStyle } from "@/lib/subtitleStyle"
import type { TimelineClip } from "@/lib/types"
import { evaluateClipAnimation } from "@/lib/keyframes"
import { trackClipLocalTimeToSource } from "@/lib/multiTrack"
import { buildPreviewState } from "@/preview/buildPreviewState"
import { PreviewSurface } from "@/components/preview/PreviewSurface"
import { mixPreviewVolume } from "@/lib/previewMixer"

// ============================================================
// ユーティリティ
// ============================================================

/**
 * ファイルパスを vfocus:// (Windows では http://vfocus.localhost) カスタムプロトコルのURLに変換する。
 * Range Request 対応により、2GB超の大容量動画でもストリーミング再生可能。
 */
function useMediaSrc(filePath: string): string | null {
    return useMemo(() => {
        if (!filePath || typeof window === "undefined") return null
        try {
            const isWindows = /Windows/i.test(navigator.userAgent)
            const protocol = isWindows ? "http://vfocus.localhost" : "vfocus://"
            const encoded = encodeURIComponent(filePath)
            return `${protocol}/media/${encoded}`
        } catch (e) {
            console.error("[useMediaSrc] encoding failed:", e, "path:", filePath)
            return null
        }
    }, [filePath])
}

// ============================================================
// コンポーネント
// ============================================================

export function VideoPreview() {
    const selectEditorItem = useEditorStore((state) => state.select)
    const inputPath = useDocumentStore((s) => s.inputPath)
    const mediaAssets = useDocumentStore((s) => s.mediaAssets)
    const avatarPath = useDocumentStore((s) => s.avatarPath)
    const bgmPath = useDocumentStore((s) => s.bgmPath)
    const videoInfo = useDocumentStore((s) => s.videoInfo)
    const setVideoInfo = useDocumentStore((s) => s.setVideoInfo)
    const bgmVolume = useDocumentStore((s) => s.bgmVolume)
    const bgmStart = useDocumentStore((s) => s.bgmStart ?? 0)
    const bgmEnd = useDocumentStore((s) => s.bgmEnd ?? null)
    const bgmTrimStart = useDocumentStore((s) => s.bgmTrimStart ?? 0)
    const bgmSourceDuration = useDocumentStore((s) => s.bgmSourceDuration ?? null)
    const setBgmSourceDuration = useDocumentStore((s) => s.setBgmSourceDuration)

    const text = useDocumentStore((s) => s.text)
    const subtitleStyle = useDocumentStore((s) => s.subtitleStyle)
    const subtitles = useDocumentStore((s) => s.subtitles)
    const titlePreviewFont = useResolvedFont(text.font, text.content)
    const previewText = useMemo(
        () => ({ ...text, font: titlePreviewFont.cssFamily }),
        [text, titlePreviewFont.cssFamily],
    )

    const avatar = useDocumentStore((s) => s.avatar)
    const game = useDocumentStore((s) => s.game)
    const setAvatarPosition = useDocumentStore((s) => s.setAvatarPosition)
    const setGamePositionY = useDocumentStore((s) => s.setGamePositionY)
    const setTextPosition = useDocumentStore((s) => s.setTextPosition)

    // NLE Clips
    const timelineClips = useDocumentStore((s) => s.timelineClips)
    const editorTracks = useDocumentStore((s) => s.editorTracks)
    const trackMediaClips = useDocumentStore((s) => s.trackMediaClips)
    
    // previewTime は「Sequenceの絶対時間（プレイヘッド）」として振る舞わせる
    const previewTime = useEditorStore((s) => s.previewTime)
    const sourcePreviewTime = useEditorStore((s) => s.sourcePreviewTime)
    const previewMediaTime = useMemo(
        () => sequenceTimeToMedia(timelineClips, previewTime)?.mediaTime ?? previewTime,
        [timelineClips, previewTime],
    )
    const previewSubtitle = useMemo(
        () => findActiveSubtitle(subtitles, previewMediaTime),
        [subtitles, previewMediaTime],
    )
    const subtitleGlyphSample = previewSubtitle?.text ?? subtitles.map((subtitle) => subtitle.text).join("")
    const subtitleFontReference = previewSubtitle?.styleOverride?.font ?? subtitleStyle.font
    const subtitlePreviewFont = useResolvedFont(subtitleFontReference, subtitleGlyphSample)
    const previewSubtitleStyle = useMemo(
        () => ({ ...subtitleStyle, font: subtitlePreviewFont.cssFamily }),
        [subtitleStyle, subtitlePreviewFont.cssFamily],
    )
    const previewSubtitles = useMemo(
        () => subtitles.map((subtitle) => subtitle.id === previewSubtitle?.id && subtitle.styleOverride
            ? {
                ...subtitle,
                styleOverride: { ...subtitle.styleOverride, font: subtitlePreviewFont.cssFamily },
            }
            : subtitle),
        [subtitles, previewSubtitle?.id, subtitlePreviewFont.cssFamily],
    )
    const isPlaying = useEditorStore((s) => s.isPlaying)
    const setIsPlaying = useEditorStore((s) => s.setIsPlaying)
    const volume = useEditorStore((s) => s.volume)
    const previewMainVolume = useEditorStore((s) => s.previewMainVolume)
    const previewBgmVolume = useEditorStore((s) => s.previewBgmVolume)
    const previewTrackVolume = useEditorStore((s) => s.previewTrackVolume)
    const setPreviewTime = useEditorStore((s) => s.setPreviewTime)
    
    const overlayImages = useDocumentStore((s) => s.images)
    const watermark = useDocumentStore((s) => s.watermark)
    const setImagePosition = useDocumentStore((s) => s.setImagePosition)
    const updateSubtitle = useDocumentStore((s) => s.updateSubtitle)
    const showSafeZone = useDocumentStore((s) => s.publishing.showSafeZone)
    const safeZone = useMemo(() => {
        if (!showSafeZone) return null
        return { label: "共通", ...CONSERVATIVE_UI_GUIDE }
    }, [showSafeZone])

    const [editingSubtitleId, setEditingSubtitleId] = useState<string | null>(null)
    const [editingSubtitleText, setEditingSubtitleText] = useState("")

    const videoRef = useRef<HTMLVideoElement>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const trackVideoRefs = useRef(new Map<string, HTMLVideoElement>())
    const trackAudioRefs = useRef(new Map<string, HTMLAudioElement>())

    const roughCutMode = game.layoutMode === "source"
    useSePlayback(previewTime, isPlaying, volume, !roughCutMode)

    const canvasRef = useRef<HTMLCanvasElement>(null)
    const avatarImgRef = useRef<HTMLImageElement | null>(null)
    const [videoError, setVideoError] = useState<string | null>(null)
    const [failedProxyPath, setFailedProxyPath] = useState<string | null>(null)
    const isReadyRef = useRef(false)
    const playbackSequenceTimeRef = useRef(previewTime)
    const presentedMediaTimeRef = useRef(previewTime)
    const drawFrameRef = useRef<(sequenceTime?: number, mediaTime?: number) => void>(() => {})

    // RenderEngine (初期化は1度のみ)
    const imageLayerRef = useRef<ImageLayer>(new ImageLayer())
    const engineRef = useRef<RenderEngine | null>(null)
    if (!engineRef.current) {
        const guideLayer = new GuideLayer()
        engineRef.current = new RenderEngine(
            [new VideoLayer(), new TrackVideoLayer(), new AvatarLayer(), imageLayerRef.current, new TextLayer()],
            guideLayer
        )
    }

    const activeProxyPath = useMemo(() => {
        if (!inputPath) return null
        return mediaAssets.find((asset) => asset.kind === "video" && asset.path.toLocaleLowerCase() === inputPath.toLocaleLowerCase())?.proxyPath ?? null
    }, [inputPath, mediaAssets])
    const usingProxy = Boolean(activeProxyPath && activeProxyPath !== failedProxyPath)
    const previewInputPath = usingProxy ? activeProxyPath! : inputPath
    const videoSrc = useMediaSrc(previewInputPath)
    const audioSrc = useMediaSrc(roughCutMode ? "" : bgmPath)
    const avatarBlobUrl = useBlobUrl(avatarPath, "image/png")
    const isDemoPreview = typeof window !== "undefined"
        && (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost")
        && new URLSearchParams(window.location.search).has("demo")
    const resolvedVideoSrc = isDemoPreview ? null : videoSrc
    const resolvedTrackMedia = useMemo(() => {
        if (typeof window === "undefined" || isDemoPreview) return []
        const isWindows = /Windows/i.test(navigator.userAgent)
        const protocol = isWindows ? "http://vfocus.localhost" : "vfocus://"
        return trackMediaClips.map((clip) => {
            const track = editorTracks.find((item) => item.id === clip.trackId)
            const asset = mediaAssets.find((item) => item.id === clip.assetId)
            const previewPath = clip.kind === "video" && asset?.proxyPath ? asset.proxyPath : clip.path
            return {
                clip,
                track,
                src: `${protocol}/media/${encodeURIComponent(previewPath)}`,
            }
        }).filter((item) => Boolean(item.track))
    }, [editorTracks, isDemoPreview, mediaAssets, trackMediaClips])

    useEffect(() => {
        setFailedProxyPath(null)
    }, [inputPath, activeProxyPath])

    // 画像オーバーレイの resolvedSrc を生成
    const resolvedOverlayImages: PreviewOverlayImage[] = useMemo(() => {
        if (typeof window === "undefined") return []
        const isWindows = /Windows/i.test(navigator.userAgent)
        const protocol = isWindows ? "http://vfocus.localhost" : "vfocus://"
        return overlayImages.map((img) => {
            let src = ""
            try {
                src = `${protocol}/media/${encodeURIComponent(img.path)}`
            } catch {
                src = ""
            }
            return {
                id: img.id,
                resolvedSrc: src,
                position: img.position,
                scale: img.scale,
                startTime: img.startTime,
                endTime: img.endTime,
            }
        })
    }, [overlayImages])

    // アバター画像のロード
    useEffect(() => {
        if (!avatarBlobUrl) { avatarImgRef.current = null; return }
        const img = new Image()
        img.src = avatarBlobUrl
        img.onload = () => { avatarImgRef.current = img; drawFrame() }
        img.onerror = () => { avatarImgRef.current = null }
    }, [avatarBlobUrl]) // eslint-disable-line react-hooks/exhaustive-deps

    // ImageLayer の redraw コールバック
    useEffect(() => {
        imageLayerRef.current.setRedrawCallback(() => drawFrame())
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // NLE ルーターキャッシュ
    const currentClipIdxRef = useRef<number>(0)
    const timelineLayout = useMemo(() => layoutTimelineClips(timelineClips), [timelineClips])
    const sequenceTotalDuration = useMemo(() => {
        const timelineDuration = getSequenceDuration(timelineClips)
        const trackDuration = trackMediaClips.reduce((duration, clip) => Math.max(duration, clip.timelineEnd), 0)
        return Math.max(timelineDuration > 0 ? timelineDuration : videoInfo?.duration ?? 0, trackDuration)
    }, [timelineClips, trackMediaClips, videoInfo?.duration])
    const effectiveBgmEnd = useMemo(() => getEffectiveBgmEnd({
        sequenceDuration: sequenceTotalDuration,
        start: bgmStart,
        end: bgmEnd,
        trimStart: bgmTrimStart,
        sourceDuration: bgmSourceDuration,
    }), [sequenceTotalDuration, bgmStart, bgmEnd, bgmTrimStart, bgmSourceDuration])

    const syncBgm = useCallback((sequenceTime: number, shouldPlay: boolean, tolerance = 0.05) => {
        const audio = audioRef.current
        if (roughCutMode) {
            if (audio && !audio.paused) audio.pause()
            return
        }
        if (!audio || !bgmPath) return

        const inRange = sequenceTime >= bgmStart && sequenceTime < effectiveBgmEnd
        if (!inRange) {
            if (!audio.paused) audio.pause()
            return
        }

        const sourceTime = bgmTrimStart + (sequenceTime - bgmStart)
        if (Number.isFinite(sourceTime) && Math.abs(audio.currentTime - sourceTime) > tolerance) {
            audio.currentTime = Math.max(0, sourceTime)
        }

        if (shouldPlay && audio.paused) {
            audio.play().catch((error) => console.warn("BGM playback failed:", error))
        } else if (!shouldPlay && !audio.paused) {
            audio.pause()
        }
    }, [bgmPath, bgmStart, bgmTrimStart, effectiveBgmEnd, roughCutMode])

    const syncAdditionalTracks = useCallback((sequenceTime: number, shouldPlay: boolean, tolerance = 0.08) => {
        if (roughCutMode) {
            trackVideoRefs.current.forEach((media) => { if (!media.paused) media.pause() })
            trackAudioRefs.current.forEach((media) => { if (!media.paused) media.pause() })
            return
        }
        for (const { clip, track } of resolvedTrackMedia) {
            if (!track) continue
            const media = clip.kind === "video" ? trackVideoRefs.current.get(clip.id) : trackAudioRefs.current.get(clip.id)
            if (!media) continue
            const inRange = sequenceTime >= clip.timelineStart && sequenceTime < clip.timelineEnd
            if (!inRange) {
                if (!media.paused) media.pause()
                continue
            }
            const localTime = sequenceTime - clip.timelineStart
            const sourceTime = trackClipLocalTimeToSource(clip, localTime)
            if (Number.isFinite(sourceTime) && Math.abs(media.currentTime - sourceTime) > tolerance) media.currentTime = Math.max(0, sourceTime)
            const animated = evaluateClipAnimation(clip.keyframes, clip.transform, clip.volume, sequenceTime - clip.timelineStart)
            media.volume = mixPreviewVolume(animated.volume, volume, previewTrackVolume)
            const audioEnabled = clip.hasAudio && !clip.muted && !track.muted
            const advanced = Boolean(clip.reverse || clip.freezeFrame !== undefined || clip.speedCurve?.length)
            media.muted = !audioEnabled || advanced
            media.playbackRate = advanced ? 1 : Math.max(0.25, Math.min(4, clip.speed ?? 1))
            media.preservesPitch = true
            if (advanced && !media.paused) media.pause()
            else if (shouldPlay && !advanced && media.paused) media.play().catch((error) => console.warn("追加トラックの再生に失敗しました", error))
            else if (!shouldPlay && !media.paused) media.pause()
        }
    }, [resolvedTrackMedia, volume, previewTrackVolume, roughCutMode])

    // ヘルパー: sequenceTime から mediaTime を求める
    const getMediaTimeInfo = useCallback((seqTime: number): PreviewMediaTimeInfo | null => {
        if (timelineLayout.length > 0) {
            const safeTime = Math.max(0, seqTime)
            const atIndex = (index: number) => {
                const laidOut = timelineLayout[index]
                if (!laidOut || safeTime < laidOut.sequenceStart || safeTime >= laidOut.sequenceStart + laidOut.duration) return null
                return {
                    clip: laidOut,
                    clipIdx: index,
                    clipAccTime: laidOut.sequenceStart,
                    mediaTime: laidOut.isGap
                        ? 0
                        : timelineClipLocalTimeToMedia(laidOut, safeTime - laidOut.sequenceStart),
                }
            }

            // 再生中はほぼ同じクリップか次のクリップなのでO(1)。任意シーク時だけ二分探索する。
            const cachedIndex = currentClipIdxRef.current
            const cached = atIndex(cachedIndex) ?? atIndex(cachedIndex + 1)
            if (cached) {
                currentClipIdxRef.current = cached.clipIdx
                return cached
            }

            let low = 0
            let high = timelineLayout.length - 1
            while (low <= high) {
                const middle = Math.floor((low + high) / 2)
                const clip = timelineLayout[middle]
                if (safeTime < clip.sequenceStart) high = middle - 1
                else if (safeTime >= clip.sequenceStart + clip.duration) low = middle + 1
                else {
                    currentClipIdxRef.current = middle
                    return atIndex(middle)
                }
            }
            return null
        }

        const duration = videoInfo?.duration ?? 0
        if (duration <= 0) return null

        return {
            clip: {
                id: "source-preview",
                mediaStart: 0,
                mediaEnd: duration,
                isGap: false,
                index: 0,
                sequenceStart: 0,
                duration,
                reverse: false,
                speedCurve: undefined,
                freezeFrame: undefined,
            },
            clipIdx: 0,
            clipAccTime: 0,
            mediaTime: Math.max(0, Math.min(seqTime, duration)),
        }
    }, [timelineLayout, videoInfo?.duration])

    const applyClipPlayback = useCallback((video: HTMLVideoElement, clip: TimelineClip | null, localTime = 0) => {
        const speed = clip ? getTimelineClipSpeed(clip) : 1
        const clipVolume = clip
            ? evaluateClipAnimation(clip.keyframes, clip.transform ?? {
                positionX: 0, positionY: 0, scale: 1, rotation: 0,
                flipHorizontal: false, flipVertical: false, opacity: 1,
            }, getTimelineClipVolume(clip), localTime).volume
            : 1
        if (Math.abs(video.playbackRate - speed) > 0.001) video.playbackRate = speed
        // HTMLMediaElementは1を超える増幅に対応しないため、プレビューだけ安全に上限を設ける。
        video.volume = mixPreviewVolume(volume, previewMainVolume, clipVolume)
    }, [volume, previewMainVolume])

    // previewTime 変化時 (シークバー操作等) の強制同期
    useEffect(() => {
        if (!isPlaying) playbackSequenceTimeRef.current = previewTime
        const video = videoRef.current
        if (!video || !isReadyRef.current) return
        if (isPlaying) return // 再生中は requestAnimationFrame に任せる

        if (sourcePreviewTime !== null) {
            applyClipPlayback(video, null)
            if (Math.abs(video.currentTime - sourcePreviewTime) > 0.05) {
                video.currentTime = sourcePreviewTime
            }
            drawFrameRef.current(previewTime, sourcePreviewTime)
            syncBgm(previewTime, false)
            syncAdditionalTracks(previewTime, false)
            return
        }

        const info = getMediaTimeInfo(previewTime)
        if (info && !info.clip.isGap) {
            applyClipPlayback(video, info.clip, previewTime - info.clipAccTime)
            if (Math.abs(video.currentTime - info.mediaTime) > 0.05) {
                video.currentTime = info.mediaTime
            }
            currentClipIdxRef.current = info.clipIdx
        }
        syncBgm(previewTime, false)
        syncAdditionalTracks(previewTime, false)
    }, [previewTime, sourcePreviewTime, isPlaying, getMediaTimeInfo, syncBgm, syncAdditionalTracks, applyClipPlayback])

    usePreviewPlaybackClock({
        videoRef,
        audioRef,
        isPlaying,
        sequenceDuration: sequenceTotalDuration,
        sourceFps: videoInfo?.fps ?? 30,
        playbackSequenceTimeRef,
        drawFrameRef,
        getMediaTimeInfo,
        syncBgm,
        syncAdditionalTracks,
        applyClipPlayback,
    })

    // 音量の単独反映
    useEffect(() => {
        const video = videoRef.current
        if (video) {
            const currentPreviewTime = useEditorStore.getState().previewTime
            const active = getMediaTimeInfo(currentPreviewTime)
            applyClipPlayback(video, active?.clip ?? null, active ? currentPreviewTime - active.clipAccTime : 0)
        }
    }, [volume, timelineClips, getMediaTimeInfo, applyClipPlayback])

    // BGM音量の反映
    useEffect(() => {
        const audio = audioRef.current
        if (audio) {
            audio.volume = mixPreviewVolume(bgmVolume, volume, previewBgmVolume)
        }
    }, [audioSrc, bgmVolume, volume, previewBgmVolume])

    useEffect(() => {
        const audio = audioRef.current
        if (!audio || !audioSrc) return
        const updateDuration = () => {
            const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null
            setBgmSourceDuration(duration)
        }
        audio.addEventListener("loadedmetadata", updateDuration)
        if (audio.readyState >= 1) updateDuration()
        return () => audio.removeEventListener("loadedmetadata", updateDuration)
    }, [audioSrc, setBgmSourceDuration])

    // ドラッグ用リージョン定義
    const imageRegions: DragRegion[] = overlayImages.map((img) => ({
        key: `image_${img.id}`,
        region: () => engineRef.current?.getRegion(`image_${img.id}`) ?? null,
        getPosition: () => img.position,
        onPositionChange: (pos) => setImagePosition(img.id, pos),
    }))

    const regions: DragRegion[] = [
        {
            key: "game",
            region: () => engineRef.current?.getRegion("game") ?? null,
            getPosition: () => ({ x: 0.5, y: game.positionY }),
            onPositionChange: (pos) => setGamePositionY(pos.y),
        },
        {
            key: "text",
            region: () => engineRef.current?.getRegion("text") ?? null,
            getPosition: () => text.position,
            onPositionChange: setTextPosition,
        },
        {
            key: "avatar",
            region: () => engineRef.current?.getRegion("avatar") ?? null,
            getPosition: () => avatar.position,
            onPositionChange: setAvatarPosition,
        },
        ...imageRegions,
    ]

    const { dragTarget, hoveredTarget, onMouseDown, onMouseMove, onMouseUp, onMouseLeave } =
        useDrag({ canvasRef, regions })

    // ============================================================
    // 描画
    // ============================================================
    const drawFrame = useCallback((sequenceTime = playbackSequenceTimeRef.current, presentedMediaTime?: number) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const video = videoRef.current
        const activeInfo = getMediaTimeInfo(sequenceTime)
        const mappedMediaTime = sourcePreviewTime ?? activeInfo?.mediaTime
        const mediaTime = presentedMediaTime ?? mappedMediaTime ?? video?.currentTime ?? sequenceTime
        presentedMediaTimeRef.current = mediaTime

        const state: PreviewState = buildPreviewState({
            state: {
                cw: canvas.width,
                ch: canvas.height,
                video: video ?? null,
                text: roughCutMode ? { ...previewText, content: "" } : previewText,
                watermark: roughCutMode ? { ...watermark, enabled: false } : watermark,
                subtitleStyle: previewSubtitleStyle,
                avatarImg: roughCutMode ? null : avatarImgRef.current,
                avatar,
                game,
                subtitles: roughCutMode ? [] : previewSubtitles,
                previewTime: sequenceTime,
                mediaTime,
                trimStart: timelineClips[0]?.mediaStart ?? 0,
                dragTarget,
                hoveredTarget,
                overlayImages: roughCutMode ? [] : resolvedOverlayImages,
                silenceSegments: [],
                safeZone,
            },
            activeInfo,
            trackSources: (roughCutMode ? [] : resolvedTrackMedia)
                .filter(({ clip }) => clip.kind === "video")
                .map(({ clip, track }) => ({
                    clip,
                    element: trackVideoRefs.current.get(clip.id),
                    trackOrder: editorTracks.findIndex((item) => item.id === track?.id),
                    hidden: track?.hidden ?? true,
                })),
        })

        engineRef.current?.draw(ctx, state)
    }, [previewText, previewSubtitleStyle, watermark, avatar, game, previewSubtitles, hoveredTarget, dragTarget, resolvedOverlayImages, timelineClips, getMediaTimeInfo, safeZone, resolvedTrackMedia, editorTracks, sourcePreviewTime])
    drawFrameRef.current = drawFrame

    // CanvasはReactの再描画頻度ではなく、ブラウザが実際に提示した動画フレームへ同期する。
    // 素材fpsを上限にし、字幕判定には提示フレームのmediaTimeを使う。
    useEffect(() => {
        const video = videoRef.current
        if (!video || !isPlaying || typeof video.requestVideoFrameCallback !== "function") return

        let active = true
        let callbackId = 0
        let lastDrawAt = 0
        const sourceFps = Math.max(1, Math.min(120, videoInfo?.fps ?? 30))
        const frameInterval = 1000 / sourceFps
        const onVideoFrame = (now: number, metadata: VideoFrameCallbackMetadata) => {
            if (!active) return
            if (now - lastDrawAt >= frameInterval - 0.5) {
                lastDrawAt = now
                drawFrame(playbackSequenceTimeRef.current, metadata.mediaTime)
            }
            callbackId = video.requestVideoFrameCallback(onVideoFrame)
        }

        callbackId = video.requestVideoFrameCallback(onVideoFrame)
        return () => {
            active = false
            video.cancelVideoFrameCallback(callbackId)
        }
    }, [isPlaying, drawFrame, videoInfo?.fps])

    const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (dragTarget) return

        if (hoveredTarget) {
            if (hoveredTarget === "text") selectEditorItem({ type: "text" })
            else if (hoveredTarget === "avatar") selectEditorItem({ type: "avatar" })
            else if (hoveredTarget === "game") selectEditorItem({ type: "game" })
            else if (hoveredTarget.startsWith("image_")) {
                selectEditorItem({ type: "image", id: hoveredTarget.replace("image_", "") })
            }
            else if (hoveredTarget.startsWith("trackClip_")) {
                selectEditorItem({ type: "trackClip", id: hoveredTarget.replace("trackClip_", "") })
            }
            return
        }
        
        const canvas = canvasRef.current
        const engine = engineRef.current
        if (canvas && engine) {
            const rect = canvas.getBoundingClientRect()
            const scaleX = canvas.width / rect.width
            const scaleY = canvas.height / rect.height
            const x = (e.clientX - rect.left) * scaleX
            const y = (e.clientY - rect.top) * scaleY
            
            const subtitleRegion = engine.getRegion("subtitle")
            if (subtitleRegion && x >= subtitleRegion.x && x <= subtitleRegion.x + subtitleRegion.w && y >= subtitleRegion.y && y <= subtitleRegion.y + subtitleRegion.h) {
                const mediaTime = presentedMediaTimeRef.current
                const currentSub = findActiveSubtitle(useDocumentStore.getState().subtitles, mediaTime)
                if (currentSub) {
                    setIsPlaying(false)
                    setEditingSubtitleId(currentSub.id)
                    setEditingSubtitleText(currentSub.text)
                    return
                }
            }
        }
        
        if (videoInfo && !editingSubtitleId) {
            setIsPlaying(!isPlaying)
        }
    }, [hoveredTarget, dragTarget, videoInfo, isPlaying, setIsPlaying, editingSubtitleId, selectEditorItem])

    // 描画パラメータ変化で再描画
    useEffect(() => {
        if (!isPlaying) drawFrame(previewTime)
    }, [drawFrame, isPlaying, previewTime])

    // 動画イベント
    useEffect(() => {
        const video = videoRef.current
        if (!video) return

        const onReady = () => {
            isReadyRef.current = true
            setVideoError(null)
            if (video.duration && isFinite(video.duration) && !videoInfo) {
                setVideoInfo({ duration: video.duration, width: video.videoWidth, height: video.videoHeight })
            }
            drawFrame(playbackSequenceTimeRef.current)
        }
        const onSeeked = () => drawFrame(playbackSequenceTimeRef.current)
        const onError = () => {
            const err = video.error
            const codeMap: Record<number, string> = {
                1: "MEDIA_ERR_ABORTED (読み込み中止)",
                2: "MEDIA_ERR_NETWORK (ネットワークエラー)",
                3: "MEDIA_ERR_DECODE (デコードエラー — コーデック非対応の可能性)",
                4: "MEDIA_ERR_SRC_NOT_SUPPORTED (ソース非対応 — パスまたはフォーマットの問題)",
            }
            const code = err?.code ?? 0
            const detail = codeMap[code] || `不明なエラー (code=${code})`
            console.error("Video load error:", detail, "message:", err?.message, "src:", resolvedVideoSrc)
            if (usingProxy && activeProxyPath) {
                console.warn("Proxy preview failed; falling back to the original media")
                setFailedProxyPath(activeProxyPath)
                setVideoError(null)
                return
            }
            setVideoError(`動画の読み込みに失敗しました。${detail}`)
        }

        video.addEventListener("loadeddata", onReady)
        video.addEventListener("seeked", onSeeked)
        video.addEventListener("error", onError)
        if (video.readyState >= 2) onReady()

        return () => {
            video.removeEventListener("loadeddata", onReady)
            video.removeEventListener("seeked", onSeeked)
            video.removeEventListener("error", onError)
        }
    }, [activeProxyPath, drawFrame, resolvedVideoSrc, setVideoInfo, usingProxy])

    if (!inputPath && !avatarPath) return null

    const isVideoLoading = !!inputPath && !videoInfo
    const showLoadingOverlay = isVideoLoading || !!videoError
    const editingSubtitleStyle = resolveSubtitleStyle(
        subtitleStyle,
        subtitles.find((subtitle) => subtitle.id === editingSubtitleId),
    )

    const commitSubtitleEdit = () => {
        const subtitle = subtitles.find((item) => item.id === editingSubtitleId)
        if (subtitle && subtitle.text !== editingSubtitleText) {
            updateSubtitle(subtitle.id, { text: editingSubtitleText })
            learnScopedSubtitleCorrection(subtitle.text, editingSubtitleText).catch(console.error)
        }
        setEditingSubtitleId(null)
    }

    return (
        <PreviewSurface
            inputPath={inputPath}
            resolvedVideoSrc={resolvedVideoSrc}
            audioSrc={audioSrc}
            trackMedia={roughCutMode ? [] : resolvedTrackMedia}
            videoRef={videoRef}
            audioRef={audioRef}
            trackVideoRefs={trackVideoRefs}
            trackAudioRefs={trackAudioRefs}
            canvasRef={canvasRef}
            canvasWidth={game.layoutMode === "source" && videoInfo ? (videoInfo.width >= videoInfo.height ? 960 : 540) : 540}
            canvasHeight={game.layoutMode === "source" && videoInfo ? (videoInfo.width >= videoInfo.height ? Math.max(2, Math.round(960 * videoInfo.height / videoInfo.width)) : Math.max(2, Math.round(540 * videoInfo.height / videoInfo.width))) : 960}
            onTrackFrame={() => drawFrameRef.current(useEditorStore.getState().previewTime)}
            onCanvasMouseDown={onMouseDown}
            onCanvasMouseMove={onMouseMove}
            onCanvasMouseUp={onMouseUp}
            onCanvasMouseLeave={onMouseLeave}
            onCanvasClick={handleCanvasClick}
            dragTarget={dragTarget}
            hoveredTarget={hoveredTarget}
            usingProxy={usingProxy}
            isPlaying={isPlaying}
            showLoadingOverlay={showLoadingOverlay}
            videoError={videoError}
            editingSubtitleId={editingSubtitleId}
            editingSubtitleText={editingSubtitleText}
            setEditingSubtitleText={setEditingSubtitleText}
            editingSubtitleStyle={editingSubtitleStyle}
            subtitleFontFamily={subtitlePreviewFont.cssFamily}
            commitSubtitleEdit={commitSubtitleEdit}
        />
    )
}
