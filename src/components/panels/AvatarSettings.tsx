import { useDocumentStore } from "@/stores/document"
import { open } from "@tauri-apps/plugin-dialog"
import { Button } from "@/components/ui/button"
import { useBlobUrl } from "@/hooks/useBlobUrl"
import { SliderRow, SectionHeader } from "@/components/ui/controls"

export function AvatarSettings({ allowSourceSelection = true }: { allowSourceSelection?: boolean }) {
    const avatarPath = useDocumentStore((s) => s.avatarPath)
    const setAvatarPath = useDocumentStore((s) => s.setAvatarPath)
    const avatarScale = useDocumentStore((s) => s.avatar.scale)
    const avatarPosition = useDocumentStore((s) => s.avatar.position)
    const setAvatarScale = useDocumentStore((s) => s.setAvatarScale)
    const setAvatarPosition = useDocumentStore((s) => s.setAvatarPosition)

    const thumbUrl = useBlobUrl(avatarPath, "image/png")

    const handleSelect = async () => {
        try {
            const file = await open({
                multiple: false,
                filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
            })
            if (file) setAvatarPath(file as string)
        } catch (err) {
            console.error(err)
        }
    }

    return (
        <section className="space-y-5">
            <SectionHeader>アバター</SectionHeader>

            {avatarPath ? (
                <div className="space-y-4">
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/60">
                        {thumbUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={thumbUrl}
                                alt="Avatar"
                                className="w-12 h-12 rounded-lg object-cover border border-zinc-700/50 flex-shrink-0"
                            />
                        ) : (
                            <div className="w-12 h-12 rounded-lg bg-zinc-800 border border-zinc-700/50 animate-pulse flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                            <p className="text-xs text-zinc-200 truncate font-medium">
                                {avatarPath.split("\\").pop()}
                            </p>
                            <p className="text-[10px] text-zinc-600 font-mono mt-0.5">
                                {Math.round(avatarPosition.x * 100)}%, {Math.round(avatarPosition.y * 100)}%
                            </p>
                        </div>
                        {allowSourceSelection && (
                            <button
                                onClick={handleSelect}
                                className="text-xs text-zinc-500 hover:text-zinc-200 transition-colors flex-shrink-0 px-2"
                            >
                                変更
                            </button>
                        )}
                    </div>

                    <SliderRow
                        label="サイズ"
                        value={avatarScale}
                        min={0.2} max={2.0} step={0.05}
                        display={`${Math.round(avatarScale * 100)}`}
                        unit="%"
                        accent="accent-green-500"
                        onChange={setAvatarScale}
                    />

                    <button
                        onClick={() => { setAvatarPosition({ x: 0.5, y: 0.78 }); setAvatarScale(1.0) }}
                        className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
                    >
                        位置・サイズをリセット
                    </button>
                </div>
            ) : allowSourceSelection ? (
                <Button
                    variant="outline"
                    onClick={handleSelect}
                    className="w-full h-12 border-zinc-700/60 bg-zinc-800/40 hover:bg-zinc-700/60 hover:text-white text-sm rounded-xl"
                >
                    アバター画像を選択
                </Button>
            ) : (
                <p className="rounded-xl border border-dashed border-zinc-700/50 bg-zinc-900/30 p-3 text-[10px] text-zinc-500">
                    アバターの追加は「素材」タブにまとめています。
                </p>
            )}
        </section>
    )
}
