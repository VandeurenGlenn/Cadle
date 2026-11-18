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

test('persistence queue exposes failures immediately and retries failed and later writes in order', async () => {
  const states: string[] = []
  const queue = new PersistenceQueue((state) => states.push(state.status))
  const failure = new Error('write failed')
  let fails = true
  const writes: string[] = []

  void queue.enqueue(async () => {
    if (fails) throw failure
    writes.push('first')
  })
  await assert.rejects(queue.flush(), failure)
  assert.deepEqual(states, ['saving', 'error'])

  void queue.enqueue(async () => {
    writes.push('second')
  })
  await assert.rejects(queue.flush(), failure)
  assert.deepEqual(writes, [])
  fails = false
  await queue.retry()
  assert.deepEqual(writes, ['first', 'second'])
  assert.deepEqual(states, ['saving', 'error', 'saving', 'saved'])
})

test('persistence queue never announces saved while a later write is pending', async () => {
  const states: string[] = []
  const queue = new PersistenceQueue((state) => states.push(state.status))
  let release: () => void = () => {}
  void queue.enqueue(async () => {})
  void queue.enqueue(() => new Promise<void>((resolve) => { release = resolve }))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(states, ['saving'])
  release()
  await queue.flush()
  assert.deepEqual(states, ['saving', 'saved'])
})
