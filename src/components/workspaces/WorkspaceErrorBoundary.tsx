import { Component, type ErrorInfo, type ReactNode } from "react"

interface WorkspaceErrorBoundaryProps {
    children: ReactNode
    resetKey: string
}

interface WorkspaceErrorBoundaryState {
    error: Error | null
}

export class WorkspaceErrorBoundary extends Component<
    WorkspaceErrorBoundaryProps,
    WorkspaceErrorBoundaryState
> {
    state: WorkspaceErrorBoundaryState = { error: null }

    static getDerivedStateFromError(error: Error): WorkspaceErrorBoundaryState {
        return { error }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("Workspace failed to load:", error, info.componentStack)
    }

    componentDidUpdate(previous: WorkspaceErrorBoundaryProps) {
        if (previous.resetKey !== this.props.resetKey && this.state.error) {
            this.setState({ error: null })
        }
    }

    render() {
        if (!this.state.error) return this.props.children

        return (
            <div role="alert" className="flex h-full items-center justify-center bg-[#101216] px-6">
                <div className="max-w-sm border border-red-300/15 bg-red-300/[0.035] p-5 text-center">
                    <p className="text-[12px] font-semibold text-red-100">工程画面を読み込めませんでした</p>
                    <p className="mt-2 text-[10px] leading-5 text-zinc-500">
                        一時的な読み込み失敗の可能性があります。アプリを再読み込みしてください。
                    </p>
                    <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="mt-4 h-9 border border-red-200/20 bg-red-200 px-4 text-[11px] font-semibold text-red-950 hover:bg-red-100"
                    >
                        再読み込み
                    </button>
                </div>
            </div>
        )
    }
}
