import { useEffect, useMemo, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { Plus, Trash2 } from "lucide-react"
import { FONT_OPTIONS } from "@/lib/constants"
import { useDocumentStore } from "@/stores/document"
import { commands, type FontDescriptor } from "@/tauri/commands"

interface FontPickerProps {
    value: string
    onChange: (fontReference: string) => void
}

function inTauri() {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

export function FontPicker({ value, onChange }: FontPickerProps) {
    const customFonts = useDocumentStore((state) => state.customFonts)
    const addCustomFont = useDocumentStore((state) => state.addCustomFont)
    const removeCustomFont = useDocumentStore((state) => state.removeCustomFont)
    const [systemFonts, setSystemFonts] = useState<FontDescriptor[]>([])
    const [error, setError] = useState("")
    const [isAdding, setIsAdding] = useState(false)

    useEffect(() => {
        if (!inTauri()) return
        commands.listSystemFonts()
            .then(setSystemFonts)
            .catch((cause) => console.warn("System font listing failed", cause))
    }, [])

    const options = useMemo(() => {
        const systems = systemFonts.length > 0
            ? systemFonts.map((font) => ({ value: font.reference, label: font.label, supportsJapanese: font.supportsJapanese }))
            : FONT_OPTIONS.map((font) => ({ ...font, supportsJapanese: font.value.includes("meiryo") || font.value.includes("yu-gothic") }))
        const customs = customFonts.map((font) => ({
            value: font.reference,
            label: font.label,
            supportsJapanese: font.supportsJapanese,
        }))
        const result = [...systems, ...customs]
        if (value && !result.some((font) => font.value === value)) {
            result.push({ value, label: value.split(/[\\/]/).pop() || value, supportsJapanese: false })
        }
        return result
    }, [customFonts, systemFonts, value])

    const selectedCustom = customFonts.find((font) => font.reference === value)
    const selectedOption = options.find((font) => font.value === value)

    const handleAdd = async () => {
        setError("")
        try {
            const selected = await open({
                multiple: false,
                filters: [{ name: "Font", extensions: ["ttf", "otf", "ttc"] }],
            })
            if (!selected) return
            setIsAdding(true)
            const imported = await commands.importFontFile({ fontPath: selected as string })
            const entry = {
                id: crypto.randomUUID(),
                reference: imported.reference,
                path: imported.path,
                label: imported.label,
                family: imported.family,
                supportsJapanese: imported.supportsJapanese,
            }
            addCustomFont(entry)
            onChange(entry.reference)
        } catch (cause) {
            setError(String(cause))
        } finally {
            setIsAdding(false)
        }
    }

    return (
        <div className="space-y-2">
            <div className="flex gap-2">
                <select
                    aria-label="フォント"
                    className="min-w-0 flex-1 rounded-lg border border-zinc-700/40 bg-zinc-800/60 px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-purple-600/40"
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                >
                    {options.map((font) => (
                        <option key={font.value} value={font.value}>
                            {font.label}{font.supportsJapanese ? " · 日本語" : ""}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={handleAdd}
                    disabled={isAdding || !inTauri()}
                    className="inline-flex flex-none items-center gap-1.5 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.07] px-2.5 text-[10px] font-medium text-cyan-200 transition hover:bg-cyan-400/10 disabled:opacity-40"
                    title="所有しているTTF・OTF・TTCを追加"
                >
                    <Plus className="h-3.5 w-3.5" />
                    {isAdding ? "追加中" : "追加"}
                </button>
            </div>
            <div className="flex min-h-4 items-start justify-between gap-2 text-[9px] leading-relaxed">
                <span className={error ? "text-red-400" : "text-zinc-600"}>
                    {error || (!selectedOption?.supportsJapanese
                        ? "日本語を含む場合は、表示と書き出しの両方で日本語対応フォントへ自動フォールバックします。"
                        : "プレビューと書き出しで同じフォントファイルを使用します。")}
                </span>
                {selectedCustom && (
                    <button
                        type="button"
                        onClick={() => {
                            removeCustomFont(selectedCustom.id)
                            onChange("system:meiryo-bold")
                        }}
                        className="inline-flex flex-none items-center gap-1 text-zinc-600 hover:text-red-300"
                        title="このプロジェクトのフォント一覧から外す"
                    >
                        <Trash2 className="h-3 w-3" />
                        外す
                    </button>
                )}
            </div>
        </div>
    )
}
