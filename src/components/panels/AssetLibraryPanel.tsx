import { useState } from "react"
import { useDocumentStore } from "@/stores/document"
import { useEditorStore } from "@/stores/editor"
import { AvatarSettings } from "./AvatarSettings"
import { BgmSettings } from "./BgmSettings"
import { ImageSettings } from "./ImageSettings"
import { SeSettings } from "./SeSettings"
import { SeLibraryPanel } from "@/features/analysis/SeLibraryPanel"
import { MediaLibrary } from "./MediaLibrary"
import { NarrationRecorder } from "./NarrationRecorder"
import { StickerPanel } from "./StickerPanel"
import { AiCutoutPanel } from "./AiCutoutPanel"

type AdvancedLibraryTab = "audio" | "overlay"

const ADVANCED_TABS: Array<{ id: AdvancedLibraryTab; label: string }> = [
    { id: "audio", label: "音" },
    { id: "overlay", label: "重ねる" },
]

export function AssetLibraryPanel() {
    const developmentUi = import.meta.env.DEV
    const [advancedTab, setAdvancedTab] = useState<AdvancedLibraryTab>("audio")
    const videoInfo = useDocumentStore((state) => state.videoInfo)
    const select = useEditorStore((state) => state.select)

    return (
        <aside className="flex h-full min-h-0 flex-col border-r border-white/[0.07] bg-[#0e141c]">
            <div className="flex-none border-b border-white/[0.07] px-3.5 pt-3.5">
                <div className="mb-3 px-1">
                    <h2 className="text-[13px] font-semibold text-zinc-100">素材ライブラリ</h2>
                    {developmentUi && <p className="mt-0.5 text-[10px] text-zinc-500">追加・整理してタイムラインへ配置</p>}
                </div>
            </div>

            <div className="vf-workspace-surface custom-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3">
                <div className="space-y-3">
                    <MediaLibrary />
                    {videoInfo && (
                        <div className="border-t border-white/[0.08] pt-3">
                            {developmentUi && <><div className="text-[10px] font-semibold text-zinc-300">元動画</div>
                            <div className="mt-1 font-mono text-[9px] text-zinc-600">
                                {videoInfo.width}×{videoInfo.height} · {Math.round(videoInfo.fps ?? 30)} FPS
                            </div></>}
                            <button
                                type="button"
                                onClick={() => select({ type: "game" })}
                                className="mt-3 w-full border border-cyan-300/20 px-3 py-2 text-[11px] font-medium text-cyan-100 transition-colors hover:bg-cyan-300/[0.06]"
                            >
                                縦画面の構図を調整
                            </button>
                        </div>
                    )}

                    <details className="group border-t border-white/[0.08] pt-3" data-testid="advanced-asset-library">
                        <summary className="flex cursor-pointer list-none items-center justify-between border border-white/[0.07] bg-black/10 px-3 py-2.5 text-[11px] font-medium text-zinc-400 transition hover:text-zinc-200 [&::-webkit-details-marker]:hidden">
                            <span>追加の音・重ね素材</span>
                            <span className="text-[10px] text-zinc-600 group-open:text-cyan-200">BGM・SE・音声合成・ステッカー・切り抜き</span>
                        </summary>
                        <div className="space-y-3 border-x border-b border-white/[0.07] p-3">
                            <nav aria-label="詳細素材" className="grid grid-cols-2">
                                {ADVANCED_TABS.map((item) => {
                                    const active = advancedTab === item.id
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => setAdvancedTab(item.id)}
                                            aria-pressed={active}
                                            className={`h-9 border-b px-2 text-[11px] font-medium transition-colors ${
                                                active
                                                    ? "border-cyan-300 text-zinc-100"
                                                    : "border-white/[0.08] text-zinc-600 hover:text-zinc-300"
                                            }`}
                                        >
                                            {item.label}
                                        </button>
                                    )
                                })}
                            </nav>

                            {advancedTab === "audio" && (
                                <div className="space-y-4">
                                    <BgmSettings />
                                    <NarrationRecorder />
                                    <SeSettings />
                                    <SeLibraryPanel />
                                </div>
                            )}

                            {advancedTab === "overlay" && (
                                <div className="space-y-4">
                                    <AvatarSettings />
                                    <ImageSettings />
                                    <StickerPanel />
                                    <AiCutoutPanel />
                                </div>
                            )}
                        </div>
                    </details>
                </div>
            </div>
        </aside>
    )
}
