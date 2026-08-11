import type { CreatorBatchClip } from "../../lib/types.ts"

/** Creator制作キュー。編集内容なのでプロジェクト保存・Undo対象に含める。 */
export const createCreatorSlice = (set: any) => ({
    creatorBatch: [] as CreatorBatchClip[],
    setCreatorBatch: (items: CreatorBatchClip[]) =>
        set((state: any) => {
            state.creatorBatch = items
        }),
    addCreatorBatchClip: (item: CreatorBatchClip) =>
        set((state: any) => {
            if (state.creatorBatch.some((existing: CreatorBatchClip) => existing.id === item.id)) return
            state.creatorBatch.push(item)
        }),
    updateCreatorBatchClip: (id: string, partial: Partial<CreatorBatchClip>) =>
        set((state: any) => {
            const item = state.creatorBatch.find((existing: CreatorBatchClip) => existing.id === id)
            if (item) Object.assign(item, partial)
        }),
    removeCreatorBatchClip: (id: string) =>
        set((state: any) => {
            state.creatorBatch = state.creatorBatch.filter((item: CreatorBatchClip) => item.id !== id)
        }),
    clearCreatorBatch: () =>
        set((state: any) => {
            state.creatorBatch = []
        }),
})
