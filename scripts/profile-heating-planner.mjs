// node --expose-gc --import tsx scripts/profile-heating-planner.mjs
// Optional: --scenario=twelve-room-bounded-search --runs=1 --timeout=45000
// A repeatable retained-memory probe, separate from correctness tests. Forced GC
// distinguishes live allocations from heap capacity that V8 keeps for reuse.
import { generateAutomaticHeatingPlan } from '../src/editor/automatic-heating-plan.ts'

if (!global.gc) throw new Error('Run with node --expose-gc --import tsx')
const scene = (count, size, columns) => Array.from({ length: count }, (_, room) => {
  const x = 400 + room % columns * size, y = 400 + Math.floor(room / columns) * size
  const corners = [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }]
  return [...corners.map((start, i) => ({ id: `wall-${room}-${i}`, kind: 'wall', start,
    end: corners[(i + 1) % 4], groupId: `room-${room}`, roomName: `Room ${room + 1}` })),
    { id: `fridge-${room}`, kind: 'symbol', name: 'Refrigerator', path: 'symbols/Consumption appliances/Refrigerator.svg',
      position: { x: x + size / 2, y: y + size / 2 }, scale: 2 }]
}).flat()
const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
const runs = Number(option('runs', '4')), timeout = Number(option('timeout', '0'))
if (!Number.isInteger(runs) || runs < 1 || runs > 20 || !Number.isFinite(timeout) || timeout < 0 || timeout > 60000) throw new Error('Invalid runs/timeout')
const scenarios = [
  { name: 'two-room-success', shapes: scene(2, 320, 2), spacingMm: 200, timeout: 10000 },
  { name: 'twelve-room-bounded-search', shapes: scene(12, 240, 4), spacingMm: 300, timeout: 3000 }
]
const mb = (bytes) => +(bytes / 1048576).toFixed(2)
const samples = []
const collect = () => { global.gc(); global.gc(); return process.memoryUsage() }
for (const scenario of scenarios.filter((value) => !option('scenario', '') || value.name === option('scenario', ''))) {
  // First run warms module/runtime caches; its retained size is the baseline.
  for (let run = 0; run < runs; run++) {
    let id = 0, peak = 0, attempts = 0, outcome = '', circuits = 0
    const start = performance.now()
    try {
      const result = generateAutomaticHeatingPlan(scenario.shapes, { x: 180, y: 280 }, { diameterMm: 16, spacingMm: scenario.spacingMm },
        100, () => `profile-${id++}`, { x: 80, y: 80, width: 2216, height: 1384 }, 0, 0, {
          routes: 600, deadline: Date.now() + (timeout || scenario.timeout),
          onProgress: (p) => { peak = Math.max(peak, process.memoryUsage().heapUsed); attempts = Math.max(attempts, p.attempt ?? 0) }
        })
      circuits = result.rows.length; outcome = 'success'
    } catch (error) { outcome = error.message }
    const elapsedMs = Math.round(performance.now() - start), memory = collect()
    samples.push({ scenario: scenario.name, run, elapsedMs, attempts, circuits, outcome,
      heapMB: mb(memory.heapUsed), arrayBuffersMB: mb(memory.arrayBuffers), sampledPeakHeapMB: mb(peak) })
  }
}
console.log(JSON.stringify(samples, null, 2))
