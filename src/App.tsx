import { useEffect } from "react"
import { VideoProcessor } from "@/components/VideoProcessor"
import { ProjectControls } from "@/components/panels/ProjectControls"
import { DevPlanSwitcher } from "@/components/DevPlanSwitcher"
import { PlanStatusButton } from "@/components/PlanStatusButton"
import { ProjectRecovery } from "@/components/ProjectRecovery"
import { useSettingsPersistence } from "@/hooks/useSettingsPersistence"
import { useDocumentStore } from "@/stores/document"
import { useEntitlementStore } from "@/stores/entitlement"
import { hasCapability } from "@/lib/entitlements"
import { useEditorShortcuts } from "@/hooks/useEditorShortcuts"
import { useFfmpegRuntime } from "@/hooks/useFfmpegRuntime"
import { FfmpegRuntimeSetupOverlay } from "@/features/setup/FfmpegRuntimeSetupOverlay"
import { AppUpdateButton } from "@/features/update/AppUpdateButton"
import { ShieldCheck } from "lucide-react"

export default function App() {
  useSettingsPersistence()
  useEditorShortcuts()
  const ffmpegRuntime = useFfmpegRuntime()
  const inputPath = useDocumentStore((state) => state.inputPath)
  const enableAutoReframe = useDocumentStore((state) => state.processing.enableAutoReframe)
  const enableJumpCut = useDocumentStore((state) => state.processing.enableJumpCut)
  const duckingEnabled = useDocumentStore((state) => state.ducking.enabled)
  const setProcessing = useDocumentStore((state) => state.setProcessing)
  const setDucking = useDocumentStore((state) => state.setDucking)
  const plan = useEntitlementStore((state) => state.plan)
  const entitlementStatus = useEntitlementStore((state) => state.status)
  const hydrateEntitlement = useEntitlementStore((state) => state.hydrate)
  const projectName = inputPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "新規プロジェクト"

  useEffect(() => {
    void hydrateEntitlement()
  }, [hydrateEntitlement])

  // CreatorプロジェクトをFreeで開いた場合も、有料機能が書き出しへ残らないようにする。
  useEffect(() => {
    if (entitlementStatus === "loading") return
    if (enableAutoReframe && !hasCapability(plan, "ai.autoReframe")) {
      setProcessing({ enableAutoReframe: false })
    }
    if (enableJumpCut && !hasCapability(plan, "ai.silenceCut")) {
      setProcessing({ enableJumpCut: false })
    }
    if (duckingEnabled && !hasCapability(plan, "ai.audioDucking")) {
      setDucking({ enabled: false })
    }
  }, [duckingEnabled, enableAutoReframe, enableJumpCut, entitlementStatus, plan, setDucking, setProcessing])

  return (
    <div className="vf-product-ui flex h-screen w-screen select-none flex-col overflow-hidden bg-[#080b10] text-zinc-300 antialiased">
      <header className="tc-app-header flex h-[52px] flex-none items-center justify-between border-b border-white/[0.08] bg-[#090d13] px-3.5 shadow-[0_1px_0_rgba(0,0,0,0.5)]">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex flex-none items-center gap-2.5">
            <img
              src="/brand/tateclip-icon.png"
              alt=""
              className="h-7 w-7 rounded-lg border border-cyan-200/15 object-cover shadow-[0_0_18px_rgba(34,211,238,0.08)]"
            />
            <div>
              <span className="block text-[13px] font-semibold tracking-[-0.015em] text-zinc-50">TateClip</span>
              <span className="block text-[8px] font-semibold tracking-[0.12em] text-zinc-600">AI ROUGH CUT ASSISTANT</span>
            </div>
          </div>
          <span className="h-6 w-px bg-white/[0.07]" />
          <div className="tc-project-identity min-w-0 overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 py-1">
            <span className="mr-2 text-[8px] font-semibold uppercase tracking-[0.1em] text-zinc-600">Project</span>
            <span className="inline-block max-w-52 truncate align-middle text-[11px] font-medium text-zinc-300">{projectName}</span>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <div className="tc-runtime-status hidden h-8 items-center gap-2 rounded-lg border border-emerald-300/10 bg-emerald-300/[0.035] px-2.5 xl:flex" title="動画・音声・字幕は端末内で処理します">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
            <span className="text-[9px] font-semibold tracking-[0.08em] text-emerald-200/70">端末内処理</span>
          </div>
          <div className="flex h-9 items-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] px-1">
            <AppUpdateButton />
            <DevPlanSwitcher />
            <PlanStatusButton />
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
            <ProjectControls />
          </div>
        </div>
      </header>

      <ProjectRecovery />
      <FfmpegRuntimeSetupOverlay runtime={ffmpegRuntime} />

      <main className="min-h-0 flex-1 overflow-hidden text-sm">
        <VideoProcessor />
      </main>
    </div>
  )
}
