import { useMemo, useState } from "react"
import { Check, Copy, Send } from "lucide-react"
import type { PublishPlatform } from "@/lib/types"
import { getSequenceDuration } from "@/lib/timeline"
import { buildPostText, PLATFORM_SPECS } from "@/lib/verticalTrends"
import { useDocumentStore } from "@/stores/document"
import { useEditorStore } from "@/stores/editor"

const PLATFORM_ORDER: PublishPlatform[] = ["tiktok", "instagram", "youtube"]

export function PublishDetailsPanel() {
    const publishing = useDocumentStore((state) => state.publishing)
    const timelineClips = useDocumentStore((state) => state.timelineClips)
    const setPublishing = useDocumentStore((state) => state.setPublishing)
    const previewTime = useEditorStore((state) => state.previewTime)
    const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle")
    const postText = useMemo(() => buildPostText({ publishing }), [publishing])
    const sequenceDuration = useMemo(() => getSequenceDuration(timelineClips), [timelineClips])

    const setCoverTime = (value: number) => {
        const finite = Number.isFinite(value) ? value : 0
        setPublishing({ coverTime: Number(Math.max(0, Math.min(sequenceDuration, finite)).toFixed(1)) })
    }

    const copyPostText = async () => {
        if (!postText) return
        try {
            await navigator.clipboard.writeText(postText)
            setCopyState("copied")
        } catch {
            setCopyState("error")
        }
        window.setTimeout(() => setCopyState("idle"), 2200)
    }

    return (
        <details
            className="group rounded-2xl border border-white/[0.06] bg-white/[0.02]"
            data-testid="publish-details-panel"
        >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] text-cyan-200">
                        <Send className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                        <span className="block text-[11px] font-semibold text-zinc-200">投稿メモ</span>
                        <span className="mt-0.5 block truncate text-[10px] text-zinc-600">投稿先・説明文・権利確認（MP4には入りません）</span>
                    </span>
                </span>
                <span className="flex-none text-[10px] text-zinc-600 group-open:text-cyan-200">任意</span>
            </summary>

            <div className="space-y-4 border-t border-white/[0.06] p-4">
                <div>
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] font-semibold text-zinc-500">投稿先</p>
                        <button
                            type="button"
                            onClick={() => setPublishing({ showSafeZone: !publishing.showSafeZone })}
                            aria-pressed={publishing.showSafeZone}
                            className={`rounded-lg border px-2.5 py-2 text-[10px] font-medium transition ${
                                publishing.showSafeZone
                                    ? "border-cyan-300/25 bg-cyan-300/[0.07] text-cyan-100"
                                    : "border-white/[0.07] text-zinc-500 hover:bg-white/[0.03]"
                            }`}
                        >
                            UI回避ガイド
                        </button>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                        {PLATFORM_ORDER.map((platform) => {
                            const spec = PLATFORM_SPECS[platform]
                            const active = publishing.platform === platform
                            return (
                                <button
                                    key={platform}
                                    type="button"
                                    onClick={() => setPublishing({ platform })}
                                    aria-pressed={active}
                                    className={`rounded-xl border px-3 py-2 text-left transition ${
                                        active
                                            ? "border-cyan-300/25 bg-cyan-300/[0.08] text-cyan-100"
                                            : "border-white/[0.06] bg-black/10 text-zinc-500 hover:bg-white/[0.035]"
                                    }`}
                                >
                                    <span className="block text-[11px] font-semibold">{spec.shortLabel}</span>
                                    <span className="mt-0.5 block font-mono text-[9px] opacity-60">{spec.idealDuration[0]}–{spec.idealDuration[1]}s</span>
                                </button>
                            )
                        })}
                    </div>
                </div>

                <label className="block text-[10px] font-medium text-zinc-500">
                    説明文
                    <textarea
                        value={publishing.caption}
                        onChange={(event) => setPublishing({ caption: event.target.value })}
                        rows={3}
                        placeholder="クリップの背景を一言"
                        className="mt-1.5 w-full resize-y rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-[11px] leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-cyan-300/25"
                    />
                </label>

                <div className="grid grid-cols-2 gap-2">
                    <label className="text-[10px] font-medium text-zinc-500">
                        会話を生む一言
                        <input
                            value={publishing.cta}
                            onChange={(event) => setPublishing({ cta: event.target.value })}
                            placeholder="あなたならどうする？"
                            className="mt-1.5 w-full rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-cyan-300/25"
                        />
                    </label>
                    <label className="text-[10px] font-medium text-zinc-500">
                        ハッシュタグ
                        <input
                            value={publishing.hashtags}
                            onChange={(event) => setPublishing({ hashtags: event.target.value })}
                            placeholder="ゲーム名 実況"
                            className="mt-1.5 w-full rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-cyan-300/25"
                        />
                    </label>
                </div>

                <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                    <label className="text-[10px] font-medium text-zinc-500">
                        カバー候補時刻
                        <input
                            type="number"
                            min={0}
                            max={sequenceDuration}
                            step={0.1}
                            value={publishing.coverTime}
                            onChange={(event) => setCoverTime(Number(event.target.value))}
                            className="mt-1.5 w-full rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 font-mono text-[11px] text-zinc-200 outline-none focus:border-cyan-300/25"
                        />
                    </label>
                    <button
                        type="button"
                        onClick={() => setCoverTime(previewTime)}
                        className="rounded-xl border border-white/[0.07] px-3 py-2 text-[10px] text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-200"
                    >
                        現在位置
                    </button>
                </div>

                <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-white/[0.05] bg-black/10 p-3">
                    <input
                        type="checkbox"
                        checked={publishing.rightsChecked}
                        onChange={(event) => setPublishing({ rightsChecked: event.target.checked })}
                        className="mt-0.5 accent-cyan-400"
                    />
                    <span className="text-[10px] leading-relaxed text-zinc-500">映像・BGM・SEの利用権利を自分で確認した</span>
                </label>

                <button
                    type="button"
                    onClick={copyPostText}
                    disabled={!postText}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] py-2.5 text-[11px] font-semibold text-zinc-300 transition hover:border-cyan-300/20 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-35"
                >
                    {copyState === "copied" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copyState === "copied" ? "コピーしました" : copyState === "error" ? "コピーできませんでした" : "投稿文をコピー"}
                </button>
            </div>
        </details>
    )
}
