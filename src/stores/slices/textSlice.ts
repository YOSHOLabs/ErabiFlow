/**
 * textSlice — テキスト・字幕の状態とアクション
 */
import type { TextState, SubtitleStyle, TextSegment, Position } from "../../lib/types.ts"
import { DEFAULT_TEXT, DEFAULT_SUBTITLE_STYLE } from "../../lib/types.ts"

export const createTextSlice = (set: any) => ({
    // --- 初期値 ---
    text: DEFAULT_TEXT,
    subtitleStyle: DEFAULT_SUBTITLE_STYLE,
    subtitles: [] as TextSegment[],

    // --- アクション ---
    setText: (partial: Partial<TextState>) =>
        set((s: any) => {
            Object.assign(s.text, partial)
        }),
    setTextPosition: (pos: Position) =>
        set((s: any) => {
            s.text.position = pos
        }),
    setSubtitleStyle: (partial: Partial<SubtitleStyle>) =>
        set((s: any) => {
            Object.assign(s.subtitleStyle, partial)
        }),
    setSubtitles: (subtitles: TextSegment[]) =>
        set((s: any) => {
            s.subtitles = subtitles
        }),
    updateSubtitle: (id: string, partial: Partial<TextSegment>) =>
        set((s: any) => {
            const index = s.subtitles.findIndex((x: any) => x.id === id)
            if (index >= 0) Object.assign(s.subtitles[index], partial)
        }),
    removeSubtitle: (id: string) =>
        set((s: any) => {
            s.subtitles = s.subtitles.filter((x: any) => x.id !== id)
        }),
})
