/**
 * preview/types.ts — プレビュー描画レイヤーの型定義
 */

import type { TextState, AvatarState, GameState, TextSegment, SubtitleStyle, SilenceSegment, TimelineClip, TrackMediaClip, WatermarkState } from "@/lib/types"

/** プレビューで使う画像オーバーレイ情報（resolvedSrc = Tauri変換済みURL） */
export interface PreviewOverlayImage {
    id: string
    resolvedSrc: string
    position: { x: number; y: number }
    scale: number
    startTime: number
    endTime: number
}

export interface PreviewTrackVideo {
    clip: TrackMediaClip
    element: HTMLVideoElement
    trackOrder: number
}

/** レイヤーが描画時に受け取る状態 */
export interface PreviewState {
    /** Canvas 幅 (px) */
    cw: number
    /** Canvas 高さ (px) */
    ch: number
    /** 動画要素 (null なら動画なし) */
    video: HTMLVideoElement | null
    /** 動画が描画可能か */
    hasVideo: boolean
    /** テキスト設定 */
    text: TextState
    watermark: WatermarkState
    /** 字幕スタイル設定 */
    subtitleStyle: SubtitleStyle
    /** アバター画像 (ロード済み) */
    avatarImg: HTMLImageElement | null
    /** アバター設定 */
    avatar: AvatarState
    /** ゲーム映像位置 */
    game: GameState
    /** 字幕セグメント */
    subtitles: TextSegment[]
    /** 現在のプレビュー時間 (Sequence Time) */
    previewTime: number
    /** 現在のメディア時間 (元の動画の絶対時間) */
    mediaTime: number
    /** 現在のシーケンス位置にある映像クリップ。 */
    activeClip: TimelineClip | null
    activeClipLocalTime: number
    /** 現在時刻に表示する任意V2+トラック映像。 */
    trackVideos: PreviewTrackVideo[]
    /** トリム開始時間 (字幕の相対時間計算用) */
    trimStart: number
    /** ドラッグ中のターゲット */
    dragTarget: string | null
    /** ホバー中のターゲット */
    hoveredTarget: string | null
    /** 画像オーバーレイ */
    overlayImages: PreviewOverlayImage[]
    /** 無音区間 */
    silenceSegments: SilenceSegment[]
    /** 投稿先UIとの重なりを減らす共通の保守ガイド。公式固定値ではない。nullなら非表示。 */
    safeZone: {
        label: string
        top: number
        right: number
        bottom: number
        left: number
    } | null
}

/** 各レイヤーの描画結果として返すヒットリージョン */
export interface HitRegion {
    key: string
    x: number
    y: number
    w: number
    h: number
}

/** レイヤーインターフェース */
export interface Layer {
    /** レイヤー名 (デバッグ用) */
    name: string
    /** 描画。ヒットリージョンを返す */
    draw(ctx: CanvasRenderingContext2D, state: PreviewState): HitRegion | HitRegion[] | null
}
