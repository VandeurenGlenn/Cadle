// Inspect a --capture-bundle diagnostic without rebuilding rooms and coils.
// node --import tsx scripts/inspect-heating-bundle.mjs /tmp/report.json.bundle.json --svg=/tmp/bundle.svg
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { heatingPointClearance } from '../src/editor/heating-clearance.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { routeHeatingBundle } from '../src/editor/heating-bundle.ts'
import { deflateSync } from 'node:zlib'
import { refineHeatingConnectionBundle } from '../src/editor/heating-connection-refinement.ts'
import { createHeatingPipe } from '../src/editor/heating-pipe.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'
import { heatingObstacleBounds } from '../src/editor/heating-openings.ts'
import { sanitizeShapes, shapeBounds } from '../src/editor/model/model.ts'
import { heatingGridRound } from '../src/editor/heating-routing.ts'

const capture = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const reportPath = process.argv[2].replace(/\.bundle\.json$/, '')
if (!process.argv.includes('--frozen') && reportPath !== process.argv[2] && existsSync(reportPath) &&
  JSON.parse(readFileSync(reportPath, 'utf8')).fingerprint !== capture.fingerprint) {
  throw new Error('This bundle belongs to an earlier planner run. Capture the current inputs, or use --frozen to inspect that earlier checkpoint explicitly.')
}
const bytes = (value) => new Uint8Array(Buffer.from(value, 'base64'))
const grid = { ...capture.grid, drawingScale: capture.scale }
for (const key of ['wall', 'door', 'obstacle']) grid[key] = bytes(grid[key])
const room = Buffer.from(grid.room, 'base64')
grid.room = Int32Array.from({ length: room.length / 4 }, (_, i) => room.readInt32LE(i * 4))
const { width, height, origin, step } = grid
grid.point = (cell) => ({ x: origin.x + cell % width * step, y: origin.y + Math.floor(cell / width) * step })
grid.index = (p) => {
  const x = heatingGridRound((p.x - origin.x) / step), y = heatingGridRound((p.y - origin.y) / step)
  return x < 0 || x >= width || y < 0 || y >= height ? -1 : y * width + x
}
const permitted = new Set(capture.permittedWallCells), blocked = bytes(capture.blocked)
const sources = capture.sourceStubs.map((stub) => stub.at(-1))
let goals = capture.targetStubs.map((stub) => stub.at(-1))
const connected = (mask) => {
  const size = width * height, component = new Int32Array(size).fill(-1), sizes = []
  const free = (cell) => !mask[cell] && (!grid.wall[cell] || grid.door[cell] || permitted.has(cell))
  const queue = new Int32Array(size)
  for (let root = 0; root < size; root++) {
    if (component[root] >= 0 || !free(root)) continue
    const id = sizes.length; let read = 0, write = 1; queue[0] = root; component[root] = id
    while (read < write) {
      const cell = queue[read++], x = cell % width, y = Math.floor(cell / width)
      for (const next of [x ? cell - 1 : -1, x + 1 < width ? cell + 1 : -1, y ? cell - width : -1, y + 1 < height ? cell + width : -1]) {
        if (next < 0 || component[next] >= 0 || !free(next)) continue
        component[next] = id; queue[write++] = next
      }
    }
    sizes.push(write)
  }
  const reachable = new Set(sources.map((cell) => component[cell]).filter((id) => id >= 0))
  return { component, reachable, goals: goals.map((cell, i) => ({ circuit: capture.coils[Math.floor(i / 2)].heating.circuitId,
    role: i % 2 ? 'return' : 'supply', point: grid.point(cell), component: component[cell],
    cells: sizes[component[cell]] ?? 0, reachable: reachable.has(component[cell]) })) }
}
const exactJoints = new Map(capture.coils.map((coil) => {
  const points = heatingPipeGeometry(coil).points
  return [coil.id, [points[0], points.at(-1)]]
}))
const tubeFree = heatingPointClearance(capture.coils, capture.settings.diameterMm, capture.scale, { joints: exactJoints })
const physical = grid.obstacle.slice()
for (let cell = 0; cell < physical.length; cell++) if (!physical[cell] && !tubeFree(grid.point(cell))) physical[cell] = 1
const targetStubCells = Number(process.argv.find((arg) => arg.startsWith('--target-stub-cells='))?.split('=')[1])
if (Number.isInteger(targetStubCells) && targetStubCells >= 0) {
  for (const stub of capture.targetStubs) for (const cell of stub.slice(0, -1)) if (!physical[cell]) blocked[cell] = 0
  capture.targetStubs = capture.targetStubs.map((stub) => stub.slice(0, targetStubCells + 1))
  for (const stub of capture.targetStubs) for (const cell of stub.slice(0, -1)) blocked[cell] = 1
  goals = capture.targetStubs.map((stub) => stub.at(-1))
}
const actual = connected(blocked), withoutStubs = connected(physical)
if (capture.feedPaths) {
  const collisions = []
  for (const [i, coil] of capture.coils.entries()) {
    const free = heatingPointClearance([coil], capture.settings.diameterMm, capture.scale)
    const cells = [...new Set(capture.feedPaths.flat())].filter((cell) => !free(grid.point(cell)))
    if (cells.length) collisions.push({ circuit: coil.heating.circuitId, room: capture.jobs[i].roomName, cells: cells.length, points: cells.slice(0, 8).map(grid.point) })
  }
  console.log(JSON.stringify({ reservedFeedCollisions: collisions }, null, 2))
}
let bottleneck, refinedFeeds = []
if (process.argv.includes('--flow') || process.argv.includes('--refine') || process.argv.includes('--pairs')) {
  const start = performance.now()
  const paths = routeHeatingBundle(grid, sources, goals, blocked, {}) ?? routeHeatingBundle(grid, sources, goals, blocked, { allowWalls: true, permittedWallCells: permitted,
    onBottleneck(routed, cells) { bottleneck = { routed, cells, points: cells.map(grid.point) } } })
  console.log(JSON.stringify({ flow: paths?.length ?? 0, elapsedMs: Math.round(performance.now() - start), bottleneck }, null, 2))
  if (paths && (process.argv.includes('--refine') || process.argv.includes('--pairs'))) {
    const input = process.argv.find((arg) => arg.startsWith('--input='))?.slice(8)
    const document = input ? JSON.parse(readFileSync(input, 'utf8')) : undefined
    const obstacles = document ? heatingObstacleBounds(sanitizeShapes(document.shapes ?? document), shapeBounds) : []
    const settings = capture.coils[0].heating
    let end = Date.now() + Number(process.argv.find((arg) => arg.startsWith('--timeout-ms='))?.slice(13) ?? 180000)
    if (process.argv.includes('--pairs')) {
      const pairs = capture.coils.map((coil, i) => {
        const result = refineHeatingConnectionBundle(grid, paths.slice(i * 2, i * 2 + 2), capture.sourceStubs,
          capture.targetStubs.slice(i * 2, i * 2 + 2), [coil], settings, capture.scale,
          { sourcePosition: capture.source, permittedWallCells: permitted, obstacles, preserved: capture.coils.filter((_, n) => n !== i),
            checkpoint() { if (Date.now() > end) throw new Error('Pair inspection deadline') } })
        return { circuit: coil.heating.circuitId, room: capture.jobs[i].roomName, refined: result.refined.length, failures: result.failures }
      })
      console.log(JSON.stringify({ independentPairs: pairs }, null, 2)); process.exit(0)
    }
    const resumePath = process.argv.find((arg) => arg.startsWith('--resume-state='))?.slice(15)
    const resume = resumePath ? JSON.parse(readFileSync(resumePath, 'utf8')) : undefined
    if (resume && (resume.fingerprint !== capture.fingerprint || resume.key !== JSON.stringify(capture.coils.map((coil) => heatingPipeGeometry(coil).points)))) throw new Error('The routing checkpoint does not match these exact coils.')
    const state = resume?.state ?? {}
    let refined
    const paused = new Error('Refinement paused'), slices = Number(process.argv.find((arg) => arg.startsWith('--slices='))?.slice(9) ?? 1)
    for (let slice = 0; slice < slices; slice++) {
      try {
      refined = refineHeatingConnectionBundle(grid, paths, capture.sourceStubs, capture.targetStubs, capture.coils, settings, capture.scale,
      { state, onProgress: process.argv.includes('--progress') ? (done) => console.log(JSON.stringify({ pass: state.pass, rootPairs: state.priority?.rootDone, expanded: state.priority?.expanded, completed: done, circuits: state.refined.map((goal) => Math.floor(goal / 2)).filter((circuit, i, all) => all.indexOf(circuit) === i) })) : undefined, sourcePosition: capture.source, permittedWallCells: permitted, obstacles, checkpoint() { if (Date.now() > end) throw paused } })
      break
      } catch (error) {
        if (error === paused) writeFileSync(`${process.argv[2]}.routing-checkpoint.json`, JSON.stringify({ fingerprint: capture.fingerprint,
          key: JSON.stringify(capture.coils.map((coil) => heatingPipeGeometry(coil).points)), state: { ...state, fineGrid: undefined } }))
        if (error !== paused) throw error
        if (slice + 1 >= slices) {
          console.log(JSON.stringify({ status: 'paused', checkpoint: `${process.argv[2]}.routing-checkpoint.json`, rootPairs: state.priority?.rootDone, expanded: state.priority?.expanded }))
          process.exit(0)
        }
        console.log(JSON.stringify({ paused: true, rootPairs: state.priority?.rootDone, expanded: state.priority?.expanded, resumingSlice: slice + 2 }))
        end = Date.now() + Number(process.argv.find((arg) => arg.startsWith('--timeout-ms='))?.slice(13) ?? 180000)
      }
    }
    refinedFeeds = refined.points.map((points, goal) => createHeatingPipe(`refined-${goal}`, goal % 2 ? [...points].reverse() : points,
      { ...capture.coils[Math.floor(goal / 2)].heating, bendRadiusMm: refined.bendRadiusMm[goal], pipeRole: goal % 2 ? 'return' : 'supply' }))
    const audit = checkHeatingPlan([...capture.coils, ...refinedFeeds], [], settings.design, obstacles)
    const acceptedAudit = checkHeatingPlan([...capture.coils, ...refinedFeeds.filter((_, goal) => refined.refined.includes(goal))], [], settings.design, obstacles)
    const totals = capture.coils.map((coil, i) => ({ id: coil.heating.circuitId, totalM: [coil, ...refinedFeeds.slice(i * 2, i * 2 + 2)]
      .reduce((sum, pipe) => sum + heatingPipeGeometry(pipe).length * capture.scale / 8000, 0) }))
    console.log(JSON.stringify({ refined: refined.refined.length, acceptedErrors: acceptedAudit.errors, failures: refined.failures,
      unrefined: goals.flatMap((_, goal) => refined.refined.includes(goal) ? [] : [{ goal, circuit: capture.coils[Math.floor(goal / 2)].heating.circuitId, role: goal % 2 ? 'return' : 'supply' }]),
      elapsedMs: Math.round(performance.now() - start), totals,
      errors: audit.errors, issues: audit.issues.slice(0, 12) }, null, 2))
    writeFileSync(`${process.argv[2]}.refined.json`, JSON.stringify({ fingerprint: capture.fingerprint, coils: capture.coils, feeds: refinedFeeds, audit, totals }))
  }
}
console.log(JSON.stringify({ fingerprint: capture.fingerprint, sources: sources.length,
  blocked: actual.goals.filter((goal) => !goal.reachable), withoutStubs: withoutStubs.goals.filter((goal) => !goal.reachable) }, null, 2))
