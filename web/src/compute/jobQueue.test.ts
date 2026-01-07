import { describe, expect, it } from 'vitest'
import { JobQueue } from './jobQueue'

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

describe('JobQueue', () => {
  it('runs jobs in order', async () => {
    const queue = new JobQueue()
    const events: string[] = []

    const first = queue.enqueue('first', async () => {
      events.push('start-1')
      await delay(5)
      events.push('end-1')
      return 1
    })
    const second = queue.enqueue('second', async () => {
      events.push('start-2')
      return 2
    })

    const values = await Promise.all([first.promise, second.promise])
    expect(values).toEqual([1, 2])
    expect(events).toEqual(['start-1', 'end-1', 'start-2'])
  })

  it('supports cancellation before execution', async () => {
    const queue = new JobQueue()
    const job = queue.enqueue('cancelled', async () => {
      await delay(5)
      return 1
    })
    job.cancel()

    await expect(job.promise).rejects.toThrow(/cancelled/i)
  })
})
