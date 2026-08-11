import React from "react"

interface ProgressProps {
    value: number
    className?: string
}

export function Progress({ value, className = "" }: ProgressProps) {
    const clampedValue = Math.min(100, Math.max(0, value))

    return (
        <div
            className={`relative h-2 w-full overflow-hidden rounded-sm bg-zinc-800 ${className}`}
            role="progressbar"
            aria-valuenow={clampedValue}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            <div
                className="h-full bg-cyan-400 transition-[width] duration-200 ease-out"
                style={{ width: `${clampedValue}%` }}
            />
        </div>
    )
}
