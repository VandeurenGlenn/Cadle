import { generateAutomaticHeatingPlan } from './automatic-heating-plan.js'
import { HeatingPlanningFailure } from './heating-diagnostics.js'
import type { HeatingPlannerRequest, HeatingPlannerResponse, HeatingPlanningProgress } from './heating-planner-protocol.js'

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<HeatingPlannerRequest>) => void
  postMessage: (message: HeatingPlannerResponse) => void
}
scope.onmessage = ({ data }) => {
  let count = 0, lastTime = 0, lastPhase: HeatingPlanningProgress['phase'] | undefined, lastRoom: string | undefined, lastCompleted = -1, lastAttempt: number | undefined
  const progress = (value: HeatingPlanningProgress) => {
    const now = Date.now()
    if (value.phase !== lastPhase || value.roomName !== lastRoom || value.completedRooms !== lastCompleted || value.attempt !== lastAttempt || now - lastTime >= 100) {
      scope.postMessage({ type: 'progress', progress: value })
      lastTime = now; lastPhase = value.phase; lastRoom = value.roomName; lastCompleted = value.completedRooms; lastAttempt = value.attempt
    }
  }
  try {
    const result = generateAutomaticHeatingPlan(data.scene, data.position, data.settings, data.scale,
      () => `heating-${data.id}-${++count}`, data.pageArea, 0, 0,
      { preserved: data.preserved, existingManifold: data.existingManifold, onlyRoom: data.onlyRoom, routes: 600, deadline: Date.now() + 45000, onProgress: progress })
    scope.postMessage({ type: 'result', result })
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Het legplan kon niet worden berekend.', ...(error instanceof HeatingPlanningFailure ? { diagnostics: error.diagnostics } : {}) })
  }
}
