import { create } from "zustand"
import {
    isActiveBackgroundJob,
    patchBackgroundJob,
    type BackgroundJob,
    type BackgroundJobKind,
    type BackgroundJobPatch,
    type BackgroundJobItemResult,
} from "../lib/backgroundJob.ts"

interface BackgroundJobStore {
    jobs: Partial<Record<BackgroundJobKind, BackgroundJob>>
    startJob: (job: BackgroundJob) => boolean
    updateJob: (kind: BackgroundJobKind, id: string, patch: BackgroundJobPatch) => void
    updateItemResult: (kind: BackgroundJobKind, id: string, itemId: string, result: BackgroundJobItemResult) => void
    requestStop: (kind: BackgroundJobKind, id: string) => void
    clearJob: (kind: BackgroundJobKind, id?: string) => void
}

export const useBackgroundJobStore = create<BackgroundJobStore>((set, get) => ({
    jobs: {},
    startJob: (job) => {
        const jobs = get().jobs
        const sameKind = jobs[job.kind]
        if (isActiveBackgroundJob(sameKind)) return false
        if (job.exclusiveGroup && Object.values(jobs).some((current) =>
            current?.exclusiveGroup === job.exclusiveGroup && isActiveBackgroundJob(current)
        )) return false
        set({ jobs: { ...jobs, [job.kind]: job } })
        return true
    },
    updateJob: (kind, id, patch) => set((state) => {
        const current = state.jobs[kind]
        if (!current || current.id !== id) return state
        return { jobs: { ...state.jobs, [kind]: patchBackgroundJob(current, patch) } }
    }),
    updateItemResult: (kind, id, itemId, result) => set((state) => {
        const current = state.jobs[kind]
        if (!current || current.id !== id) return state
        return {
            jobs: {
                ...state.jobs,
                [kind]: patchBackgroundJob(current, {
                    itemResults: { ...current.itemResults, [itemId]: result },
                }),
            },
        }
    }),
    requestStop: (kind, id) => set((state) => {
        const current = state.jobs[kind]
        if (!current || current.id !== id || !isActiveBackgroundJob(current)) return state
        return {
            jobs: {
                ...state.jobs,
                [kind]: patchBackgroundJob(current, {
                    status: "cancelling",
                    stopRequested: true,
                    message: "現在の処理が終わり次第停止します...",
                }),
            },
        }
    }),
    clearJob: (kind, id) => set((state) => {
        const current = state.jobs[kind]
        if (!current || (id && current.id !== id) || isActiveBackgroundJob(current)) return state
        const jobs = { ...state.jobs }
        delete jobs[kind]
        return { jobs }
    }),
}))

export function hasActiveMediaJob(): boolean {
    const jobs = useBackgroundJobStore.getState().jobs
    return isActiveBackgroundJob(jobs.export) || isActiveBackgroundJob(jobs["creator-batch"])
}
