import { AnalysisPanel } from "@/features/analysis/AnalysisPanel"
import { PreviewPane } from "./PreviewPane"

export default function DraftWorkspace() {
    return (
        <div
            className="tc-dual-workspace grid h-full min-h-0 grid-cols-[minmax(620px,1.15fr)_minmax(420px,0.85fr)] overflow-hidden bg-[#090d12]"
            data-testid="dual-workspace"
        >
            <section aria-label="AI初稿の作業領域" className="vf-workspace-surface custom-scrollbar min-h-0 overflow-y-auto bg-[#0b1017] px-5 py-5">
                <div className="mx-auto max-w-[1120px]">
                    <AnalysisPanel />
                </div>
            </section>
            <PreviewPane title="候補プレビュー" detail="候補を再生して、使う場面だけ選びます" />
        </div>
    )
}
