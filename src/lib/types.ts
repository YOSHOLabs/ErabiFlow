/**
 * types.ts
 *
 * アプリ全体で共有される型定義。
 * 各ストアやコンポーネントからインポートされる。
 */

// ============================================================
// 基本型
// ============================================================

export interface Position {
    x: number // 0–1 の正規化座標
    y: number
}

export interface VideoInfo {
    duration: number
    width: number
    height: number
    /** 素材の平均フレームレート。旧プロジェクトでは未保存の場合がある */
    fps?: number
    /** 音声ストリームを含むか。旧プロジェクトでは未保存の場合がある。 */
    hasAudio?: boolean
}

export type MediaAssetKind = "video" | "image" | "audio"

/** プロジェクト内で再利用できる素材。実ファイルは移動・複製しない。 */
export interface MediaAsset {
    id: string
    kind: MediaAssetKind
    path: string
    name: string
    folderId: string | null
    favorite: boolean
    addedAt: string
    duration?: number
    width?: number
    height?: number
    fps?: number
    hasAudio?: boolean
    /** プレビュー専用。解析と最終書き出しには必ず元ファイルを使う。 */
    proxyPath?: string
    proxyBytes?: number
    proxyCreatedAt?: string
}

export interface MediaFolder {
    id: string
    name: string
    createdAt: string
}

export type EditorTrackKind = "video" | "audio"
export type ClipKeyframeProperty = "positionX" | "positionY" | "scale" | "rotation" | "opacity" | "volume"
export interface SpeedCurvePoint {
    /** 素材範囲内の0..1位置。 */
    position: number
    /** 0.25..4 */
    speed: number
}
export interface ClipKeyframe {
    id: string
    /** クリップ先頭からの秒数。 */
    time: number
    property: ClipKeyframeProperty
    value: number
    interpolation: "linear" | "hold"
}
export type ClipTransitionType = "none" | "fade" | "dissolve" | "slide" | "zoom" | "rotate"
export type ClipMotionPreset = "none" | "swing" | "bounce" | "pop"
export interface ClipTransition {
    type: ClipTransitionType
    duration: number
}

/** クリップ単位のカラー補正。数値は編集UIで扱う正規化値。 */
export interface ClipColorAdjustments {
    /** -100..100 */
    brightness: number
    /** 0..200（100が無補正） */
    contrast: number
    /** 0..200（100が無補正） */
    saturation: number
    /** -100..100（負=寒色、正=暖色） */
    temperature: number
    /** -100..100（負=緑、正=マゼンタ） */
    tint: number
    /** 各階調 -100..100 */
    highlights: number
    shadows: number
    blacks: number
    whites: number
    /** HSL全体調整 */
    hue: number
    hslSaturation: number
    lightness: number
    /** 3点トーンカーブ -100..100 */
    curveShadows: number
    curveMidtones: number
    curveHighlights: number
    /** .cube / .3dl の絶対パス。 */
    lutPath?: string
}

export const DEFAULT_CLIP_COLOR: ClipColorAdjustments = {
    brightness: 0,
    contrast: 100,
    saturation: 100,
    temperature: 0,
    tint: 0,
    highlights: 0,
    shadows: 0,
    blacks: 0,
    whites: 0,
    hue: 0,
    hslSaturation: 0,
    lightness: 0,
    curveShadows: 0,
    curveMidtones: 0,
    curveHighlights: 0,
}

export interface ClipMask {
    shape: "none" | "ellipse" | "rectangle"
    /** 中心・大きさはクリップ矩形内の0..1。 */
    x: number
    y: number
    width: number
    height: number
    /** 0..100 */
    feather: number
}

export interface ClipChromaKey {
    enabled: boolean
    color: string
    /** 0..100 */
    similarity: number
    /** 0..100 */
    blend: number
}

export interface ClipVisualEffects {
    /** 0..50 */
    blur: number
    /** 0..50。0は無効。 */
    mosaic: number
    /** 以下はすべて0..100。0は無効。 */
    motionBlur: number
    sharpen: number
    noise: number
    vhs: number
    film: number
    glitch: number
    rgbShift: number
    glow: number
    lightLeak: number
    lensFlare: number
    rain: number
    snow: number
    fire: number
    particles: number
    shake: number
    warp: number
    chromaticAberration: number
    chroma: ClipChromaKey
    mask: ClipMask
}

