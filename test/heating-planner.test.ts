import assert from 'node:assert/strict'
import test from 'node:test'
import { runHeatingPlanner, type HeatingPlannerWorker } from '../src/editor/heating-planner.ts'
import { heatingProgressText, type HeatingPlannerInput, type HeatingPlannerResponse } from '../src/editor/heating-planner-protocol.ts'

const input: HeatingPlannerInput = { scene: [], position: { x: 1, y: 2 }, settings: { diameterMm: 16, spacingMm: 150 }, scale: 100,
  pageArea: { x: 0, y: 0, width: 100, height: 100 } }
const result = { shapes: [], rows: [], tableOnSeparatePage: false, wallCrossings: 0 }
const mockWorker = () => {
  const worker: HeatingPlannerWorker & { terminated: number; messages: unknown[]; emit(data: HeatingPlannerResponse): void } = {
    onmessage: null, onerror: null, onmessageerror: null, terminated: 0, messages: [],
    postMessage(message) { this.messages.push(message) },
    terminate() { this.terminated++ },
    emit(data) { this.onmessage?.({ data } as MessageEvent<HeatingPlannerResponse>) }
  }
  return worker
}

test('passes input and progress to a worker, then releases it after a result', async () => {
  const worker = mockWorker(), progress: string[] = []
  const pending = runHeatingPlanner(input, { createWorker: () => worker, onProgress: (p) => progress.push(p.phase) })
  assert.equal(worker.messages.length, 1)
  assert.deepEqual((worker.messages[0] as HeatingPlannerInput).scene, input.scene)
  worker.emit({ type: 'progress', progress: { phase: 'connections' } })
  worker.emit({ type: 'result', result })
  assert.deepEqual(await pending, result)
  assert.deepEqual(progress, ['connections'])
  assert.equal(worker.terminated, 1)
  assert.equal(worker.onmessage, null)
})

test('cancellation terminates work and ignores a late result', async () => {
  const worker = mockWorker(), controller = new AbortController()
  const pending = runHeatingPlanner(input, { createWorker: () => worker, signal: controller.signal })
  const lateMessage = worker.onmessage!
  controller.abort()
  lateMessage({ data: { type: 'result', result } } as MessageEvent<HeatingPlannerResponse>)
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(worker.terminated, 1)
  assert.equal(worker.onerror, null)
})

test('does not start an already cancelled job', async () => {
  const controller = new AbortController(); controller.abort()
  await assert.rejects(runHeatingPlanner(input, { signal: controller.signal,
    createWorker: () => { throw new Error('must not start') } }), { name: 'AbortError' })
})

test('handles cancellation while starting a worker', async () => {
  const worker = mockWorker(), controller = new AbortController()
  await assert.rejects(runHeatingPlanner(input, { signal: controller.signal,
    createWorker: () => { controller.abort(); return worker } }), { name: 'AbortError' })
  assert.equal(worker.terminated, 1)
  assert.equal(worker.messages.length, 0)
})

test('returns planner failures and shuts down the worker', async () => {
  const worker = mockWorker(), pending = runHeatingPlanner(input, { createWorker: () => worker })
  worker.emit({ type: 'error', message: 'Geen geldige route gevonden.' })
  await assert.rejects(pending, /Geen geldige route/)
  assert.equal(worker.terminated, 1)
})

test('worker startup, communication and time limits reject without a synchronous fallback', async () => {
  for (const kind of ['error', 'messageerror', 'timeout'] as const) {
    const worker = mockWorker(), pending = runHeatingPlanner(input, { createWorker: () => worker, timeoutMs: 5 })
    if (kind === 'error') worker.onerror!({} as ErrorEvent)
    if (kind === 'messageerror') worker.onmessageerror!({} as MessageEvent)
    await assert.rejects(pending, kind === 'timeout' ? /te lang duurde/ : /achtergrondplanner/)
    assert.equal(worker.terminated, 1)
    assert.equal(worker.onmessage, null)
  }
})

test('merge progress names the active room and shows work within that room', () => {
  const message = heatingProgressText({ phase: 'circuits', rooms: 7, completedRooms: 2, roomName: 'Living', remainingFields: 6, routeAttempts: 18, attempt: 3 })
  for (const text of ['2/7', 'Living', '6 deelvlakken', '18 routepogingen', 'indeling 3']) assert.ok(message.includes(text))
})
