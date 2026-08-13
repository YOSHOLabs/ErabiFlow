export type ReleaseChannel = "dev" | "beta" | "stable"

function readChannel(value: string | undefined): ReleaseChannel {
    if (value === "beta" || value === "stable") return value
    return "dev"
}

export const releaseChannel = readChannel(import.meta.env.VITE_ERABIFLOW_CHANNEL)
export const updaterEnabled = import.meta.env.VITE_ERABIFLOW_UPDATER_ENABLED === "true"

export const releaseChannelLabel: Record<ReleaseChannel, string> = {
    dev: "Dev",
    beta: "Beta",
    stable: "Public",
}

export function isPreReleaseChannel(channel: ReleaseChannel = releaseChannel): boolean {
    return channel !== "stable"
}
