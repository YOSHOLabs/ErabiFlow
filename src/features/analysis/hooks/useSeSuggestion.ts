import { useMemo } from "react"
import { useDocumentStore } from "@/stores/document"
import type { AgentHighlight, SeTag, SeFileEntry } from "@/lib/types"

export interface SeSuggestion {
    inferredTags: SeTag[]
    suggestedFiles: SeFileEntry[]
}

/**
 * ハイライトのテキスト (label, reason) から適切なSEタグを推定する
 */
export function inferSeTags(label: string, reason: string): SeTag[] {
    const text = (label + " " + reason).toLowerCase()
    const tags = new Set<SeTag>()

    // 爆発・衝撃
    if (text.match(/(爆発|衝撃|ダメージ|被弾|やば|死んだ|キル|デス|explosion|damage|kill|died)/)) {
        tags.add("explosion")
    }
    // 勝利・クリア
    if (text.match(/(勝利|クリア|ナイス|きた|gg|clutch|victory|win|nice)/)) {
        tags.add("victory")
    }
    // 警告・危険
    if (text.match(/(警告|危険|ピンチ|逃げ|危ない|warning|danger)/)) {
        tags.add("warning")
    }
    // 驚き・発見
    if (text.match(/(驚き|発見|うわ|まじ|すご|おお|見つけた|wow|surprise|no way|oh my)/)) {
        tags.add("surprise")
    }
    // 緊張・ピンチ
    if (text.match(/(緊張|ピンチ|焦り|tension|panic|sweat)/)) {
        tags.add("tension")
    }
    // 笑い・コメディ
    if (text.match(/(笑|草|面白|コメディ|haha|lol|comedy)/)) {
        tags.add("comedy")
    }
    // 場面転換
    if (text.match(/(場面転換|シーン変更|transition|scene)/)) {
        tags.add("transition")
    }
    // 強調・注目
    if (text.match(/(強調|注目|ここ|急激な音量|onset|emphasis)/)) {
        tags.add("emphasis")
    }

    return Array.from(tags)
}

export function useSeSuggestion() {
    const seFileEntries = useDocumentStore((s) => s.seFileEntries)

    // Highlight を受け取って、関連するSEの提案を返す
    const getSuggestions = useMemo(() => {
        return (highlight: AgentHighlight): SeSuggestion => {
            const tags = inferSeTags(highlight.label, highlight.reason)
            
            // タグが一つも推定できなかった場合は空で返す
            if (tags.length === 0) {
                return { inferredTags: [], suggestedFiles: [] }
            }

            // マッチするタグを持っているファイルを抽出
            const matchedFiles = seFileEntries.filter(entry => 
                entry.tags.some(t => tags.includes(t))
            )

            // タグの一致数が多い順にソート
            matchedFiles.sort((a, b) => {
                const aMatch = a.tags.filter(t => tags.includes(t)).length
                const bMatch = b.tags.filter(t => tags.includes(t)).length
                return bMatch - aMatch
            })

            return {
                inferredTags: tags,
                suggestedFiles: matchedFiles
            }
        }
    }, [seFileEntries])

    return { getSuggestions }
}
