import { useState } from "react"
import { useDocumentStore } from "@/stores/document"
import { open } from "@tauri-apps/plugin-dialog"
import { readDir } from "@tauri-apps/plugin-fs"
import { convertFileSrc } from "@tauri-apps/api/core"
import { SE_TAG_META, type SeTag, type SeFileEntry } from "@/lib/types"

const TAG_KEYS = Object.keys(SE_TAG_META) as SeTag[]

function FolderIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
    )
}

function PlayIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
    )
}

export function SeLibraryPanel() {
    const seFolderPath = useDocumentStore((s) => s.seFolderPath)
    const setSeFolderPath = useDocumentStore((s) => s.setSeFolderPath)
    const seFileEntries = useDocumentStore((s) => s.seFileEntries)
    const setSeFileEntries = useDocumentStore((s) => s.setSeFileEntries)
    const updateSeFileEntry = useDocumentStore((s) => s.updateSeFileEntry)

    const [isLoading, setIsLoading] = useState(false)
    const [playingId, setPlayingId] = useState<string | null>(null)
    const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null)

    const handleSelectFolder = async () => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: "SE（効果音）フォルダを選択",
            })
            
            if (selected && typeof selected === "string") {
                setIsLoading(true)
                setSeFolderPath(selected)
                
                // Read directory contents
                const entries = await readDir(selected)
                const audioFiles = entries.filter(e => 
                    e.isFile && (e.name.toLowerCase().endsWith(".wav") || e.name.toLowerCase().endsWith(".mp3"))
                )
                
                // Create SeFileEntry objects
                // Keep existing tags if the file was already in the list
                const newEntries: SeFileEntry[] = audioFiles.map((file, i) => {
                    const existing = seFileEntries.find(e => e.fileName === file.name)
                    return {
                        id: `se-file-${i}-${Date.now()}`,
                        path: `${selected}\\${file.name}`,
                        fileName: file.name,
                        tags: existing ? existing.tags : [],
                    }
                })
                
                setSeFileEntries(newEntries)
            }
        } catch (error) {
            console.error("Failed to read folder:", error)
        } finally {
            setIsLoading(false)
        }
    }

    const toggleTag = (entryId: string, tag: SeTag) => {
        const entry = seFileEntries.find(e => e.id === entryId)
        if (!entry) return
        
        const newTags = entry.tags.includes(tag)
            ? entry.tags.filter(t => t !== tag)
            : [...entry.tags, tag]
            
        updateSeFileEntry(entryId, { tags: newTags })
    }

    const playPreview = (entry: SeFileEntry) => {
        if (audioElement) {
            audioElement.pause()
        }
        
        if (playingId === entry.id) {
            setPlayingId(null)
            setAudioElement(null)
            return
        }

        const src = convertFileSrc(entry.path)
        const audio = new Audio(src)
        audio.volume = 0.5
        audio.onended = () => setPlayingId(null)
        audio.play()
        
        setAudioElement(audio)
        setPlayingId(entry.id)
    }

    return (
        <div className="rounded-xl bg-zinc-900/60 border border-zinc-800 p-4 space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <FolderIcon className="w-4 h-4 text-emerald-400" />
                    <span className="text-[12px] font-semibold text-emerald-300 uppercase tracking-wider">
                        SEライブラリ管理
                    </span>
                </div>
                <button
                    onClick={handleSelectFolder}
                    className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 border border-zinc-700 transition-colors"
                >
                    フォルダ選択
                </button>
            </div>

            {seFolderPath && (
                <div className="text-[10px] text-zinc-500 truncate" title={seFolderPath}>
                    参照先: {seFolderPath}
                </div>
            )}

            {isLoading ? (
                <div className="text-center py-4 text-xs text-zinc-500 animate-pulse">
                    読み込み中...
                </div>
            ) : seFileEntries.length > 0 ? (
                <div className="space-y-3 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                    {seFileEntries.map(entry => (
                        <div key={entry.id} className="bg-zinc-800/50 p-3 rounded-lg border border-zinc-700/50">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-zinc-300 truncate max-w-[200px]" title={entry.fileName}>
                                    {entry.fileName}
                                </span>
                                <button 
                                    onClick={() => playPreview(entry)}
                                    className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                                        playingId === entry.id ? 'bg-emerald-500 text-white' : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
                                    }`}
                                >
                                    <PlayIcon className="w-3 h-3 ml-0.5" />
                                </button>
                            </div>
                            
                            <div className="flex flex-wrap gap-1.5">
                                {TAG_KEYS.map(tag => {
                                    const isActive = entry.tags.includes(tag)
                                    const meta = SE_TAG_META[tag]
                                    return (
                                        <button
                                            key={tag}
                                            onClick={() => toggleTag(entry.id, tag)}
                                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-all border ${
                                                isActive 
                                                ? `bg-zinc-700 border-zinc-500 text-zinc-100 shadow-sm` 
                                                : `bg-zinc-900/50 border-zinc-800 text-zinc-500 hover:bg-zinc-800`
                                            }`}
                                            title={meta.label}
                                        >
                                            <img src={meta.iconPath} alt={meta.label} className={`w-3.5 h-3.5 object-contain ${isActive ? '' : 'opacity-50 grayscale'}`} />
                                            {meta.label}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-center py-8 text-xs text-zinc-500 border border-dashed border-zinc-700 rounded-lg bg-zinc-800/20">
                    {seFolderPath ? "音声ファイルが見つかりません" : "SEフォルダを選択してください"}
                </div>
            )}
        </div>
    )
}
