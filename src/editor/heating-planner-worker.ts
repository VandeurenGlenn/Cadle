import { HEATING_PLANNING_SLICE_MS, HeatingPlanningPaused } from './heating-planning-session.js'
import { generateAutomaticHeatingPlan, type HeatingPlanningSession } from './automatic-heating-plan.js'
import { HeatingPlanningFailure } from './heating-diagnostics.js'
import type { HeatingPlannerInput, HeatingPlannerRequest, HeatingPlannerResponse, HeatingPlanningProgress } from './heating-planner-protocol.js'

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<HeatingPlannerRequest>) => void
  postMessage: (message: HeatingPlannerResponse) => void
}
let current: (HeatingPlannerInput & { id: string }) | undefined
let session: HeatingPlanningSession = {}, count = 0
scope.onmessage = ({ data: request }) => {
  if (request.type !== 'resume') { current = request; session = {}; count = 0 }
  else if (!current || request.id !== current.id) return
  const data = current!
  let lastTime = 0, lastPhase: HeatingPlanningProgress['phase'] | undefined, lastRoom: string | undefined, lastCompleted = -1, lastPrepared = -1, lastCircuits = -1, lastRoute = -1, lastAttempt: number | undefined
  const progress = (value: HeatingPlanningProgress) => {
    const now = Date.now()
    if (value.phase !== lastPhase || value.roomName !== lastRoom || value.completedRooms !== lastCompleted || value.attempt !== lastAttempt || value.preparedCircuits !== lastPrepared || value.completedCircuits !== lastCircuits || value.routeAttempts !== lastRoute || now - lastTime >= 100) {
      scope.postMessage({ type: 'progress', progress: value })
      lastTime = now; lastPhase = value.phase; lastRoom = value.roomName; lastCompleted = value.completedRooms; lastPrepared = value.preparedCircuits; lastCircuits = value.completedCircuits; lastRoute = value.routeAttempts; lastAttempt = value.attempt
    }
  }
  try {
    const result = generateAutomaticHeatingPlan(data.scene, data.position, data.settings, data.scale,
      () => `heating-${data.id}-${++count}`, data.pageArea, 0, 0,
      { reflowCircuit: data.reflowCircuit, preserved: data.preserved, existingManifold: data.existingManifold, onlyRoom: data.onlyRoom, session, pauseOnDeadline: true, routes: 600, deadline: Date.now() + (request.timeSliceMs ?? HEATING_PLANNING_SLICE_MS), onProgress: progress })
    scope.postMessage({ type: 'result', result })
  } catch (error) {
    if (error instanceof HeatingPlanningPaused) { scope.postMessage({ type: 'paused', message: error.message }); return }
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Het legplan kon niet worden berekend.', ...(error instanceof HeatingPlanningFailure ? { diagnostics: error.diagnostics } : {}) })
  }
}
