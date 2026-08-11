import { useEffect } from "react"
import { createAnalysisJob } from "@/lib/analysisJob"
import { createBackgroundJob } from "@/lib/backgroundJob"
import { useBackgroundJobStore } from "@/stores/backgroundJobs"
import { useDocumentStore } from "@/stores/document"
import { useEditorStore } from "@/stores/editor"

export function useDemoProject() {
    useEffect(() => {
        const isLocalPreview = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"
        const demoVariant = new URLSearchParams(window.location.search).get("demo")
        if (!isLocalPreview || !demoVariant) return
        const portraitDemo = demoVariant === "portrait"
        const sourcePath = portraitDemo ? "C:\\VFocusDemo\\portrait-session.mp4" : "C:\\VFocusDemo\\game-commentary.mp4"
        const sourceVideoInfo = portraitDemo
            ? { duration: 184.2, width: 1080, height: 1920, fps: 30 }
            : { duration: 184.2, width: 1920, height: 1080, fps: 60 }

        const store = useDocumentStore.getState()
        if (!store.inputPath) {
            store.setInputPath(sourcePath)
        }
        store.setVideoInfo(sourceVideoInfo)
        store.addMediaAssets([{
            id: "demo-media-video",
            kind: "video",
            path: sourcePath,
            name: sourcePath.split(/\\/).pop() ?? "demo.mp4",
            folderId: null,
            favorite: false,
            addedAt: "2026-07-11T00:00:00.000Z",
            duration: 184.2,
            width: sourceVideoInfo.width,
            height: sourceVideoInfo.height,
            fps: sourceVideoInfo.fps,
        }])
        store.setTimelineClips(demoVariant === "review" || demoVariant === "saved-review" ? [
            { id: "demo-source", mediaStart: 0, mediaEnd: 184.2, label: "元動画" },
        ] : [
            { id: "demo-clip-1", mediaStart: 14.2, mediaEnd: 42.8, label: "オープニング" },
            { id: "demo-clip-2", mediaStart: 76.4, mediaEnd: 108.9, label: "クラッチシーン" },
            { id: "demo-clip-3", mediaStart: 142.1, mediaEnd: 168.5, label: "リアクション" },
        ])

        const demoSubtitles = [
            { id: "demo-sub-1", text: "これ、勝てるかもしれない", start: 18.4, end: 21.2 },
            { id: "demo-sub-2", text: "一人ずつ、落ち着いていこう", start: 81.1, end: 84.4 },
        ]
        const demoCuts = [
            {
                start: 76.4,
                end: 108.9,
                label: "逆転クラッチ",
                reason: "声量とゲーム音が同時に上がり、展開が大きく動いています。",
                excitement: 92,
                scoreDetails: { event: 93, reaction: 89, clipability: 91, confidence: 0.92 },
                category: "victory",
                falsePositiveRisk: 0.08,
                durationVariants: {
                    "15": { start: 82.1, end: 97.1 },
                    "30": { start: 76.4, end: 106.4 },
                    "60": { start: 54.9, end: 114.9 },
                },
            },
            {
                start: 142.1,
                end: 168.5,
                label: "勝利リアクション",
                reason: "結果が伝わりやすく、短尺の締めに向いています。",
                excitement: 84,
                scoreDetails: { event: 75, reaction: 94, clipability: 87, confidence: 0.86 },
                category: "reaction",
                falsePositiveRisk: 0.14,
                durationVariants: {
                    "15": { start: 148.1, end: 163.1 },
                    "30": { start: 140.2, end: 170.2 },
                    "60": { start: 124.2, end: 184.2 },
                },
            },
            {
                start: 14.2,
                end: 31.8,
                label: "冒頭の作戦共有",
                reason: "展開の前提が短く伝わります。",
                excitement: 78,
            },
            {
                start: 42.0,
                end: 58.4,
                label: "危機回避",
                reason: "状況変化と反応が重なっています。",
                excitement: 72,
            },
            {
                start: 112.3,
                end: 129.7,
                label: "終盤への切り返し",
                reason: "次の展開につながる判断が含まれます。",
                excitement: 66,
            },
            {
                start: 168.5,
                end: 182.4,
                label: "追加の締め候補",
                reason: "Creator向けの追加候補です。",
                excitement: 60,
                isProRequired: true,
            },
        ]

        store.setSubtitles(demoSubtitles)
        store.setText({ content: "この判断、正しい？", startTime: 0, endTime: 3 })
        store.setSubtitleStyle({ positionY: 0.72, emphasisMode: "karaoke", emphasisColor: "#FDE047" })
        store.setPublishing({
            platform: "tiktok",
            template: "payoff-first",
            caption: "絶体絶命から逆転したクラッチ。",
            hashtags: "ゲーム実況 クラッチ",
            cta: "あなたならこの場面、どう動く？",
            coverTime: 34.2,
        })
        store.setRecommendedCuts(demoCuts)
        store.setExcitementGraph(Array.from({ length: 185 }, (_, second) =>
            second >= 76 && second <= 108 ? 82 : second >= 142 && second <= 168 ? 72 : 18
        ))
        const signalWarnings = demoVariant === "analysis-warning"
            ? ["映像信号を取得できませんでした（RuntimeError）"]
            : []
        store.setAnalysisArtifact({
            id: "demo-analysis",
            sourcePath,
            mode: "fast",
            createdAt: "2026-07-11T00:00:00.000Z",
            transcriptText: demoSubtitles.map((subtitle) => subtitle.text).join(" "),
            highlights: demoCuts,
            subtitles: demoSubtitles,
            excitementGraph: [],
            trackInfo: null,
            stats: null,
            signalSummary: {
                perceptualLoudness: true,
                visualChange: signalWarnings.length === 0,
                candidateStrategy: "legacy",
                warnings: signalWarnings,
            },
            warnings: signalWarnings,
            gameContext: null,
        })

        if (demoVariant === "saved-review") {
            store.rejectHighlightCandidate(0)
            store.clearAnalysisArtifacts()
        }

        if (demoVariant === "analysis-progress") {
            store.startAnalysisJob(createAnalysisJob({
                id: "demo-running-analysis",
                sourcePath: "C:\\VFocusDemo\\game-commentary.mp4",
                mode: "fast",
                params: { demo: true },
                now: "2026-07-20T00:00:00.000Z",
            }))
            store.updateActiveAnalysisJobProgress({
                progress: 0.42,
                message: "字幕起こし: チャンク 3/8 を処理中",
            })
        }

        if (demoVariant === "export-complete") {
            store.setProcessing({
                isProcessing: false,
                phase: "complete",
                progress: 100,
                phaseMessage: "完了",
                status: "処理完了 → game-commentary_tateclip.mp4",
                lastOutputPath: "C:\\VFocusDemo\\game-commentary_tateclip.mp4",
                lastError: null,
                lastStartedAt: "2026-07-18T00:00:00.000Z",
                lastFinishedAt: "2026-07-18T00:00:12.000Z",
            })
        }

        if (demoVariant === "export-progress") {
            const job = createBackgroundJob({
                kind: "export",
                label: "動画書き出し",
                blocksProjectChange: true,
                exclusiveGroup: "media-processing",
                makeId: () => "demo-export-progress",
                now: () => "2026-07-18T00:00:00.000Z",
            })
            const backgroundJobs = useBackgroundJobStore.getState()
            backgroundJobs.startJob(job)
            backgroundJobs.updateJob("export", job.id, {
                phase: "encoding",
                progress: 48,
                message: "書き出し中...",
            })
            store.setProcessing({
                isProcessing: true,
                phase: "encoding",
                progress: 48,
                phaseMessage: "書き出し中...",
                status: "",
                lastError: null,
                lastOutputPath: null,
                lastStartedAt: "2026-07-18T00:00:00.000Z",
                lastFinishedAt: null,
            })
        }

        if (new URLSearchParams(window.location.search).has("demoBgmLifecycle")) {
            useEditorStore.getState().setVolume(0.25)
            store.setBgmVolume(0.4)
            const timer = window.setTimeout(() => {
                useDocumentStore.getState().setBgmPath("C:\\VFocusDemo\\bgm.mp3")
            }, 50)
            return () => window.clearTimeout(timer)
        }
    }, [])
}
