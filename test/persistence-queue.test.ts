import assert from 'node:assert/strict'
import test from 'node:test'
import { PersistenceQueue } from '../src/editor/controllers/persistence-queue.ts'

test('persistence queue runs writes in enqueue order', async () => {
  const queue = new PersistenceQueue()
  const writes: string[] = []
  let releaseFirst: (() => void) | undefined

  void queue.enqueue(
    () =>
      new Promise<void>((resolve) => {
        releaseFirst = () => {
          writes.push('first')
          resolve()
        }
      })
  )
  void queue.enqueue(async () => {
    writes.push('second')
  })

  await Promise.resolve()
  assert.deepEqual(writes, [])
  releaseFirst?.()
  await queue.flush()
  assert.deepEqual(writes, ['first', 'second'])
})

test('persistence queue reports the latest failure and accepts later writes', async () => {
  const queue = new PersistenceQueue()
  const failure = new Error('write failed')

  void queue.enqueue(async () => {
    throw failure
  })
  await assert.rejects(queue.flush(), failure)

  let recovered = false
  void queue.enqueue(async () => {
    recovered = true
  })
  await queue.flush()
  assert.equal(recovered, true)
})
