import { generateAutomaticHeatingPlan } from './automatic-heating-plan.js'
import type { HeatingPlannerRequest, HeatingPlannerResponse, HeatingPlanningProgress } from './heating-planner-protocol.js'

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<HeatingPlannerRequest>) => void
  postMessage: (message: HeatingPlannerResponse) => void
}
scope.onmessage = ({ data }) => {
  let count = 0, lastTime = 0, lastPhase: HeatingPlanningProgress['phase'] | undefined
  const progress = (value: HeatingPlanningProgress) => {
    const now = Date.now()
    if (value.phase !== lastPhase || now - lastTime >= 100) {
      scope.postMessage({ type: 'progress', progress: value })
      lastTime = now; lastPhase = value.phase
    }
  }
  try {
    const result = generateAutomaticHeatingPlan(data.scene, data.position, data.settings, data.scale,
      () => `heating-${data.id}-${++count}`, data.pageArea, 0, 0,
      { routes: 600, deadline: Date.now() + 45000, onProgress: progress })
    scope.postMessage({ type: 'result', result })
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Het legplan kon niet worden berekend.' })
  }
}
