import test from "node:test"
import assert from "node:assert/strict"
import { createSerialTaskQueue } from "./serialTaskQueue.ts"

test("追記・削除・次の追記を呼出順に直列化する", async () => {
    const queue = createSerialTaskQueue()
    const order: string[] = []
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })

    const first = queue.enqueue(async () => {
        order.push("append:start")
        await firstGate
        order.push("append:end")
    })
    const clear = queue.enqueue(async () => { order.push("clear") })
    const next = queue.enqueue(async () => { order.push("append:next") })

    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(order, ["append:start"])
    releaseFirst?.()
    await Promise.all([first, clear, next])
    assert.deepEqual(order, ["append:start", "append:end", "clear", "append:next"])
})

test("失敗した操作の後も次の操作を実行する", async () => {
    const queue = createSerialTaskQueue()
    await assert.rejects(queue.enqueue(async () => { throw new Error("failed") }))
    await assert.doesNotReject(queue.enqueue(async () => "ok"))
})
