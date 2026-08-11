/**
 * ControlRow – スライダー + ラベル + 数値表示の共通パターン
 *
 * 反復の原則: 全スライダーコントロールを同一構造に統一。
 * 整列の原則: ラベル(左端)・値(右端)・スライダー(フル幅)を一貫配置。
 */
import { useState, useRef, useEffect, useCallback } from "react"

interface SliderRowProps {
    label: string
    value: number
    min: number
    max: number // 現在はUI上の制限ではなくなるが、直接入力時のバリデーション等に使う
    step?: number
    unit?: string
    display?: string
    accent?: string // (例: "accent-purple-500") -> 今後は bg-purple-500 のように解釈させるか内部でマップする
    onChange: (v: number) => void
}

export function SliderRow({
    label, value, min, max, step = 1, unit = "", display, accent = "bg-purple-500", onChange,
}: SliderRowProps) {
    const [inputValue, setInputValue] = useState(value.toString())
    const inputRef = useRef<HTMLInputElement>(null)

    // 親からの値と同期
    useEffect(() => {
        setInputValue(value.toString())
    }, [value])

    const submitInput = () => {
        const parsed = parseFloat(inputValue)
        if (!isNaN(parsed)) {
            // maxを超えた直接入力は許可してもよいが、一旦制限しない。
            // あるいは min だけでガードする
            onChange(Math.max(min, parsed))
        } else {
            setInputValue(value.toString())
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            inputRef.current?.blur()
        }
        if (e.key === "Escape") {
            setInputValue(value.toString())
            inputRef.current?.blur()
        }
    }

    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-zinc-400">{label}</label>
                <div className="flex items-center gap-1">
                    <input
                        ref={inputRef}
                        type="number"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onBlur={submitInput}
                        onKeyDown={handleKeyDown}
                        className="w-14 h-6 bg-zinc-800 text-zinc-100 text-[11px] font-mono text-right rounded pl-1 pr-1 outline-none border border-zinc-700/50 focus:border-purple-500/50 transition-colors"
                    />
                    {unit && <span className="text-[10px] text-zinc-500 font-mono">{unit}</span>}
                </div>
            </div>
            
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className={`w-full h-1.5 rounded-full appearance-none bg-zinc-700 cursor-pointer ${accent}`}
            />
        </div>
    )
}

interface ToggleRowProps {
    label: string
    description?: string
    checked: boolean
    onChange: (v: boolean) => void
    activeColor?: string   // checked時の色クラス ("green" | "purple" | "blue")
}

/** ON/OFFトグル（スイッチ風） */
export function ToggleRow({ label, description, checked, onChange, activeColor = "purple" }: ToggleRowProps) {
    const track = {
        purple: checked ? "bg-purple-600" : "bg-zinc-700",
        green: checked ? "bg-green-600" : "bg-zinc-700",
        blue: checked ? "bg-blue-600" : "bg-zinc-700",
    }[activeColor] ?? "bg-zinc-700"

    return (
        <button
            type="button"
            onClick={() => onChange(!checked)}
            className="w-full flex items-center justify-between py-2 text-left focus:outline-none group"
        >
            <div>
                <span className="text-[11px] font-medium text-zinc-300">{label}</span>
                {description && (
                    <p className="text-[10px] text-zinc-600 mt-0.5">{description}</p>
                )}
            </div>
            {/* スイッチ */}
            <div className={`relative flex-shrink-0 w-9 h-5 rounded-full transition-colors duration-200 ${track}`}>
                <div className={`
                    absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                    transition-transform duration-200
                    ${checked ? "translate-x-4" : "translate-x-0"}
                `} />
            </div>
        </button>
    )
}

/** セクションヘッダー（反復：全セクションで統一スタイル） */
export function SectionHeader({ children }: { children: React.ReactNode }) {
    return (
        <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest">
            {children}
        </h3>
    )
}