export const DEFAULT_CLIP_EFFECTS: ClipVisualEffects = {
    blur: 0,
    mosaic: 0,
    motionBlur: 0,
    sharpen: 0,
    noise: 0,
    vhs: 0,
    film: 0,
    glitch: 0,
    rgbShift: 0,
    glow: 0,
    lightLeak: 0,
    lensFlare: 0,
    rain: 0,
    snow: 0,
    fire: 0,
    particles: 0,
    shake: 0,
    warp: 0,
    chromaticAberration: 0,
    chroma: { enabled: false, color: "#00ff00", similarity: 18, blend: 2 },
    mask: { shape: "none", x: 0.5, y: 0.5, width: 1, height: 1, feather: 0 },
}

export interface ClipAudioEffects {
    /** 各帯域のゲイン -20..20dB */
    eqLow: number
    eqMid: number
    eqHigh: number
    normalize: boolean
    /** 0..100 */
    noiseReduction: number
    fadeIn: number
    fadeOut: number
}

export const DEFAULT_CLIP_AUDIO_EFFECTS: ClipAudioEffects = {
    eqLow: 0, eqMid: 0, eqHigh: 0,
    normalize: false,
    noiseReduction: 0,
    fadeIn: 0,
    fadeOut: 0,
}

/** V1/A1の本編トラックへ追加して使う、任意追加トラック。 */
export interface EditorTrack {
    id: string
    kind: EditorTrackKind
    name: string
    locked: boolean
    /** videoでは映像非表示、audioでは未使用。 */
    hidden: boolean
    /** audioトラック、およびvideo素材に含まれる音声を消音する。 */
    muted: boolean
}

/** 素材ライブラリから任意トラックへ配置したクリップ。 */
export interface TrackMediaClip {
    id: string
    trackId: string
    assetId: string
    path: string
    kind: EditorTrackKind
    label: string
    timelineStart: number
    timelineEnd: number
    sourceStart: number
    sourceEnd: number
    volume: number
    muted: boolean
    hasAudio: boolean
    transform: TimelineClipTransform
    keyframes?: ClipKeyframe[]
    transitionIn?: ClipTransition
    transitionOut?: ClipTransition
    motionPreset?: ClipMotionPreset
    color?: ClipColorAdjustments
    effects?: ClipVisualEffects
    speed?: number
    speedCurve?: SpeedCurvePoint[]
    reverse?: boolean
    freezeFrame?: number
    audioEffects?: ClipAudioEffects
    groupId?: string
}

// ============================================================
// ドメイン型
// ============================================================

export interface TrimState {
    start: number // 旧トリム。使わなくなる可能性があるが互換性維持
    end: number
}

export interface TextState {
    content: string
    font: string
    color: string
    size: number
    strokeColor: string
    strokeWidth: number
    shadowColor: string
    shadowBlur: number
    lineHeight: number
    letterSpacing: number
    position: Position
    /** 画面テキストを表示するシーケンス時間。0始まり。 */
    startTime: number
    /** nullなら動画終端まで表示。冒頭フックでは2〜4秒を推奨。 */
    endTime: number | null
}

export type SubtitleEmphasisMode = "none" | "karaoke"

export interface SubtitleStyle {
    font: string
    color: string
    size: number
    strokeColor: string
    strokeWidth: number
    shadowColor: string
    shadowBlur: number
    lineHeight: number
    letterSpacing: number
    positionY: number
    /** 短尺向けの単語追従ハイライト。 */
    emphasisMode: SubtitleEmphasisMode
    emphasisColor: string
}

/** 1つの字幕だけに上書きできる外観。フォントは字幕全体で統一する。 */
export type SubtitleStyleOverride = Partial<Pick<
    SubtitleStyle,
    | "font"
    | "color"
    | "size"
    | "strokeColor"
    | "strokeWidth"
    | "shadowColor"
    | "shadowBlur"
    | "positionY"
    | "emphasisMode"
    | "emphasisColor"
