import type {
    Dispatch,
    MouseEventHandler,
    MutableRefObject,
    RefObject,
    SetStateAction,
} from "react"
import type { SubtitleStyle, TrackMediaClip } from "../../lib/types.ts"

interface PreviewSurfaceTrack {
    clip: TrackMediaClip
    src: string
}

interface PreviewSurfaceProps {
    inputPath: string
    resolvedVideoSrc: string | null
    audioSrc: string | null
    trackMedia: readonly PreviewSurfaceTrack[]
    videoRef: RefObject<HTMLVideoElement | null>
    audioRef: RefObject<HTMLAudioElement | null>
    trackVideoRefs: MutableRefObject<Map<string, HTMLVideoElement>>
    trackAudioRefs: MutableRefObject<Map<string, HTMLAudioElement>>
    canvasRef: RefObject<HTMLCanvasElement | null>
    canvasWidth: number
    canvasHeight: number
    onTrackFrame: () => void
    onCanvasMouseDown: MouseEventHandler<HTMLCanvasElement>
    onCanvasMouseMove: MouseEventHandler<HTMLCanvasElement>
    onCanvasMouseUp: MouseEventHandler<HTMLCanvasElement>
    onCanvasMouseLeave: MouseEventHandler<HTMLCanvasElement>
    onCanvasClick: MouseEventHandler<HTMLCanvasElement>
    dragTarget: string | null
    hoveredTarget: string | null
    usingProxy: boolean
    isPlaying: boolean
    showLoadingOverlay: boolean
    videoError: string | null
    editingSubtitleId: string | null
    editingSubtitleText: string
    setEditingSubtitleText: Dispatch<SetStateAction<string>>
    editingSubtitleStyle: SubtitleStyle
    subtitleFontFamily: string
    commitSubtitleEdit: () => void
}

export function PreviewSurface({
    inputPath,
    resolvedVideoSrc,
    audioSrc,
    trackMedia,
    videoRef,
    audioRef,
    trackVideoRefs,
    trackAudioRefs,
    canvasRef,
    canvasWidth,
    canvasHeight,
    onTrackFrame,
    onCanvasMouseDown,
    onCanvasMouseMove,
    onCanvasMouseUp,
    onCanvasMouseLeave,
    onCanvasClick,
    dragTarget,
    hoveredTarget,
    usingProxy,
    isPlaying,
    showLoadingOverlay,
    videoError,
    editingSubtitleId,
    editingSubtitleText,
    setEditingSubtitleText,
    editingSubtitleStyle,
    subtitleFontFamily,
    commitSubtitleEdit,
}: PreviewSurfaceProps) {
    return (
        <div className="flex h-full w-full flex-col items-center justify-center p-4">
            {resolvedVideoSrc && <video ref={videoRef} src={resolvedVideoSrc} crossOrigin="anonymous" preload="auto" className="hidden" />}
            {audioSrc && <audio ref={audioRef} src={audioSrc} crossOrigin="anonymous" preload="auto" className="hidden" />}
            {trackMedia.map(({ clip, src }) => clip.kind === "video" ? (
                <video
                    key={clip.id}
                    ref={(element) => { if (element) trackVideoRefs.current.set(clip.id, element); else trackVideoRefs.current.delete(clip.id) }}
                    src={src}
                    crossOrigin="anonymous"
                    preload="auto"
                    className="hidden"
                    onLoadedData={onTrackFrame}
                    onSeeked={onTrackFrame}
                />
            ) : (
                <audio
                    key={clip.id}
                    ref={(element) => { if (element) trackAudioRefs.current.set(clip.id, element); else trackAudioRefs.current.delete(clip.id) }}
                    src={src}
                    crossOrigin="anonymous"
                    preload="auto"
                    className="hidden"
                />
            ))}

            <div className="relative min-h-0 max-w-full border border-zinc-800/80 bg-black shadow-lg" style={{ height: "100%", maxHeight: "100%", aspectRatio: `${canvasWidth}/${canvasHeight}` }}>
                <canvas
                    ref={canvasRef}
                    width={canvasWidth}
                    height={canvasHeight}
                    className="h-full w-full bg-zinc-900"
                    style={{ cursor: dragTarget ? "grabbing" : hoveredTarget ? "grab" : "default" }}
                    onMouseDown={onCanvasMouseDown}
                    onMouseMove={onCanvasMouseMove}
                    onMouseUp={onCanvasMouseUp}
                    onMouseLeave={onCanvasMouseLeave}
                    onClick={onCanvasClick}
                    aria-label="動画プレビュー。画面上の要素は右側のインスペクターからも調整できます"
                />

                {usingProxy && (
                    <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-cyan-200/20 bg-black/65 px-1.5 py-0.5 text-[8px] font-bold tracking-[0.12em] text-cyan-200">PROXY</div>
                )}

                {editingSubtitleId && (
                    <textarea
                        autoFocus
                        value={editingSubtitleText}
                        onChange={(event) => setEditingSubtitleText(event.target.value)}
                        onBlur={commitSubtitleEdit}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault()
                                event.currentTarget.blur()
                            }
                        }}
                        className="absolute z-50 resize-none overflow-hidden rounded border border-blue-500/50 bg-black/60 p-2 text-center text-white outline-none"
                        style={{
                            left: "50%",
                            transform: "translate(-50%, -50%)",
                            top: `${editingSubtitleStyle.positionY * 100}%`,
                            width: "86%",
                            maxWidth: "86%",
                            minHeight: "60px",
                            maxHeight: "34%",
                            overflowY: "auto",
                            overflowWrap: "anywhere",
                            fontSize: `${editingSubtitleStyle.size / 1080 * 100}vh`,
                            fontFamily: subtitleFontFamily,
                            color: editingSubtitleStyle.color,
                        }}
                    />
                )}

                {showLoadingOverlay && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900/95">
                        {videoError ? (
                            <>
                                <svg className="h-8 w-8 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                                    <line x1="12" y1="9" x2="12" y2="13" />
                                    <line x1="12" y1="17" x2="12.01" y2="17" />
                                </svg>
                                <span className="px-4 text-center text-xs text-red-400">{videoError}</span>
                            </>
                        ) : (
                            <>
                                <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600/30 border-t-zinc-400" />
                                <div className="space-y-1 text-center">
                                    <p className="text-xs font-medium text-zinc-300">{!resolvedVideoSrc ? "プレビューを準備中..." : "動画を読み込み中..."}</p>
                                    <p className="max-w-full truncate px-4 text-[10px] text-zinc-600">{inputPath.split(/[\\/]/).pop()}</p>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
