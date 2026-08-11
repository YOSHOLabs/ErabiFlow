import { open } from "@tauri-apps/plugin-dialog"
import { Film, FolderPlus, Image as ImageIcon, Loader2, Music2, Plus, Star, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { commands } from "@/tauri/commands"
import { hasBlockingBackgroundJob } from "@/lib/backgroundJob"
import { isActiveAnalysisJob } from "@/lib/analysisJob"
import { createMediaAsset, MEDIA_DIALOG_EXTENSIONS } from "@/lib/mediaLibrary"
import { getSequenceDuration } from "@/lib/timeline"
import { createEditorTrack, createTrackMediaClip } from "@/lib/multiTrack"
import type { MediaAsset, MediaAssetKind } from "@/lib/types"
import { useDocumentStore } from "@/stores/document"
import { useBackgroundJobStore } from "@/stores/backgroundJobs"
import { useEditorStore } from "@/stores/editor"

type FolderFilter = "all" | "favorites" | string

const KIND_LABEL: Record<MediaAssetKind, string> = {
    video: "動画",
    image: "画像",
    audio: "音声",
}

function formatDuration(duration?: number) {
    if (!duration || !Number.isFinite(duration)) return null
    const minutes = Math.floor(duration / 60)
    const seconds = Math.floor(duration % 60)
    return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

function formatBytes(bytes?: number) {
    if (!bytes || !Number.isFinite(bytes)) return null
    return bytes >= 1024 * 1024
        ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
        : `${Math.ceil(bytes / 1024)} KB`
}

function AssetIcon({ kind }: { kind: MediaAssetKind }) {
    if (kind === "video") return <Film className="h-3.5 w-3.5" />
    if (kind === "image") return <ImageIcon className="h-3.5 w-3.5" />
    return <Music2 className="h-3.5 w-3.5" />
}

export function MediaLibrary() {
    const assets = useDocumentStore((state) => state.mediaAssets)
    const folders = useDocumentStore((state) => state.mediaFolders)
    const inputPath = useDocumentStore((state) => state.inputPath)
    const timelineClips = useDocumentStore((state) => state.timelineClips)
    const videoInfo = useDocumentStore((state) => state.videoInfo)
    const previewTime = useEditorStore((state) => state.previewTime)
    const editorTracks = useDocumentStore((state) => state.editorTracks)
    const addMediaAssets = useDocumentStore((state) => state.addMediaAssets)
    const updateMediaAsset = useDocumentStore((state) => state.updateMediaAsset)
    const removeMediaAsset = useDocumentStore((state) => state.removeMediaAsset)
    const addMediaFolder = useDocumentStore((state) => state.addMediaFolder)
    const updateMediaFolder = useDocumentStore((state) => state.updateMediaFolder)
    const removeMediaFolder = useDocumentStore((state) => state.removeMediaFolder)
    const setInputPath = useDocumentStore((state) => state.setInputPath)
    const setBgmPath = useDocumentStore((state) => state.setBgmPath)
    const addImage = useDocumentStore((state) => state.addImage)
    const addEditorTrack = useDocumentStore((state) => state.addEditorTrack)
    const addTrackMediaClip = useDocumentStore((state) => state.addTrackMediaClip)
    const setWorkspace = useEditorStore((state) => state.setWorkspace)
    const isAnalyzing = useDocumentStore((state) => {
        const active = state.analysisJobs.find((job) => job.id === state.activeAnalysisJobId)
        return isActiveAnalysisJob(active)
    })
    const isProcessing = useBackgroundJobStore((state) => hasBlockingBackgroundJob(state.jobs))
    const hasBackgroundOperation = isProcessing || isAnalyzing
    const [folderFilter, setFolderFilter] = useState<FolderFilter>("all")
    const [importing, setImporting] = useState(false)
    const [proxyJobs, setProxyJobs] = useState<Record<string, boolean>>({})
    const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

    const filteredAssets = useMemo(() => {
        if (folderFilter === "favorites") return assets.filter((asset) => asset.favorite)
        if (folderFilter === "all") return assets
        return assets.filter((asset) => asset.folderId === folderFilter)
    }, [assets, folderFilter])

    const showMessage = (text: string, ok: boolean) => {
        setMessage({ text, ok })
        window.setTimeout(() => setMessage(null), 3500)
    }

    const importAssets = async () => {
        setImporting(true)
        try {
            const selected = await open({
                multiple: true,
                filters: [{ name: "動画・画像・音声", extensions: MEDIA_DIALOG_EXTENSIONS }],
            })
            const paths = selected ? (Array.isArray(selected) ? selected : [selected]) : []
            const targetFolder = folderFilter !== "all" && folderFilter !== "favorites" ? folderFilter : null
            const entries = paths
                .map((path) => createMediaAsset(path, targetFolder))
                .filter((asset): asset is MediaAsset => asset !== null)
            if (entries.length === 0) return

            addMediaAssets(entries)
            const firstVideo = entries.find((asset) => asset.kind === "video")
            if (!inputPath && firstVideo) {
                setInputPath(firstVideo.path)
                setWorkspace("draft")
                useDocumentStore.temporal.getState().clear()
            }

            await Promise.all(entries
                .filter((asset) => asset.kind === "video" || asset.kind === "audio")
                .map(async (asset) => {
                    try {
                        const info = await commands.getVideoInfo({ inputPath: asset.path })
                        updateMediaAsset(asset.id, {
                            duration: info.duration,
                            width: info.width,
                            height: info.height,
                            fps: info.fps,
                            hasAudio: info.hasAudio,
                        })
                    } catch (error) {
                        console.warn("素材情報を取得できません", asset.path, error)
                    }
                }))
            showMessage(`${entries.length}件の素材を追加しました`, true)
        } catch (error) {
            console.error(error)
            showMessage("素材を追加できませんでした", false)
        } finally {
            setImporting(false)
        }
    }

    const createFolder = () => {
        const name = window.prompt("素材フォルダ名")?.trim()
        if (!name) return
        const folder = {
            id: globalThis.crypto?.randomUUID?.() ?? `folder-${Date.now()}`,
            name,
            createdAt: new Date().toISOString(),
        }
        addMediaFolder(folder)
        setFolderFilter(folder.id)
    }

    const renameFolder = (id: string, currentName: string) => {
        const name = window.prompt("新しいフォルダ名", currentName)?.trim()
        if (name) updateMediaFolder(id, { name })
    }

    const deleteFolder = (id: string) => {
        if (!window.confirm("フォルダを削除しますか？素材ファイル自体は削除されず、すべて「全素材」へ戻ります。")) return
        removeMediaFolder(id)
        setFolderFilter("all")
    }

    const useAsset = (asset: MediaAsset) => {
        if (asset.kind === "video") {
            if (hasBackgroundOperation && inputPath !== asset.path) {
                showMessage("処理中は元動画を変更できません", false)
                return
            }
            if (inputPath !== asset.path && (timelineClips.length > 0 || Boolean(inputPath))) {
                const accepted = window.confirm("元動画を変更すると、現在のタイムラインと解析結果がリセットされます。続けますか？")
                if (!accepted) return
            }
            setInputPath(asset.path)
            setWorkspace("draft")
            useDocumentStore.temporal.getState().clear()
            return
        }
        if (asset.kind === "audio") {
            setBgmPath(asset.path)
            showMessage("BGMトラックへ設定しました", true)
            return
        }

        const sequenceDuration = getSequenceDuration(timelineClips) || videoInfo?.duration || previewTime + 5
        addImage({
            id: globalThis.crypto?.randomUUID?.() ?? `image-${Date.now()}`,
            path: asset.path,
            position: { x: 0.5, y: 0.5 },
            scale: 0.5,
            startTime: previewTime,
            endTime: Math.max(previewTime + 0.1, Math.min(sequenceDuration, previewTime + 5)),
            label: asset.name,
        })
        showMessage("画像トラックへ追加しました", true)
    }

    const placeOnTrack = (asset: MediaAsset) => {
        if (asset.kind === "image") {
            useAsset(asset)
            return
        }
        let track = editorTracks.find((item) => item.kind === asset.kind && !item.locked)
        if (!track) {
            track = createEditorTrack(asset.kind, editorTracks)
            addEditorTrack(track)
        }
        const sequenceDuration = Math.max(
            getSequenceDuration(timelineClips) || videoInfo?.duration || 0,
            ...useDocumentStore.getState().trackMediaClips.map((clip) => clip.timelineEnd),
            previewTime + (asset.duration ?? 5),
        )
        const clip = createTrackMediaClip(asset, track, previewTime, sequenceDuration)
        if (!clip) return
        addTrackMediaClip(clip)
        setWorkspace("edit")
        showMessage(`${track.name}へ配置しました`, true)
    }

    const generateProxy = async (asset: MediaAsset) => {
        setProxyJobs((current) => ({ ...current, [asset.id]: true }))
        try {
            const result = await commands.generateMediaProxy({ inputPath: asset.path })
            updateMediaAsset(asset.id, {
                proxyPath: result.path,
                proxyBytes: result.bytes,
                proxyCreatedAt: new Date().toISOString(),
            })
            showMessage(result.reused ? "既存プロキシを確認しました" : "プロキシを生成しました", true)
        } catch (error) {
            console.error(error)
            showMessage(error instanceof Error ? error.message : String(error), false)
        } finally {
            setProxyJobs((current) => ({ ...current, [asset.id]: false }))
        }
    }

    const removeProxy = async (asset: MediaAsset) => {
        if (!asset.proxyPath) return
        try {
            await commands.removeMediaProxy({ proxyPath: asset.proxyPath })
            updateMediaAsset(asset.id, { proxyPath: undefined, proxyBytes: undefined, proxyCreatedAt: undefined })
            showMessage("プロキシを削除しました", true)
        } catch (error) {
            console.error(error)
            showMessage("プロキシを削除できませんでした", false)
        }
    }

    const deleteAsset = (asset: MediaAsset) => {
        removeMediaAsset(asset.id)
        if (asset.proxyPath) void commands.removeMediaProxy({ proxyPath: asset.proxyPath }).catch(console.warn)
    }

    return (
        <div className="space-y-3" data-testid="media-library">
            <div className="grid grid-cols-2 gap-2">
                <button
                    type="button"
                    onClick={() => void importAssets()}
                    disabled={importing}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-cyan-300 px-2 py-2 text-[10px] font-bold text-cyan-950 hover:bg-cyan-200 disabled:opacity-50"
                >
                    {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    複数素材を追加
                </button>
                <button
                    type="button"
                    onClick={createFolder}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] px-2 py-2 text-[10px] font-semibold text-zinc-300 hover:bg-white/[0.04]"
                >
                    <FolderPlus className="h-3.5 w-3.5" />フォルダ作成
                </button>
            </div>

            {message && (
                <div className={`rounded-lg border px-2.5 py-2 text-[9px] ${message.ok ? "border-emerald-300/15 bg-emerald-300/[0.05] text-emerald-200" : "border-red-300/15 bg-red-300/[0.05] text-red-200"}`}>
                    {message.text}
                </div>
            )}

            <div className="flex gap-1 overflow-x-auto pb-1">
                <FolderChip active={folderFilter === "all"} label={`全素材 ${assets.length}`} onClick={() => setFolderFilter("all")} />
                <FolderChip active={folderFilter === "favorites"} label={`★ ${assets.filter((asset) => asset.favorite).length}`} onClick={() => setFolderFilter("favorites")} />
                {folders.map((folder) => (
                    <div key={folder.id} className="flex flex-none items-center rounded-lg border border-white/[0.06] bg-black/15">
                        <FolderChip active={folderFilter === folder.id} label={folder.name} onClick={() => setFolderFilter(folder.id)} borderless />
                        <button type="button" aria-label={`${folder.name}を名前変更`} onClick={() => renameFolder(folder.id, folder.name)} className="px-1 text-[8px] text-zinc-600 hover:text-zinc-200">✎</button>
                        <button type="button" aria-label={`${folder.name}を削除`} onClick={() => deleteFolder(folder.id)} className="pr-1.5 text-[9px] text-zinc-700 hover:text-red-300">×</button>
                    </div>
                ))}
            </div>

            {filteredAssets.length === 0 ? (
                <button type="button" onClick={() => void importAssets()} className="w-full rounded-xl border border-dashed border-white/[0.1] px-3 py-8 text-center text-[10px] text-zinc-600 hover:border-cyan-300/25 hover:text-zinc-400">
                    動画・画像・音声をまとめて追加
                </button>
            ) : (
                <div className="space-y-2">
                    {filteredAssets.map((asset) => {
                        const proxyBusy = proxyJobs[asset.id] === true
                        const activeSource = asset.kind === "video" && asset.path === inputPath
                        const duration = formatDuration(asset.duration)
                        return (
                            <article key={asset.id} className={`rounded-xl border p-2.5 ${activeSource ? "border-cyan-300/25 bg-cyan-300/[0.045]" : "border-white/[0.06] bg-black/15"}`}>
                                <div className="flex items-start gap-2">
                                    <span className={`mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg ${asset.kind === "video" ? "bg-cyan-300/10 text-cyan-200" : asset.kind === "image" ? "bg-fuchsia-300/10 text-fuchsia-200" : "bg-purple-300/10 text-purple-200"}`}>
                                        <AssetIcon kind={asset.kind} />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                            <p className="truncate text-[10px] font-semibold text-zinc-200" title={asset.path}>{asset.name}</p>
                                            {activeSource && <span className="flex-none rounded bg-cyan-300/10 px-1 text-[7px] font-bold text-cyan-200">元動画</span>}
                                        </div>
                                        <p className="mt-0.5 truncate text-[8px] text-zinc-600">
                                            {KIND_LABEL[asset.kind]}
                                            {duration ? ` · ${duration}` : ""}
                                            {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        aria-label={`${asset.name}をお気に入り${asset.favorite ? "解除" : "登録"}`}
                                        onClick={() => updateMediaAsset(asset.id, { favorite: !asset.favorite })}
                                        className={`flex-none ${asset.favorite ? "text-amber-300" : "text-zinc-700 hover:text-amber-300"}`}
                                    >
                                        <Star className={`h-3.5 w-3.5 ${asset.favorite ? "fill-current" : ""}`} />
                                    </button>
                                </div>

                                <div className="mt-2 flex items-center gap-1.5">
                                    {(import.meta.env.DEV || folders.length > 0) && <select
                                        aria-label={`${asset.name}のフォルダ`}
                                        value={asset.folderId ?? ""}
                                        onChange={(event) => updateMediaAsset(asset.id, { folderId: event.target.value || null })}
                                        className="h-6 min-w-0 flex-1 rounded-md border border-white/[0.07] bg-[#111216] px-1.5 text-[8px] text-zinc-500"
                                    >
                                        <option value="">フォルダなし</option>
                                        {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                                    </select>}
                                    <button type="button" onClick={() => useAsset(asset)} className="h-6 rounded-md border border-cyan-300/20 px-2 text-[8px] font-semibold text-cyan-100 hover:bg-cyan-300/[0.07]">
                                        {asset.kind === "video" ? (activeSource ? "使用中" : "元動画にする") : asset.kind === "image" ? "配置" : "BGMへ"}
                                    </button>
                                    {asset.kind !== "image" && (
                                        <button type="button" onClick={() => placeOnTrack(asset)} className="h-6 rounded-md border border-violet-300/20 px-2 text-[8px] font-semibold text-violet-100 hover:bg-violet-300/[0.07]">
                                            トラックへ
                                        </button>
                                    )}
                                    <button type="button" aria-label={`${asset.name}をライブラリから削除`} onClick={() => deleteAsset(asset)} className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-700 hover:bg-red-300/[0.06] hover:text-red-300">
                                        <Trash2 className="h-3 w-3" />
                                    </button>
                                </div>

                                {asset.kind === "video" && (
                                    <div className="mt-2 flex items-center justify-between border-t border-white/[0.05] pt-2">
                                        <span className="text-[8px] text-zinc-600">
                                            {asset.proxyPath ? `プロキシ使用可能${formatBytes(asset.proxyBytes) ? ` · ${formatBytes(asset.proxyBytes)}` : ""}` : "プロキシなし"}
                                        </span>
                                        {asset.proxyPath ? (
                                            <button type="button" onClick={() => void removeProxy(asset)} className="text-[8px] text-zinc-600 hover:text-red-300">削除</button>
                                        ) : (
                                            <button type="button" disabled={proxyBusy} onClick={() => void generateProxy(asset)} className="flex items-center gap-1 text-[8px] font-semibold text-cyan-300/80 hover:text-cyan-200 disabled:opacity-40">
                                                {proxyBusy && <Loader2 className="h-3 w-3 animate-spin" />}
                                                {proxyBusy ? "生成中" : "プロキシ生成"}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </article>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

function FolderChip({ active, label, onClick, borderless = false }: { active: boolean; label: string; onClick: () => void; borderless?: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex-none rounded-lg px-2 py-1 text-[8px] font-medium transition ${active ? "bg-cyan-300/10 text-cyan-100" : "text-zinc-600 hover:text-zinc-300"} ${borderless ? "" : "border border-white/[0.06] bg-black/15"}`}
        >
            {label}
        </button>
    )
}
