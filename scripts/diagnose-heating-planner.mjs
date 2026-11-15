// Read-only reproduction of a heating failure. No drawing is changed.
// node --import tsx scripts/diagnose-heating-planner.mjs --input=/path/plan.json --source=744,592
// --manual-only inspects saved zones without starting autoplan; --force bypasses the report cache.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, renameSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { HeatingPlanningPaused } from '../src/editor/heating-planning-session.ts'
import { generateAutomaticHeatingPlan } from '../src/editor/automatic-heating-plan.ts'
import { heatingLayout } from '../src/editor/heating-plan.ts'
import { heatingObstacleBounds } from '../src/editor/heating-openings.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { heatingConnectionEntryKey } from '../src/editor/heating-connection-refinement.ts'
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
const timeout = Number(option('timeout', '180000')), slices = Number(option('slices', '1'))
if (!Number.isInteger(slices) || slices < 1 || slices > 8) throw new Error('Use --slices=1..8 for resumable planning intervals.')
if (position.length !== 2 || !position.every(Number.isFinite) || !Number.isFinite(timeout) || timeout < 1 || timeout > 600000) {
  throw new Error('Use --source=x,y and --timeout=1..600000 (milliseconds).')
}
const mode = process.argv.includes('--manual-only') ? 'manual' : process.argv.includes('--capture-feeds') ? 'capture-feeds' : process.argv.includes('--capture-only') ? 'capture' : 'all'
const captureBundle = process.argv.includes('--capture-bundle') || mode === 'capture' || mode === 'capture-feeds'
const source = { x: position[0], y: position[1] }
const resumePath = option('resume-routing', '')
const resume = resumePath ? JSON.parse(readFileSync(resumePath, 'utf8')) : undefined
const warmPath = option('warm-routing', '')
const warmBytes = warmPath ? readFileSync(warmPath) : undefined
const warm = warmBytes ? JSON.parse(warmBytes) : undefined
const resumeBundlePath = option('resume-bundle', '')
const resumeBundle = resume ? resume.bundle ?? JSON.parse(readFileSync(resumeBundlePath || resumePath.replace(/\.routing-checkpoint\.json$/, '.bundle.json'), 'utf8')) : undefined
if (resume && resume.fingerprint !== resumeBundle.fingerprint && !resumeBundlePath) throw new Error('The routing checkpoint and its bundle do not match.')
if (resume && JSON.stringify(resumeBundle.coils.map((coil) => heatingPipeGeometry(coil).points)) !== resume.key) throw new Error('The routing bundle has been overwritten by a later layout. Use the matching --resume-bundle file.')
const entryVariants = resume?.entryVariants ?? option('entry-variants', '').split(',').filter(Boolean).map((value) => {
  const [room, variant] = value.split(':')
  if (!room || !Number.isInteger(Number(variant)) || Number(variant) < 0) throw new Error('Use --entry-variants=region-7:1,region-3:2')
  return [room, Number(variant)]
})
const allocationVariant = Number(option('allocation-variant', resume?.allocationVariant ?? '0'))
if (!Number.isInteger(allocationVariant) || allocationVariant < 0) throw new Error('Use a non-negative --allocation-variant integer.')
const roomTargets = option('room-targets', '').split(',').filter(Boolean).map((value) => {
  const [room, count] = value.split(':')
  if (!room || !Number.isInteger(Number(count)) || Number(count) < 1 || Number(count) > 24)
    throw new Error('Use --room-targets=region-2:6,region-3:3,region-7:3')
  return [room, Number(count)]
})
const bytes = readFileSync(input), document = JSON.parse(bytes), shapes = sanitizeShapes(document.shapes ?? document)
const scale = document.drawingScale ?? 100
const settings = { connectionMode: 'zone', diameterMm: 16, spacingMm: 100, capacity: Number(option('capacity', '12')),
  shareSmallRooms: true, heatSourceRoom: false, allowExtraCircuit: process.argv.includes('--extra'), allowLongerCircuits: process.argv.includes('--longer'),
  ...(option('exclude-rooms', '') ? { excludedRoomKeys: option('exclude-rooms', '').split(',') } : {}),
  allowWallPassages: !process.argv.includes('--doors-only'), ...(option('max-length', '') ? { design: { maxCircuitLengthM: Number(option('max-length', '100')) } } : {}) }
if (new Set(roomTargets.map(([room]) => room)).size !== roomTargets.length || roomTargets.reduce((sum, [, count]) => sum + count, 0) > settings.capacity)
  throw new Error('Room targets must have unique keys and fit the requested physical capacity.')
