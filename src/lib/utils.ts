import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isTauriEnv(): boolean {
  return (
    typeof window !== "undefined" &&
    (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__)
  )
}
