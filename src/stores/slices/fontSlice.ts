import type { CustomFontEntry } from "../../lib/types.ts"

export const createFontSlice = (set: any) => ({
    customFonts: [] as CustomFontEntry[],
    addCustomFont: (font: CustomFontEntry) =>
        set((state: any) => {
            const existing = state.customFonts.findIndex((item: CustomFontEntry) => item.path === font.path)
            if (existing >= 0) state.customFonts[existing] = font
            else state.customFonts.push(font)
        }),
    removeCustomFont: (id: string) =>
        set((state: any) => {
            state.customFonts = state.customFonts.filter((font: CustomFontEntry) => font.id !== id)
        }),
})