const hash = createHash('sha256').update(bytes).update(JSON.stringify({ scale, settings, source, timeout, slices, mode, captureBundle }))
if (resume) hash.update(JSON.stringify(resume))
if (warmBytes) hash.update(warmBytes)
hash.update(JSON.stringify(entryVariants))
hash.update(JSON.stringify(allocationVariant))
hash.update(JSON.stringify(roomTargets))
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
  warmRouting: Boolean(warm),
  manual: [], automatic: { status: 'not-run' }, progress: [], observations: {
    obstacleFootprints: obstacles.length,
    unmarkedRectangles: shapes.filter((s) => s.kind === 'rect' && !s.heating && !s.locked && s.heatingObstacle === undefined).map((s) => s.id)
  } }
for (const zone of shapes.filter((s) => s.kind === 'rect' && s.heating?.kind === 'zone')) {
  const start = performance.now(), layout = heatingLayout(zone, obstacles)
  report.manual.push({ id: zone.id, requested: zone.heating.circuits, produced: layout.circuits.length,
    spacingMm: zone.heating.spacingMm, lengthM: layout.lengthM, warning: layout.warning, elapsedMs: Math.round(performance.now() - start) })
}
if (mode !== 'manual') {
  let id = 0, last = '', lastFailure, lastRouting = ''
  let capturedOnly = false
  let resumedRouting = false
  let warmedRouting = false
  let routingStage = false
  const routeFailures = {}, connections = new Map()
  const areaParts = {}
  const start = performance.now()
  try {
    const budget = { session: {}, measuredLeads: resume?.measuredLeads ?? resumeBundle?.measuredLeads,
        ...(roomTargets.length ? { roomTargets: new Map(roomTargets) } : {}),
        allocationVariant, entryVariants: new Map(entryVariants), fieldEntryVariants: new Map(resume?.fieldEntryVariants ?? resumeBundle?.fieldEntryVariants ?? []), pauseOnDeadline: slices > 1, routes: 600, deadline: Date.now() + timeout,
        onFeedReservations(grid, nativeFloor, targets) {
          if (!captureBundle) return
          const encode = (array) => array && Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('base64')
          writeFileSync(`${output}.reserved-feeds.json`, JSON.stringify({ fingerprint: key, source, settings, scale, targets: [...targets], nativeRooms: nativeFloor.rooms,
            grid: { origin: grid.origin, step: grid.step, width: grid.width, height: grid.height, rooms: grid.rooms,
              room: encode(grid.room), wall: encode(grid.wall), door: encode(grid.door), obstacle: encode(grid.obstacle),
              feedCorridor: encode(grid.feedCorridor), feedPaths: grid.feedPaths, feedDistances: encode(grid.feedDistances) } }))
          if (mode === 'capture-feeds') { capturedOnly = true; throw new Error('Heating feed reservations checkpoint captured') }
        },
        onBundleGrid({ grid, blocked, sourceStubs, targetStubs, permittedWallCells, coils, jobs, feedPaths }) {
          if (!captureBundle && !resume) return
          const encode = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('base64')
          const bundle = { fingerprint: key, source, settings, scale,
            allocationVariant: budget.session.work?.allocationVariant ?? allocationVariant,
            entryVariants: [...budget.session.work?.entryVariants ?? budget.entryVariants],
            fieldEntryVariants: [...budget.session.work?.fieldEntryVariants ?? budget.fieldEntryVariants],
            measuredLeads: budget.session.work?.measuredLeads ?? budget.measuredLeads,
            grid: { origin: grid.origin, step: grid.step, width: grid.width, height: grid.height,
              room: encode(grid.room), wall: encode(grid.wall), door: encode(grid.door), obstacle: encode(grid.obstacle) },
            blocked: encode(blocked), sourceStubs, targetStubs, permittedWallCells: [...permittedWallCells ?? []], coils, jobs, feedPaths }
          if (resume && !resumedRouting && routingStage) {
            const constraints = (value) => JSON.stringify([value.source, value.settings, value.scale, value.grid,
              value.blocked, value.sourceStubs, value.targetStubs, [...value.permittedWallCells].sort((a, b) => a - b),
              value.coils.map((coil) => [coil.heating.circuitId, coil.heating.diameterMm, coil.heating.design, heatingPipeGeometry(coil).points])])
            if (constraints(bundle) !== constraints(resumeBundle)) throw new Error('The saved routing belongs to different geometry or settings; start a fresh diagnostic.')
            const routingKey = JSON.stringify(coils.map((coil) => heatingPipeGeometry(coil).points))
            if (routingKey !== resume.key) throw new Error('The saved coil entrances have changed.')
            budget.session.work.connectionRefinement = { key: routingKey, state: resume.state }
            resumedRouting = true
            console.log(JSON.stringify({ resumedRouting: true, prepared: resume.state.priority?.rootDone }))
          }
          if (warm && !warmedRouting && !resume && routingStage) {
            const cached = warm.bundle ?? warm, snapshot = warm.state?.priority?.solution ?? warm.state?.priority?.bestSeed?.routes ?? warm.state?.priority?.root
            const pairs = cached.coils.flatMap((coil, i) => {
              const goals = [i * 2, i * 2 + 1]
              if (warm.feeds) return [{ coilKey: JSON.stringify(heatingPipeGeometry(coil).points),
                points: goals.map((goal) => { const pipe = warm.feeds[goal], points = heatingPipeGeometry(pipe).points;
                  return pipe.heating.pipeRole === 'return' ? [...points].reverse() : points }),
                bendRadiusMm: goals.map((goal) => warm.feeds[goal].heating.bendRadiusMm ?? 80) }]
              return snapshot && goals.every((goal) => snapshot.refined.includes(goal)) ? [{
                coilKey: JSON.stringify(heatingPipeGeometry(coil).points), points: goals.map((goal) => snapshot.points[goal]),
                bendRadiusMm: goals.map((goal) => snapshot.bendRadiusMm[goal]) }] : []
            })
            // An inlet retry changes only a few fields. Retain independently
            // checked pairs from prior layouts as hints as well as the active
            // snapshot; the physical refiner validates every hint again.
            const remembered = [...warm.state?.warmPairs ?? [], ...pairs]
            const distinct = new Map(remembered.map((pair) => [pair.coilKey, pair]))
            pairs.splice(0, pairs.length, ...[...distinct.values()].slice(-32))
            const routingKey = JSON.stringify(coils.map((coil) => heatingPipeGeometry(coil).points))
            budget.session.work.connectionRefinement = { key: routingKey, state: { warmPairs: pairs } }
            warmedRouting = true
            console.log(JSON.stringify({ warmRouting: true, matchingPairs: coils.filter((coil) => pairs.some((pair) => pair.coilKey === JSON.stringify(heatingPipeGeometry(coil).points))).length,
              validation: 'Every cached pair is rechecked against the current coils, native walls, source room and obstacles.' }))
          }
          if (captureBundle) writeFileSync(`${output}.bundle.json`, JSON.stringify(bundle))
          if (mode === 'capture') { capturedOnly = true; throw new Error('Heating bundle checkpoint captured') }
        },
        onProgress(progress) {
          const key = JSON.stringify([progress.phase, progress.attempt, progress.roomName, progress.completedRooms, progress.preparedCircuits, progress.completedCircuits, progress.routeAttempts])
          if (key === last) return
          last = key; report.progress.push({ elapsedMs: Math.round(performance.now() - start), ...progress })
          if (process.argv.includes('--progress')) console.log(JSON.stringify(report.progress.at(-1)))
          if (process.argv.includes('--trace-routing')) {
            const routing = budget.session.work?.connectionRefinement?.state, priority = routing?.priority
            const trace = JSON.stringify({ order: priority?.seed?.order, next: priority?.seed?.next,
              circle: priority?.seed?.order[priority.seed.next], expanded: priority?.expanded,
              conflict: priority?.active?.node.conflict, errors: priority?.active?.node.errors,
              branch: priority?.active?.branch, affected: priority?.active?.affected, edges: priority?.active?.edges })
            if (trace !== lastRouting) {
              lastRouting = trace; console.log(`ROUTING ${trace}`)
              if (captureBundle && priority?.root) writeFileSync(`${output}.routing-preview.json`, JSON.stringify({
                fingerprint: key, trace: JSON.parse(trace), routes: priority.seed?.routes ?? priority.active?.candidate ?? priority.root }))
            }
          }
        }, onRouteFailure(reason, point, detail) {
          lastFailure = { reason, point, detail }
          const failure = routeFailures[reason] ??= { count: 0, first: { point, detail } }; failure.count++
        },
        onAreaParts(group, parts) { areaParts[group] = parts; writeFileSync(`${output}.areas.json`, JSON.stringify({ fingerprint: key, groups: areaParts })) },
        onConnectionCandidate(parts, coils, jobs) {
          if (parts.length) { connections.set(parts[0].heating.circuitId, parts); return }
          routingStage = true
          writeFileSync(`${output}.candidate.json`, JSON.stringify({ fingerprint: key, source, settings, coils, jobs }))
        } }
    let result
    for (let slice = 0; slice < slices; slice++) {
      budget.deadline = Date.now() + timeout
      try {
        result = generateAutomaticHeatingPlan(shapes, source, settings, scale, () => `diagnostic-${id++}`,
          { x: 80, y: 80, width: (document.worldWidth ?? 2376) - 160, height: (document.worldHeight ?? 1680) - 160 }, 0, 0, budget)
        break
      } catch (error) {
        if (budget.session.work?.connectionRefinement) {
          const checkpoint = budget.session.work.connectionRefinement
          const bundle = JSON.parse(readFileSync(`${output}.bundle.json`, 'utf8'))
          if (JSON.stringify(bundle.coils.map((coil) => heatingPipeGeometry(coil).points)) === checkpoint.key)
            writeFileSync(`${output}.routing-checkpoint.json`, JSON.stringify({ fingerprint: key, key: checkpoint.key, bundle, allocationVariant: bundle.allocationVariant,
            entryVariants: bundle.entryVariants, fieldEntryVariants: bundle.fieldEntryVariants, measuredLeads: bundle.measuredLeads,
            state: { ...checkpoint.state, fineGrid: undefined } }))
        }
        if (!(error instanceof HeatingPlanningPaused) || slice + 1 === slices) throw error
        const elapsedMs = Math.round(performance.now() - start)
        report.progress.push({ phase: 'paused', elapsedMs, resumedSlice: slice + 2 })
        console.log(JSON.stringify({ paused: true, elapsedMs, resumingSlice: slice + 2 }))
      }
    }
    // A successful run supersedes its last paused checkpoint. Keep a complete
    // matching state, rather than reporting an old nine-circuit snapshot as
    // though it were the outcome of the completed plan.
    const refinement = budget.session.work?.connectionRefinement
    if (captureBundle && refinement?.state.priority?.solution && existsSync(`${output}.bundle.json`)) {
      const bundle = JSON.parse(readFileSync(`${output}.bundle.json`, 'utf8'))
      const loops = new Map(result.shapes.filter((shape) => shape.heating?.pipeRole === 'loop').map((shape) => [shape.heating.circuitId, shape]))
      const snapshot = refinement.state.priority.solution
      const close = (a, b) => a.length === b.length && a.every((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) < 1e-6)
      const matches = bundle.coils.every((coil, i) => {
        const loop = loops.get(coil.heating.circuitId)
        if (!loop || heatingConnectionEntryKey(heatingPipeGeometry(coil).points) !== heatingConnectionEntryKey(heatingPipeGeometry(loop).points)) return false
        // A coverage patch can change only the coil interior. Its completed
        // routing checkpoint still belongs to the pre-patch coils if BOTH
        // actual final feeds match the saved solution exactly.
        return ['supply', 'return'].every((role, n) => {
          const pipe = result.shapes.find((shape) => shape.heating?.circuitId === coil.heating.circuitId && shape.heating.pipeRole === role)
          if (!pipe) return false
          const points = heatingPipeGeometry(pipe).points
          return close(role === 'return' ? [...points].reverse() : points, snapshot.points[i * 2 + n])
        })
      })
      if (matches && JSON.stringify(bundle.coils.map((coil) => heatingPipeGeometry(coil).points)) === refinement.key)
        writeFileSync(`${output}.routing-checkpoint.json`, JSON.stringify({ fingerprint: key, complete: true, key: refinement.key, bundle,
          allocationVariant: bundle.allocationVariant, entryVariants: bundle.entryVariants, fieldEntryVariants: bundle.fieldEntryVariants,
          measuredLeads: bundle.measuredLeads, state: { ...refinement.state, fineGrid: undefined } }))
    }
    report.automatic = { status: 'success', elapsedMs: Math.round(performance.now() - start), rows: result.rows,
      audit: result.shapes.find((s) => s.heating?.kind === 'manifold')?.heating?.audit, wallCrossings: result.wallCrossings,
      tableOnSeparatePage: result.tableOnSeparatePage }
    writeFileSync(`${output}.plan.json`, JSON.stringify({ version: 2, paperLayoutVersion: 1, drawingScale: scale,
      paperPreset: document.paperPreset ?? 'a4-landscape', printMargin: document.printMargin ?? 10, worldWidth: document.worldWidth ?? 2376,
      worldHeight: document.worldHeight ?? 1680, shapes: [...shapes, ...result.shapes.filter((s) => !result.tableOnSeparatePage || s.heating?.kind !== 'table')] }))
  } catch (error) {
    report.automatic = capturedOnly ? { status: 'captured', elapsedMs: Math.round(performance.now() - start) }
      : { status: error instanceof HeatingPlanningPaused ? 'paused' : 'failure', elapsedMs: Math.round(performance.now() - start), message: error.message,
        diagnostics: error.diagnostics, lastFailure, routeFailures }
  }
  if (connections.size) writeFileSync(`${output}.connections.json`, JSON.stringify({ fingerprint: key, parts: [...connections.values()].flat() }))
}
const temporary = `${output}.${process.pid}.tmp`
writeFileSync(temporary, JSON.stringify(report, null, 2))
renameSync(temporary, output)
summary(report)
