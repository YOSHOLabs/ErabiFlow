import { FileDropZone } from "@/components/panels/FileDropZone"
import { AudioLines, Download, Scissors, ShieldCheck, Sparkles } from "lucide-react"

const START_STEPS = [
    { icon: Sparkles, number: "01", label: "見どころを見つける", detail: "映像・音声・盛り上がりからKEEP／没を判断" },
    { icon: Scissors, number: "02", label: "ラフカットを決める", detail: "残す区間の端と順番を決め、無駄を削る" },
    { icon: Download, number: "03", label: "受け渡す", detail: "横・縦・任意尺の動画と編集データを出力" },
] as const

export default function EmptyWorkspace() {
    return (
        <div className="custom-scrollbar h-full overflow-y-auto bg-[radial-gradient(circle_at_18%_18%,rgba(34,211,238,0.09),transparent_32%),radial-gradient(circle_at_78%_72%,rgba(139,92,246,0.06),transparent_28%),#090d12] px-8 py-9">
            <div className="mx-auto grid min-h-full max-w-6xl grid-cols-[minmax(0,1fr)_minmax(360px,420px)] items-center gap-16">
                <section className="min-w-0">
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[0.055] px-3 py-1.5 text-[10px] font-semibold text-emerald-200">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        動画は端末の外へ送信しません
                    </div>

                    <h1 className="mt-6 max-w-3xl text-[40px] font-semibold leading-[1.18] tracking-[-0.045em] text-zinc-50">
                        全編を見返さず、<br />残す／削るを決める。
                    </h1>
                    <p className="mt-5 max-w-2xl text-[14px] leading-7 text-zinc-400">
                        横・縦を問わない、ローカル完結のラフカットアシスタントです。
                        AIは完成品を作らず、見どころと盛り上がりの判断材料を出します。最後のKEEP／没はあなたが決めます。
                    </p>

                    <div className="mt-7 flex flex-wrap gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-[10px] text-zinc-400">
                            <AudioLines className="h-3.5 w-3.5 text-cyan-200" />
                            OBSの複数音声トラックに対応
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-[10px] text-zinc-400">
                            <Sparkles className="h-3.5 w-3.5 text-violet-200" />
                            KEEP・没を端末内だけに記録
                        </span>
                    </div>

                    <div className="mt-10 grid max-w-3xl grid-cols-3 gap-3">
                        {START_STEPS.map(({ icon: Icon, number, label, detail }) => (
                            <div key={label} className="rounded-2xl border border-white/[0.075] bg-white/[0.025] p-4 shadow-sm">
                                <div className="flex items-center justify-between">
                                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-300/15 bg-cyan-300/[0.065] text-cyan-200">
                                        <Icon className="h-4 w-4" />
                                    </span>
                                    <span className="font-mono text-[9px] text-zinc-700">{number}</span>
                                </div>
                                <p className="mt-4 text-[12px] font-semibold text-zinc-100">{label}</p>
                                <p className="mt-1.5 text-[10px] leading-5 text-zinc-500">{detail}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="rounded-3xl border border-white/[0.09] bg-[#0e141c]/90 p-5 shadow-2xl shadow-black/30 backdrop-blur">
                    <div className="mb-5 flex items-start justify-between gap-4">
                        <div>
                            <p className="text-[13px] font-semibold text-zinc-100">元の録画を選ぶ</p>
                            <p className="mt-1 text-[10px] leading-5 text-zinc-500">長時間のローカル録画から始められます</p>
                        </div>
                        <span className="rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-2 py-1 text-[9px] font-semibold text-emerald-300">LOCAL</span>
                    </div>
                    <FileDropZone />
                </section>
            </div>
        </div>
    )
}
