/**
 * ProgressOverlay — 解析中・SE生成中に表示される進捗バーUI。
 * AIPanel L321-351 を切り出したプレゼンテーショナルコンポーネント。
 */

/** コンポーネントの Props */
export interface ProgressOverlayProps {
    /** 表示するかどうか (isAnalyzing || isGeneratingSe) */
    isActive: boolean
    /** 進捗 (0.0 〜 1.0) */
    progress: number
    /** 進捗メッセージ */
    message: string
}

export function ProgressOverlay({ isActive, progress, message }: ProgressOverlayProps) {
    if (!isActive) return null

    return (
        <div className="w-full rounded border border-cyan-300/20 bg-zinc-900 p-4">
            <h3 className="mb-3 flex items-center justify-between text-[11px] font-medium text-cyan-200">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="truncate">
                        {message || "処理中..."}
                    </span>
                </div>
                <span className="text-[10px] font-mono whitespace-nowrap ml-2">
                    {Math.round(progress * 100)}%
                </span>
            </h3>

            {/* Progress Bar */}
            <div className="h-1.5 w-full overflow-hidden rounded-sm bg-zinc-800">
                <div 
                    className="h-full bg-cyan-400 transition-[width] duration-200 ease-out"
                    style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}
                />
            </div>
        </div>
    )
}