>>

export type PublishPlatform = "tiktok" | "instagram" | "youtube"
export type TrendTemplateId = "payoff-first" | "raw-reaction" | "search-answer" | "series-progress" | "comment-reply"

/** 書き出し時の任意の投稿メモ。旧.vfocusとの互換性を保って保存する。 */
export interface PublishingState {
    platform: PublishPlatform
    template: TrendTemplateId
    caption: string
    hashtags: string
    cta: string
    hookDuration: number
    coverTime: number
    showSafeZone: boolean
    rightsChecked: boolean
}

export type WatermarkPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right"

/** 常時表示する任意のテキスト透かし。無効時は書き出しへ一切追加しない。 */
export interface WatermarkState {
    enabled: boolean
    text: string
    font: string
    color: string
    size: number
    opacity: number
    position: WatermarkPosition
}

/** プロジェクトへ追加したユーザー所有フォント。実体はアプリ管理領域へコピーされる。 */
export interface CustomFontEntry {
    id: string
    reference: string
    path: string
    label: string
    family: string
    supportsJapanese: boolean
}

export interface AvatarState {
    position: Position
    scale: number // 0.2–2.0
}

export interface GameState {
    /** source=元動画の向きを維持。その他は旧縦型プロジェクトとの互換用。 */
    layoutMode: "source" | "commentary" | "portrait" | "stage"
    /** ゲーム映像エリア中心のY座標 (0–1 正規化) */
    positionY: number
    /** ゲーム映像の拡大率。1 = 全体表示、2 = 中央を2倍に拡大 */
    scale: number
}

export interface JumpCutConfig {
    thresholdDb: number
    minDuration: number
    padding: number
}

export interface ProcessingState {
    gpuType: string
    /** 字幕用語集: auto=ファイル名で明示判定、none=無効、その他=ゲームID */
    analysisGameId: string
    enableAutoReframe: boolean
    enableJumpCut: boolean
    jumpCutConfig: JumpCutConfig
    isProcessing: boolean
    phase: string
    progress: number
    status: string
    phaseMessage: string
    lastError: string | null
    lastOutputPath: string | null
    lastStartedAt: string | null
    lastFinishedAt: string | null
}

export interface TextSegment {
    id: string
    text: string
    start: number
    end: number
    styleId?: string
    /** 設定されている項目だけ字幕全体のスタイルを上書きする。 */
    styleOverride?: SubtitleStyleOverride
    /** 紐づく親クリップのID (リンク機能用) */
    linkedClipId?: string
    /** 文字起こし側の信頼度。0–1、未取得なら undefined */
    confidence?: number
    /** 字幕の元になった音声トラック番号 */
    sourceTrack?: number
    /** 低信頼・幻覚疑いなど、UIで確認を促すためのフラグ */
    flags?: SubtitleFlag[]
    /** ゲーム用語を使った限定再判定で本文が更新された */
    refinedByGlossary?: boolean
    originalText?: string
    recognitionModel?: string
    /** 話者分離で割り当てた表示名。 */
    speaker?: string
    /** 翻訳字幕の場合の元言語。 */
    translatedFrom?: string
}

export type SubtitleFlag =
  | "low_confidence"
  | "possible_hallucination"
  | "needs_review"

/** エージェント推奨カット */
export interface HighlightScoreDetails {
    event: number
    reaction: number
    clipability: number
    /** 0〜1。利用できた独立信号の量を示す。 */
    confidence: number
}

export interface AgentHighlight {
    start: number
    end: number
    label: string
    reason: string
    excitement: number
    isProRequired?: boolean
    scoreDetails?: HighlightScoreDetails
    evidence?: string[]
    category?: string
    /** 0〜1。単一信号や低信頼による誤検出の可能性。 */
    falsePositiveRisk?: number
    durationVariants?: Partial<Record<"15" | "30" | "60", { start: number; end: number }>>
}

/** SEタグ（ハイライトのカテゴリに対応） */
export type SeTag = 
  | "explosion"   // 爆発・衝撃
  | "victory"     // 勝利・クリア
  | "warning"     // 警告・危険
  | "surprise"    // 驚き・発見
  | "tension"     // 緊張・ピンチ
  | "comedy"      // 笑い・コメディ
  | "transition"  // 場面転換
  | "emphasis"    // 強調・注目

