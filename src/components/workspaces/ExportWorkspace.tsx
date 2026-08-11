import { ExportInspector } from "@/components/panels/ExportInspector"
import { PreviewPane } from "./PreviewPane"

export default function ExportWorkspace() {
    return (
        <div
            className="tc-dual-workspace grid h-full min-h-0 grid-cols-[minmax(560px,1fr)_minmax(380px,36%)] overflow-hidden bg-[#090d12]"
            data-testid="dual-workspace"
        >
            <section aria-label="出力の作業領域" className="vf-workspace-surface custom-scrollbar min-h-0 overflow-y-auto bg-[#0b1017] px-5 py-5">
                <div className="mx-auto max-w-4xl space-y-4">
                    <ExportInspector />
                </div>
            </section>
            <PreviewPane title="ラフカット確認" detail="受け渡す内容と尺を確認" />
        </div>
    )
}
