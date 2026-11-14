import test from 'node:test'
import assert from 'node:assert/strict'
import { generateAutomaticHeatingPlan, type HeatingPlanningSession } from '../src/editor/automatic-heating-plan.ts'
import { HeatingPlanningPaused } from '../src/editor/heating-planning-session.ts'
import type { HeatingPlanningProgress } from '../src/editor/heating-planner-protocol.ts'
import type { Shape } from '../src/editor/model/types.ts'

test('a paused automatic plan retains its completed fields and resumes to a validated result', () => {
  const wall = (id: string, a: number[], b: number[]): Shape => ({ id, kind: 'wall', start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, strokeWidth: 2 })
  const scene: Shape[] = [wall('top', [0, 0], [400, 0]), wall('right', [400, 0], [400, 240]),
    wall('bottom', [400, 240], [0, 240]), wall('left', [0, 240], [0, 0]),
    wall('partition-a', [80, 0], [80, 100]), wall('partition-b', [80, 160], [80, 240]),
    { id: 'door', kind: 'door', start: { x: 80, y: 100 }, end: { x: 80, y: 160 } }]
  const original = structuredClone(scene), session: HeatingPlanningSession = {}
  let paused = false, resumed = false, repeatedFields = false, id = 0
  const budget = { session, pauseOnDeadline: true, routes: 600, deadline: Date.now() + 180000,
    onProgress: (p: HeatingPlanningProgress) => {
      if (!paused && p.phase === 'connections' && session.work?.connectionRefinement?.state.priority?.rootDone === 1) { paused = true; session.work.deadline = 0 }
      if (resumed && p.phase === 'circuits' && p.roomName) repeatedFields = true
      if (resumed && p.phase === 'checks') session.work!.routes = 0 // Stop comparing further valid layouts.
    } }
  const run = () => generateAutomaticHeatingPlan(scene, { x: 40, y: 120 },
    { connectionMode: 'zone', capacity: 3, diameterMm: 16, spacingMm: 100, heatSourceRoom: false,
      design: { maxCircuitLengthM: 60 } }, 100,
    () => `resume-${++id}`, { x: 0, y: 0, width: 500, height: 500 }, 0, 0, budget)
  assert.throws(run, HeatingPlanningPaused)
  const work = session.work, routing = work!.connectionRefinement!.state, fine = routing.fineGrid
  assert.equal(routing.priority!.rootDone, 1, 'the first completed pair remains available during the pause')
  budget.deadline = Date.now() + 180000; resumed = true
  const result = run()
  assert.equal(session.work, work)
  assert.equal(session.work!.connectionRefinement!.state, routing)
  assert.equal(routing.fineGrid, fine, 'the fine routing lattice is retained too')
  assert.equal(repeatedFields, false, 'the completed fields are reused before resuming connections')
  assert.ok(result.rows.length > 0)
  assert.equal(result.shapes.find((shape) => shape.heating?.kind === 'manifold')!.heating!.audit!.errors, 0)
  assert.deepEqual(scene, original)
})
