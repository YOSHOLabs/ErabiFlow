/**
 * RecommendedCutList — AI推奨カットカード一覧UI。
 * AIPanel L473-517 のカード一覧 + L257-264 の handleAdoptHighlight を切り出し。
 * ストアから recommendedCuts, agentThinking を直接取得する。
 */
import { useDocumentStore } from "@/stores/document"
import { useEditorStore } from "@/stores/editor"
import { useSeSuggestion } from "./hooks/useSeSuggestion"
import { SE_TAG_META, type SeFileEntry } from "@/lib/types"
import { mediaRangeToSequenceRanges, shouldReplaceTimelineOnFirstAdoption } from "@/lib/timeline"
import { hasCapability } from "@/lib/entitlements"
import { useEntitlementStore } from "@/stores/entitlement"

/** 推奨カットの型 */
interface RecommendedCut {
    start: number
    end: number
    label: string
    reason: string
    excitement: number
    isProRequired?: boolean
}

/** コンポーネントの Props */
export interface RecommendedCutListProps {
    /** 解析中かどうか（解析中は非表示にする） */
    isAnalyzing: boolean
}

export function RecommendedCutList({ isAnalyzing }: RecommendedCutListProps) {
    const recommendedCuts = useDocumentStore((s) => s.recommendedCuts) as RecommendedCut[]
    const agentThinking = useDocumentStore((s) => s.agentThinking)
    const setPreviewTime = useEditorStore((s) => s.setPreviewTime)
    const setIsPlaying = useEditorStore((s) => s.setIsPlaying)
    const addSeSlot = useDocumentStore((s) => s.addSeSlot)
    const productPlan = useEntitlementStore((s) => s.plan)
    
    // タイムラインのクリップを管理するためのストア
    const timelineClips = useDocumentStore((s) => s.timelineClips)
    const setTimelineClips = useDocumentStore((s) => s.setTimelineClips)
    const duration = useDocumentStore((s) => s.videoInfo?.duration || 0)

    const { getSuggestions } = useSeSuggestion()

    const getSequenceStart = (highlight: RecommendedCut) => {
        return mediaRangeToSequenceRanges(timelineClips, highlight.start, highlight.end)[0]?.sequenceStart
            ?? highlight.start
    }

    // クリップが採用済みかどうかを判定
    const isAdopted = (h: RecommendedCut) => {
        return timelineClips.some(c => Math.abs(c.mediaStart - h.start) < 0.1 && Math.abs(c.mediaEnd - h.end) < 0.1)
    }

    // 個別ハイライト採用/解除のトグル
    const toggleAdoptHighlight = (highlight: RecommendedCut) => {
        if (isAdopted(highlight)) {
            // 採用解除
            const newClips = timelineClips.filter(c => !(Math.abs(c.mediaStart - highlight.start) < 0.1 && Math.abs(c.mediaEnd - highlight.end) < 0.1))
            setTimelineClips(newClips)
        } else {
            // 採用
            const newClip = {
                id: crypto.randomUUID(),
                mediaStart: highlight.start,
                mediaEnd: highlight.end,
                label: `AI: ${highlight.label.substring(0, 30)}`,
            }
            
            // 最初の採用時（オリジナル動画のみの状態）は置き換える
            if (shouldReplaceTimelineOnFirstAdoption(timelineClips, duration)) {
                setTimelineClips([newClip])
            } else {
                setTimelineClips([...timelineClips, newClip])
            }
        }
    }

    const handleAddSe = (highlight: RecommendedCut, seFile: SeFileEntry) => {
        addSeSlot({
            id: crypto.randomUUID(),
            path: seFile.path,
            volume: 0.8,
            triggerTime: getSequenceStart(highlight),
            label: seFile.fileName
        })
    }

    return (
        <>
            {/* 思考と結果表示 */}
            {agentThinking && !isAnalyzing && (
                <div className="mt-4 p-3 bg-black/30 border border-zinc-800/60 rounded">
                    <div className="text-[9px] text-violet-400/60 uppercase tracking-wider mb-2 font-semibold flex items-center gap-1">
                        Agent Reasoning
                    </div>
                    <p className="text-[10px] text-zinc-400 italic font-serif leading-relaxed">
                        "{agentThinking}"
                    </p>
                </div>
            )}

            {recommendedCuts.length > 0 && !isAnalyzing && (
                <div className="mt-4 space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
                    <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Recommended Cuts</div>
                    {recommendedCuts.map((h, i) => {
                        const isLocked = h.isProRequired && !hasCapability(productPlan, "clips.extendedCandidates");
                        const suggestion = getSuggestions(h);
                        
                        return (
                        <div 
                            key={i} 
                            onClick={() => {
                                if (!isLocked) {
                                    setIsPlaying(false)
                                    setPreviewTime(getSequenceStart(h))
                                }
                            }}
                            className={`w-full bg-[#141417] border border-zinc-800 rounded-sm p-3 transition-all group relative overflow-hidden ${isLocked ? 'cursor-not-allowed opacity-80' : 'hover:bg-[#1a1a1f] hover:border-violet-500/50 cursor-pointer'}`}
                        >
                            {isLocked && (
                                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/85">
                                    <div className="mb-1 border border-amber-500/25 bg-amber-500/10 p-2">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500">
                                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                        </svg>
                                    </div>
                                    <span className="text-amber-500 font-bold text-[11px] tracking-wide">CREATORで利用可能</span>
                                </div>
                            )}
                            <div className="text-[10px] text-zinc-500 mb-2 flex items-center justify-between relative z-0">
                                <span className="flex items-center gap-1.5 font-mono bg-black/40 px-1.5 py-0.5 rounded text-zinc-400">
                                    {h.start.toFixed(1)}s - {h.end.toFixed(1)}s
                                </span>
                                <div className="flex gap-1.5">
                                    {suggestion.inferredTags.map(tag => {
                                        const meta = SE_TAG_META[tag]
                                        return (
                                            <span key={tag} className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[9px] bg-zinc-800 border border-zinc-700 text-zinc-300" title={meta.label}>
                                                <img src={meta.iconPath} alt={meta.label} className="w-3 h-3" />
                                                {meta.label}
                                            </span>
                                        )
                                    })}
                                    {h.excitement && (
                                        <span className={`px-1.5 py-0.5 rounded-sm text-[9px] uppercase tracking-wider font-semibold ${
                                            h.excitement >= 80 ? 'bg-red-900/20 text-red-400' :
                                            h.excitement >= 50 ? 'bg-orange-900/20 text-orange-400' :
                                            'bg-violet-900/20 text-violet-400'
                                        }`}>
                                            LV.{h.excitement}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="font-semibold text-[13px] text-white leading-snug line-clamp-1 mb-1">
                                {h.label}
                            </div>
                            {h.reason && (
                                <div className="text-[10px] text-zinc-400 italic leading-tight mt-1.5 bg-black/20 p-2 border border-zinc-800/40 rounded">
                                    {h.reason}
                                </div>
                            )}
                            
                            {/* SE提案ボタン */}
                            {suggestion.suggestedFiles.length > 0 && !isLocked && (
                                <div className="mt-2.5 flex flex-wrap gap-1.5 relative z-0">
                                    {suggestion.suggestedFiles.map(se => (
                                        <button
                                            key={se.id}
                                            onClick={(e) => { e.stopPropagation(); handleAddSe(h, se); }}
                                            className="px-2 py-1 bg-indigo-900/30 hover:bg-indigo-800/50 border border-indigo-700/40 text-indigo-300 text-[9px] rounded flex items-center gap-1 transition-all active:scale-[0.95]"
                                            title="タイムラインにSEを追加"
                                        >
                                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                                                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                                            </svg>
                                            {se.fileName}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* 個別採用ボタン */}
                            {(() => {
                                const adopted = isAdopted(h)
                                return (
                                    <button
                                        disabled={isLocked}
                                        onClick={(e) => { e.stopPropagation(); if (!isLocked) toggleAdoptHighlight(h); }}
                                        className={`mt-2 w-full px-2 py-1.5 text-[10px] font-semibold border rounded flex items-center justify-center gap-1 transition-all relative z-0 ${
                                            isLocked ? 'bg-zinc-900 border-zinc-800 text-zinc-600' : 
                                            adopted ? 'bg-zinc-800/80 hover:bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-300' :
                                            'bg-emerald-900/30 hover:bg-emerald-800/50 border-emerald-700/40 text-emerald-400 hover:text-emerald-300 active:scale-[0.97]'
                                        }`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            {adopted ? (
                                                <>
                                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                                </>
                                            ) : (
                                                <polyline points="20 6 9 17 4 12"></polyline>
                                            )}
                                        </svg>
                                        {adopted ? '採用を解除' : 'タイムラインに採用'}
                                    </button>
                                )
                            })()}
                        </div>
                        );
                    })}
                </div>
            )}
        </>
    )
}
