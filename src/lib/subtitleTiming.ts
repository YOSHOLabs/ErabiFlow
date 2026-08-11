import type { TextSegment } from "./types.ts"

/**
 * 指定した元動画時刻で表示すべき字幕を返す。
 * 手動編集などで区間が重なった場合は、次の発話に相当する開始時刻の新しい字幕を優先する。
 */
export function findActiveSubtitle(subtitles: readonly TextSegment[], mediaTime: number): TextSegment | undefined {
    let active: TextSegment | undefined
    for (const subtitle of subtitles) {
        if (mediaTime < subtitle.start || mediaTime >= subtitle.end) continue
        if (!active || subtitle.start > active.start || (subtitle.start === active.start && subtitle.end < active.end)) {
            active = subtitle
        }
    }
    return active
}