export const SE_TAG_META: Record<SeTag, { label: string; iconPath: string; color: string }> = {
  explosion:  { label: "爆発・衝撃",   iconPath: "/se-icons/explosion.png", color: "red" },
  victory:    { label: "勝利・クリア", iconPath: "/se-icons/victory.png", color: "yellow" },
  warning:    { label: "警告・危険",   iconPath: "/se-icons/warning.png", color: "orange" },
  surprise:   { label: "驚き・発見",   iconPath: "/se-icons/surprise.png", color: "cyan" },
  tension:    { label: "緊張・ピンチ", iconPath: "/se-icons/tension.png", color: "purple" },
  comedy:     { label: "笑い・コメディ", iconPath: "/se-icons/comedy.png", color: "green" },
  transition: { label: "場面転換",     iconPath: "/se-icons/transition.png", color: "blue" },
  emphasis:   { label: "強調・注目",   iconPath: "/se-icons/emphasis.png", color: "amber" },
}

/** ユーザーが登録したSEファイル */
export interface SeFileEntry {
  id: string
  /** ファイルの絶対パス */
  path: string
  /** ファイル名 */
  fileName: string
  /** タグ（複数可） */
  tags: SeTag[]
}

/** SEスロット */
export interface SeSlot {
    id: string
    /** SE ファイルパス */
    path: string
    /** SE音量 (0–1) */
    volume: number
    /** 発火時間 (秒) */
    triggerTime: number
    /** 表示用ラベル */
    label: string
    /** 紐づく親クリップのID (リンク機能用) */
    linkedClipId?: string
}

/** 画像オーバーレイ */
export interface OverlayImage {
    id: string
    /** 画像ファイルパス */
    path: string
    /** 位置 (0–1 正規化) */
    position: Position
    /** スケール */
    scale: number
    /** 表示開始時間 (秒) */
    startTime: number
    /** 表示終了時間 (秒) */
    endTime: number
    /** 表示用ラベル */
    label: string
    /** 紐づく親クリップのID (リンク機能用) */
    linkedClipId?: string
}

/** 無音区間 */
export interface SilenceSegment {
    start: number
    end: number
}

/** トラック上のクリップ (NLE用) */
export interface TimelineClipTransform {
    /** クロップ範囲の横方向。-1=左端、0=中央、1=右端 */
    positionX: number
    /** クロップ範囲の縦方向。-1=上端、0=中央、1=下端 */
    positionY: number
    /** クリップ固有の拡大率。ゲーム映像全体の拡大率と乗算される。 */
    scale: number
    /** 時計回りの回転角度。 */
    rotation: number
    flipHorizontal: boolean
    flipVertical: boolean
    opacity: number
}

export const DEFAULT_TIMELINE_CLIP_TRANSFORM: TimelineClipTransform = {
    positionX: 0,
    positionY: 0,
    scale: 1,
    rotation: 0,
    flipHorizontal: false,
    flipVertical: false,
    opacity: 1,
}

export interface TimelineClip {
    id: string
    /** Gap（隙間）として扱うかどうか */
    isGap?: boolean
    /** 元動画の開始時間 (イン点) または Gapの長さ */
    mediaStart: number
    /** 元動画の終了時間 (アウト点) */
    mediaEnd: number
    /** (オプショナル) UI表示用ラベル */
    label?: string
    /** 素材の再生速度。旧プロジェクトでは未保存のため既定値は1。 */
    speed?: number
    /** 素材区間を分割して適用する可変速カーブ。 */
    speedCurve?: SpeedCurvePoint[]
    reverse?: boolean
    /** 元素材上の静止させるフレーム時刻。 */
    freezeFrame?: number
    freezeDuration?: number
    audioEffects?: ClipAudioEffects
    /** クリップ固有の音量。メイン音量と乗算される。 */
    volume?: number
    muted?: boolean
    /** クリップ固有の映像変形。未保存項目は既定値で補完する。 */
    transform?: TimelineClipTransform
    keyframes?: ClipKeyframe[]
    transitionIn?: ClipTransition
    transitionOut?: ClipTransition
    motionPreset?: ClipMotionPreset
    color?: ClipColorAdjustments
    effects?: ClipVisualEffects
}

