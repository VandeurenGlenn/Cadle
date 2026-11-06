import type { AutomaticHeatingResult } from './automatic-heating-plan.js'
import type { HeatingPlannerInput, HeatingPlannerResponse, HeatingPlanningProgress } from './heating-planner-protocol.js'

export type HeatingPlannerWorker = {
  onmessage: ((event: MessageEvent<HeatingPlannerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  postMessage(message: unknown): void
  terminate(): void
}

/** Never run the synchronous solver on the UI thread, including as a fallback. */
export const runHeatingPlanner = (input: HeatingPlannerInput, options: {
  signal?: AbortSignal
  onProgress?: (progress: HeatingPlanningProgress) => void
  createWorker?: () => HeatingPlannerWorker
  timeoutMs?: number
} = {}): Promise<AutomaticHeatingResult> => new Promise((resolve, reject) => {
  const aborted = () => new DOMException('Berekening geannuleerd.', 'AbortError')
  if (options.signal?.aborted) { reject(aborted()); return }
  let worker: HeatingPlannerWorker, timer: ReturnType<typeof setTimeout>, settled = false
  const cleanup = () => {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', cancel)
    if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate() }
  }
  const finish = (error?: Error, result?: AutomaticHeatingResult) => {
    if (settled) return
    settled = true; cleanup()
    if (error) reject(error)
    else resolve(result!)
  }
  const cancel = () => finish(aborted())
  try {
    worker = options.createWorker?.() ?? new Worker(new URL('./heating-planner-worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      if (settled) return
      if (data.type === 'result') finish(undefined, data.result)
      else if (data.type === 'error') finish(new Error(data.message))
      else if (data.type === 'progress') {
        try { options.onProgress?.(data.progress) } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
      }
    }
    worker.onerror = () => finish(new Error('De achtergrondplanner kon niet starten. Herlaad de app en probeer opnieuw.'))
    worker.onmessageerror = () => finish(new Error('Het resultaat van de achtergrondplanner kon niet worden gelezen.'))
    options.signal?.addEventListener('abort', cancel, { once: true })
    if (options.signal?.aborted) { cancel(); return }
    timer = setTimeout(() => finish(new Error('De berekening is gestopt omdat ze te lang duurde. Het bestaande plan is behouden.')), options.timeoutMs ?? 60000)
    worker.postMessage({ ...input, id: crypto.randomUUID() })
  } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
})