const svgPath = process.argv.find((arg) => arg.startsWith('--svg='))?.slice(6)
if (svgPath) {
  const elements = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width * 2}" height="${height * 2}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/>`]
  const color = (cell) => grid.wall[cell] && !grid.door[cell] && !permitted.has(cell) ? '#343434' : grid.obstacle[cell] ? '#777777' : blocked[cell] ? '#d47b38' :
    actual.reachable.has(actual.component[cell]) ? '#d7f0ff' : '#ffffff'
  for (let y = 0; y < height; y++) for (let x = 0; x < width;) {
    const fill = color(y * width + x), start = x
    while (x < width && color(y * width + x) === fill) x++
    if (fill !== '#ffffff') elements.push(`<rect x="${start}" y="${y}" width="${x - start}" height="1" fill="${fill}"/>`)
  }
  for (const [i, cell] of goals.entries()) {
    const x = cell % width, y = Math.floor(cell / width)
    elements.push(`<circle cx="${x}" cy="${y}" r="2" fill="${actual.goals[i].reachable ? '#15803d' : '#dc2626'}"/><text x="${x + 3}" y="${y - 2}" font-family="sans-serif" font-size="7">${i + 1}</text>`)
  }
  for (const cell of sources) elements.push(`<circle cx="${cell % width}" cy="${Math.floor(cell / width)}" r="1.5" fill="#0b54cc"/>`)
  elements.push('</svg>'); writeFileSync(svgPath, elements.join(''))
}
const pngPath = process.argv.find((arg) => arg.startsWith('--png='))?.slice(6)
if (pngPath) {
  const pixels = Buffer.alloc(height * (width * 3 + 1), 255)
  const put = (x, y, color) => { if (x >= 0 && x < width && y >= 0 && y < height) pixels.set(color, y * (width * 3 + 1) + 1 + x * 3) }
  for (let y = 0; y < height; y++) {
    pixels[y * (width * 3 + 1)] = 0
    for (let x = 0; x < width; x++) {
      const cell = y * width + x
      put(x, y, grid.wall[cell] && !grid.door[cell] && !permitted.has(cell) ? [52, 52, 52] : grid.obstacle[cell] ? [119, 119, 119] :
        blocked[cell] ? [212, 123, 56] : actual.reachable.has(actual.component[cell]) ? [215, 240, 255] : [255, 255, 255])
    }
  }
  const dot = (cell, color, radius) => { const xx = cell % width, yy = Math.floor(cell / width); for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) if (x * x + y * y <= radius * radius) put(xx + x, yy + y, color) }
  sources.forEach((cell) => dot(cell, [11, 84, 204], 2))
  capture.feedPaths?.flat().forEach((cell) => dot(cell, [135, 15, 190], 0))
  for (const pipe of refinedFeeds) for (const { a, b } of heatingPipeGeometry(pipe).pieces) {
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step * 2))
    for (let n = 0; n <= count; n++) dot(grid.index({ x: a.x + (b.x - a.x) * n / count, y: a.y + (b.y - a.y) * n / count }), [10, 80, 240], 0)
  }
  goals.forEach((cell) => dot(cell, [21, 128, 61], 2))
  bottleneck?.cells.forEach((cell) => dot(cell, [255, 0, 0], 3))
  const crc = (buffer) => { let value = -1; for (const byte of buffer) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1 } return (value ^ -1) >>> 0 }
  const chunk = (type, data) => { const header = Buffer.alloc(8), check = Buffer.alloc(4); header.writeUInt32BE(data.length); header.write(type, 4); check.writeUInt32BE(crc(Buffer.concat([Buffer.from(type), data]))); return Buffer.concat([header, data, check]) }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  writeFileSync(pngPath, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]))
}