/** Creator版で個別動画として書き出す投稿クリップ。 */
export interface CreatorBatchClip {
    id: string
    /** 候補の表示名。ファイル名にも安全な形へ変換して利用する。 */
    label: string
    /** このクリップだけに適用するタイトル。空ならタイトルを表示しない。 */
    title: string
    /** 元素材上の開始・終了時間。 */
    mediaStart: number
    mediaEnd: number
    excitement: number
}

/** ダッキングプリセット */
export type DuckingPreset = "standard" | "variety"

/** ダッキング設定 */
export interface DuckingConfig {
    /** ダッキング有効 */
    enabled: boolean
    /** プリセット選択 */
    preset: DuckingPreset
}

/** プリセット定義 (音量倍率) */
export const DUCKING_PRESETS: Record<DuckingPreset, {
    label: string
    description: string
    mainVoice: number
    bgm: number
    se: number
}> = {
    standard: {
        label: "王道モード",
        description: "メイン音声100% / BGM→15% / SE→100%",
        mainVoice: 1.0,
        bgm: 0.15,
        se: 1.0,
    },
    variety: {
        label: "バラエティモード",
        description: "メイン音声→50% / BGM→5% / SE→120%",
        mainVoice: 0.5,
        bgm: 0.05,
        se: 1.2,
    },
}

// ============================================================
// デフォルト値
// ============================================================

export const DEFAULT_TEXT: TextState = {
    content: "",
    font: "system:meiryo-bold",
    color: "#FFFFFF",
    size: 44,
    strokeColor: "#000000",
    strokeWidth: 3,
    shadowColor: "rgba(0,0,0,0.5)",
    shadowBlur: 0,
    lineHeight: 1.2,
    letterSpacing: 0,
    position: { x: 0.5, y: 0.15 },
    startTime: 0,
    endTime: null,
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
    font: "system:meiryo-bold",
    color: "#FFFFFF",
    size: 40,
    strokeColor: "#000000",
    strokeWidth: 4,
    shadowColor: "rgba(0,0,0,0.5)",
    shadowBlur: 2,
    lineHeight: 1.2,
    letterSpacing: 0,
    positionY: 0.9,
    emphasisMode: "none",
    emphasisColor: "#FDE047",
}

export const DEFAULT_PUBLISHING: PublishingState = {
    platform: "tiktok",
    template: "payoff-first",
    caption: "",
    hashtags: "",
    cta: "続きが見たい人はコメントで教えてください",
    hookDuration: 3,
    coverTime: 0,
    showSafeZone: true,
    rightsChecked: false,
}

export const DEFAULT_WATERMARK: WatermarkState = {
    enabled: false,
    text: "TateClip",
    font: "system:meiryo-bold",
    color: "#FFFFFF",
    size: 28,
    opacity: 0.55,
    position: "bottom-right",
}

export const DEFAULT_AVATAR: AvatarState = {
    position: { x: 0.5, y: 0.78 },
    scale: 1.0,
}

export const DEFAULT_GAME: GameState = {
    layoutMode: "source",
    positionY: 0.5,
    scale: 1.0,
}

export const DEFAULT_PROCESSING: ProcessingState = {
    gpuType: "CPU",
    analysisGameId: "auto",
    // ゲーム映像では顔誤検出と書き出し待ち時間が増えるため、必要時だけ有効化する。
    enableAutoReframe: false,
    enableJumpCut: false,
    jumpCutConfig: {
        thresholdDb: -35,
        minDuration: 0.3,
        padding: 0.05,
    },
    isProcessing: false,
    phase: "",
    progress: 0,
    status: "待機中",
    phaseMessage: "",
    lastError: null,
    lastOutputPath: null,
    lastStartedAt: null,
    lastFinishedAt: null,
}

export const DEFAULT_DUCKING: DuckingConfig = {
    enabled: false,
    preset: "standard",
}
