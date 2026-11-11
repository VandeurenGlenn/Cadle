// Read-only reproduction of a heating failure. No drawing is changed.
// node --import tsx scripts/diagnose-heating-planner.mjs --input=/path/plan.json --source=744,592
// --manual-only inspects saved zones without starting autoplan; --force bypasses the report cache.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, renameSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { generateAutomaticHeatingPlan } from '../src/editor/automatic-heating-plan.ts'
import { heatingLayout } from '../src/editor/heating-plan.ts'
import { heatingObstacleBounds } from '../src/editor/heating-openings.ts'
import { sanitizeShapes, shapeBounds } from '../src/editor/model/model.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const input = resolve(option('input', join(root, 'test/fixtures/heating-cadle-project.json')))
const output = resolve(option('output', join(tmpdir(), 'cadle-heating-diagnostic.json')))
const inputStat = statSync(input), outputStat = existsSync(output) ? statSync(output) : undefined
if (input === output || outputStat && inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino) {
  throw new Error('The report must not overwrite the drawing.')
}
const position = option('source', '744,592').split(',').map(Number)
const timeout = Number(option('timeout', '30000'))
if (position.length !== 2 || !position.every(Number.isFinite) || !Number.isFinite(timeout) || timeout < 1 || timeout > 60000) {
  throw new Error('Use --source=x,y and --timeout=1..60000 (milliseconds).')
}
const mode = process.argv.includes('--manual-only') ? 'manual' : 'all'
const source = { x: position[0], y: position[1] }
const bytes = readFileSync(input), document = JSON.parse(bytes), shapes = sanitizeShapes(document.shapes ?? document)
const scale = document.drawingScale ?? 100
const settings = { connectionMode: 'zone', diameterMm: 16, spacingMm: 100, capacity: 12, shareSmallRooms: true, heatSourceRoom: false }
const hash = createHash('sha256').update(bytes).update(JSON.stringify({ scale, settings, source, timeout, mode }))
// Include dependencies as well as the planner. A geometry/model or lockfile
// change invalidates the cache; unchanged investigations reuse their evidence.
const fingerprint = (folder) => {
  for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) fingerprint(path)
    else if (entry.name.endsWith('.ts')) hash.update(path.slice(root.length)).update(readFileSync(path))
  }
}
fingerprint(join(root, 'src'))
hash.update(readFileSync(join(root, 'package-lock.json'))).update(readFileSync(fileURLToPath(import.meta.url)))
const key = hash.digest('hex')
const summary = (report, cached = false) => console.log(JSON.stringify({ output, cached, manual: report.manual,
  automatic: report.automatic, observations: report.observations }, null, 2))
if (!process.argv.includes('--force') && existsSync(output)) {
  let cached
  try { cached = JSON.parse(readFileSync(output, 'utf8')) } catch { /* An interrupted report is a cache miss. */ }
  if (cached?.fingerprint === key) { summary(cached, true); process.exit(0) }
}
const obstacles = heatingObstacleBounds(shapes, shapeBounds)
const report = { fingerprint: key, input, recordedAt: new Date().toISOString(), source, scale, settings, timeout,
  manual: [], automatic: { status: 'not-run' }, progress: [], observations: {
    obstacleFootprints: obstacles.length,
    unmarkedRectangles: shapes.filter((s) => s.kind === 'rect' && !s.heating && !s.locked && s.heatingObstacle === undefined).map((s) => s.id)
  } }
for (const zone of shapes.filter((s) => s.kind === 'rect' && s.heating?.kind === 'zone')) {
  const start = performance.now(), layout = heatingLayout(zone, obstacles)
  report.manual.push({ id: zone.id, requested: zone.heating.circuits, produced: layout.circuits.length,
    spacingMm: zone.heating.spacingMm, lengthM: layout.lengthM, warning: layout.warning, elapsedMs: Math.round(performance.now() - start) })
}
if (mode === 'all') {
  let id = 0, last = '', lastFailure
  const start = performance.now()
  try {
    const result = generateAutomaticHeatingPlan(shapes, source, settings, scale, () => `diagnostic-${id++}`,
      { x: 80, y: 80, width: (document.worldWidth ?? 2376) - 160, height: (document.worldHeight ?? 1680) - 160 }, 0, 0,
      { routes: 600, deadline: Date.now() + timeout,
        onProgress(progress) {
          const key = JSON.stringify([progress.phase, progress.attempt, progress.roomName, progress.completedRooms])
          if (key === last) return
          last = key; report.progress.push({ elapsedMs: Math.round(performance.now() - start), ...progress })
        }, onRouteFailure(reason, point, detail) { lastFailure = { reason, point, detail } } })
    report.automatic = { status: 'success', elapsedMs: Math.round(performance.now() - start), rows: result.rows,
      audit: result.shapes.find((s) => s.heating?.kind === 'manifold')?.heating?.audit, wallCrossings: result.wallCrossings }
  } catch (error) {
    report.automatic = { status: 'failure', elapsedMs: Math.round(performance.now() - start), message: error.message,
      diagnostics: error.diagnostics, lastFailure }
  }
}
const temporary = `${output}.${process.pid}.tmp`
writeFileSync(temporary, JSON.stringify(report, null, 2))
renameSync(temporary, output)
summary(report)
