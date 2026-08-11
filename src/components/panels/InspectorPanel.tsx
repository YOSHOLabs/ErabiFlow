import { lazy, Suspense, type ComponentType, type ReactNode } from "react"
import type { EditorSelection } from "@/stores/editor"
import { useEditorStore } from "@/stores/editor"
import { AvatarSettings } from "./AvatarSettings"
import { BgmSettings } from "./BgmSettings"
import { ImageSettings } from "./ImageSettings"
import { SeSettings } from "./SeSettings"

const ClipInspector = lazy(() => import("./ClipInspectorPanel").then((module) => ({ default: module.ClipInspector })))
const TrackClipInspector = lazy(() => import("./ClipInspectorPanel").then((module) => ({ default: module.TrackClipInspector })))
const GameInspector = lazy(() => import("./ClipInspectorPanel").then((module) => ({ default: module.GameInspector })))
const TextSettings = lazyNamed(() => import("./TextSettings"), "TextSettings")
const SubtitlePanel = lazyNamed(() => import("./SubtitlePanel"), "SubtitlePanel")
const CompositeEditPanel = lazyNamed(() => import("./CompositeEditPanel"), "CompositeEditPanel")

function lazyNamed<TModule, TKey extends keyof TModule>(
    loader: () => Promise<TModule>,
    key: TKey,
) {
    return lazy(async () => ({ default: (await loader())[key] as ComponentType<any> }))
}

const QUICK_TOOLS: { selection: EditorSelection; label: string; description: string }[] = [
    { selection: { type: "text" }, label: "画面テキスト", description: "冒頭などに重ねる文と画面内の位置" },
    { selection: { type: "subtitle" }, label: "字幕", description: "文章・タイミング・スタイル" },
    { selection: { type: "game" }, label: "映像", description: "ゲーム映像の位置と拡大率" },
]

function InspectorHome() {
    const developmentUi = import.meta.env.DEV
    return (
        <div className="space-y-4">
            <div>
                <h2 className="border-l-2 border-cyan-300 pl-3 text-sm font-semibold text-zinc-100">{developmentUi ? "仕上げる" : "要素を選択"}</h2>
                <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                    プレビューかタイムラインで編集したいものを選んでください。
                </p>
            </div>
            {developmentUi && <p className="border-t border-white/[0.08] pt-3 text-[10px] leading-relaxed text-zinc-500">
                上の編集メニューは画面テキスト・字幕・映像に絞っています。合成と生成素材は、必要な時だけ「詳細編集・互換機能」から開けます。
            </p>}
        </div>
    )
}

function EditToolNavigation({ selection }: { selection: EditorSelection }) {
    const select = useEditorStore((state) => state.select)
    return (
        <div className="border-b border-white/[0.08]">
            <nav className="grid grid-cols-3" aria-label="編集メニュー">
                {QUICK_TOOLS.map((tool) => {
                    const active = selection.type === tool.selection.type
                    return (
                        <button
                            key={tool.label}
                            type="button"
                            onClick={() => select(tool.selection)}
                            title={tool.description}
                            aria-pressed={active}
                            className={`relative min-w-0 px-2 py-2 text-center transition-colors ${active
                                ? "text-zinc-50 after:absolute after:inset-x-2 after:bottom-[-1px] after:h-0.5 after:bg-cyan-300"
                                : "text-zinc-500 hover:text-zinc-200"}`}
                        >
                            <span className="truncate text-[12px] font-medium">{tool.label}</span>
                        </button>
                    )
                })}
            </nav>
            <details className="group border-t border-white/[0.05]" open={selection.type === "composite" ? true : undefined}>
                <summary className="cursor-pointer list-none px-3 py-2 text-[10px] text-zinc-600 transition hover:text-zinc-300 [&::-webkit-details-marker]:hidden">
                    詳細編集・互換機能
                </summary>
                <div className="px-3 pb-2.5">
                    <button
                        type="button"
                        onClick={() => select({ type: "composite" })}
                        aria-pressed={selection.type === "composite"}
                        className="w-full border border-white/[0.07] px-3 py-2 text-left text-[11px] text-zinc-400 transition hover:border-cyan-300/20 hover:text-cyan-100"
                    >
                        <span className="block font-medium">合成・追加素材</span>
                        <span className="mt-0.5 block text-[9px] text-zinc-600">別動画・小窓・切り抜き・差し込み・演出</span>
                    </button>
                </div>
            </details>
        </div>
    )
}

function InspectorLoading() {
    return <div role="status" className="py-8 text-center text-[10px] text-zinc-600">設定を読み込んでいます...</div>
}

function selectionContent(selection: EditorSelection): ReactNode {
    switch (selection.type) {
        case "clip": return <ClipInspector id={selection.id} />
        case "trackClip": return <TrackClipInspector id={selection.id} />
        case "text": return <TextSettings />
        case "subtitle": return <SubtitlePanel />
        case "avatar": return <AvatarSettings allowSourceSelection={false} />
        case "image": return <ImageSettings allowAdd={false} />
        case "se": return <SeSettings allowAdd={false} />
        case "audio": return <BgmSettings allowSourceSelection={false} />
        case "game": return <GameInspector />
        case "composite": return <CompositeEditPanel />
        default: return <InspectorHome />
    }
}

export function EditInspector({ selection }: { selection: EditorSelection }) {
    return (
        <div className="space-y-5">
            <EditToolNavigation selection={selection} />
            <div className="border-t border-white/[0.06] pt-5">
                <Suspense fallback={<InspectorLoading />}>{selectionContent(selection)}</Suspense>
            </div>
        </div>
    )
}
