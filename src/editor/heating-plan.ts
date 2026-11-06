import type { Point, RectShape, Shape } from './model/types.js'
import { drawingLengthMetres, drawingUnitsForMetres, isDrawingScale, DEFAULT_DRAWING_SCALE } from './layout/drawing-scale.js'
import { wrapPaperText } from './layout/paper-text-layout.js'
import { heatingHydraulics, heatingFloor, heatingWater, sanitizeHeatingHydraulics, sanitizeHeatingFloor, type HeatingHydraulics, type HeatingFloor } from './heating-performance.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { heatingDesignLimits, sanitizeHeatingDesign, MAX_HEATING_CIRCUITS, type HeatingDesignInputs } from './heating-design.js'
import { checkHeatingPlan, sanitizeHeatingAudit, type HeatingAudit, type HeatingCheck } from './heating-checks.js'
import { isHeatingSymbolObstacle } from './heating-openings.js'

export type HeatingData = {
  kind: 'zone' | 'pipe' | 'manifold' | 'table'
  name: string
  drawingScale: number
  spacingMm: number
  spacingMinMm?: number
  spacingMaxMm?: number
  edgeMm: number
  diameterMm: number
  circuits: number
  direction: 'horizontal' | 'vertical'
  pipeRole: 'supply' | 'return' | 'loop'
  automatic?: boolean
  manualRoute?: boolean
  circuitId?: string
  roomName?: string
  roomKey?: string
  servedAreaM2?: number
  sourcePageKey?: string
  rows?: HeatingScheduleRow[]
  design?: HeatingDesignInputs
  audit?: HeatingAudit
  checks?: HeatingCheck[]
  rowOffset?: number
  rowLimit?: number
  /** Pipe waypoints in the shape's own 0..1 coordinate space. */
  points?: Point[]
}

export type HeatingScheduleRow = { id: string; room: string; diameterMm: number; spacingMm: number; areaM2: number;
  loopM: number; supplyM: number; returnM: number; totalM: number; flowLmin: number;
  spacingMinMm?: number; spacingMaxMm?: number;
  hydraulics?: HeatingHydraulics; floor?: HeatingFloor;
  allowanceM?: number; cutM?: number; flowEstimated?: boolean; checkMessages?: string[] }

// Explicit estimating assumptions, not a room heat-loss calculation.
// Water: c=4190 J/(kg·K), density=0.998 kg/l. Danfoss Planning Underfloor Heat, pp. 6–7:
// https://assets.danfoss.com/documents/latest/100650/AG000086464394en-010201.pdf
export const HEATING_FLOW_BASIS = { heatWm2: 50, deltaTK: 5, specificHeat: 4190, densityKgL: .998 }
export const heatingFlowLmin = (areaM2: number): number => areaM2 * HEATING_FLOW_BASIS.heatWm2 * 60 /
  (HEATING_FLOW_BASIS.deltaTK * HEATING_FLOW_BASIS.specificHeat * HEATING_FLOW_BASIS.densityKgL)

export const heatingDefaults = (kind: HeatingData['kind'], drawingScale = DEFAULT_DRAWING_SCALE): HeatingData => ({
  kind, drawingScale, name: kind === 'zone' ? 'Zone' : kind === 'manifold' ? 'Verdeler' : 'Buis',
  spacingMm: 150, edgeMm: 100, diameterMm: 16, circuits: kind === 'manifold' ? 6 : 1,
  direction: 'horizontal', pipeRole: 'supply'
})

/** A compact plan symbol with room for distinct supply/return ports. */
export const heatingManifoldSize = (circuits: number, scale: number, portStep = drawingUnitsForMetres(.025, scale)) => ({
  width: Math.max(drawingUnitsForMetres(.6, scale), (circuits * 3 + 3) * portStep),
  height: drawingUnitsForMetres(.35, scale)
})

/** Update the old placement default only while it has no pipe connections.
 * Connected and deliberately resized manifolds keep their stored geometry. */
export const compactUnusedHeatingManifolds = (shapes: Shape[]): Shape[] => {
  if (shapes.some((shape) => shape.heating?.kind === 'pipe')) return shapes
  return shapes.map((shape) => {
    if (shape.kind !== 'rect' || shape.heating?.kind !== 'manifold' || shape.heating.automatic ||
      Math.abs(Math.abs(shape.end.x - shape.start.x) - 120) > 1e-6 || Math.abs(Math.abs(shape.end.y - shape.start.y) - 64) > 1e-6) return shape
    const size = heatingManifoldSize(shape.heating.circuits, shape.heating.drawingScale)
    return { ...shape, end: { x: shape.start.x + Math.sign(shape.end.x - shape.start.x) * size.width,
      y: shape.start.y + Math.sign(shape.end.y - shape.start.y) * size.height } }
  })
}

export const sanitizeHeating = (value: unknown): HeatingData | undefined => {
  if (!value || typeof value !== 'object') return
  const raw = value as Record<string, unknown>
  if (raw.kind !== 'zone' && raw.kind !== 'pipe' && raw.kind !== 'manifold' && raw.kind !== 'table') return
  const data = heatingDefaults(raw.kind, isDrawingScale(raw.drawingScale) ? raw.drawingScale : DEFAULT_DRAWING_SCALE)
  if (typeof raw.name === 'string') data.name = raw.name.trim().slice(0, 100)
  for (const [key, min, max] of [['spacingMm', 50, 500], ['edgeMm', 0, 1000], ['diameterMm', 6, 50], ['circuits', 1, MAX_HEATING_CIRCUITS]] as const) {
    if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) data[key] = Math.max(min, Math.min(max, raw[key] as number))
  }
  for (const key of ['spacingMinMm', 'spacingMaxMm'] as const) if (typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= 1 && raw[key] <= 500) data[key] = raw[key]
  data.circuits = Math.round(data.circuits)
  if (raw.direction === 'vertical') data.direction = 'vertical'
  if (raw.pipeRole === 'return') data.pipeRole = 'return'
  if (raw.pipeRole === 'loop') data.pipeRole = 'loop'
  if (raw.automatic === true) data.automatic = true
  if (raw.manualRoute === true) data.manualRoute = true
  const design = sanitizeHeatingDesign(raw.design), audit = sanitizeHeatingAudit(raw.audit), checks = sanitizeHeatingAudit({ issues: raw.checks })?.issues
  if (design) data.design = design
  if (audit) data.audit = audit
  if (checks) data.checks = checks
  for (const key of ['rowOffset', 'rowLimit'] as const) if (typeof raw[key] === 'number' && Number.isInteger(raw[key]) && raw[key] >= 0 && raw[key] <= 100) data[key] = raw[key] as number
  for (const key of ['circuitId', 'roomName', 'roomKey', 'sourcePageKey'] as const) if (typeof raw[key] === 'string') data[key] = (raw[key] as string).slice(0, key === 'roomName' ? 140 : 100)
  if (typeof raw.servedAreaM2 === 'number' && Number.isFinite(raw.servedAreaM2) && raw.servedAreaM2 >= 0) data.servedAreaM2 = raw.servedAreaM2
  if (Array.isArray(raw.rows)) data.rows = raw.rows.slice(0, 100).flatMap((row): HeatingScheduleRow[] => {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || typeof row.room !== 'string') return []
    const keys = ['diameterMm', 'spacingMm', 'areaM2', 'loopM', 'supplyM', 'returnM', 'totalM', 'flowLmin'] as const
    if (!keys.every((key) => typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 0)) return []
    return [{ id: row.id.slice(0, 100), room: row.room.slice(0, 140), ...Object.fromEntries(keys.map((key) => [key, row[key]])),
      ...Object.fromEntries(['spacingMinMm', 'spacingMaxMm'].filter((key) => typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 1 && row[key] <= 500).map((key) => [key, row[key]])),
      ...(sanitizeHeatingHydraulics(row.hydraulics) ? { hydraulics: sanitizeHeatingHydraulics(row.hydraulics) } : {}),
      ...(sanitizeHeatingFloor(row.floor) ? { floor: sanitizeHeatingFloor(row.floor) } : {}),
      ...(typeof row.cutM === 'number' && Number.isFinite(row.cutM) && row.cutM >= 0 ? { cutM: row.cutM } : {}),
      ...(typeof row.allowanceM === 'number' && Number.isFinite(row.allowanceM) && row.allowanceM >= 0 ? { allowanceM: row.allowanceM } : {}),
      ...(typeof row.flowEstimated === 'boolean' ? { flowEstimated: row.flowEstimated } : {}),
      ...(Array.isArray(row.checkMessages) ? { checkMessages: row.checkMessages.filter((m: unknown) => typeof m === 'string').slice(0, 30) } : {}) } as HeatingScheduleRow]
  })
  if ((raw.kind === 'pipe' || raw.kind === 'manifold') && Array.isArray(raw.points)) {
    data.points = raw.points.slice(0, 1000).flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const { x, y } = item as Point
      return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? [{ x, y }] : []
    })
    if (data.points.length < 2) return
  }
  if (raw.kind === 'pipe' && !data.points) return
  return data
}

export const heatingBounds = (shape: RectShape) => ({
  x: Math.min(shape.start.x, shape.end.x), y: Math.min(shape.start.y, shape.end.y),
  width: Math.abs(shape.end.x - shape.start.x), height: Math.abs(shape.end.y - shape.start.y)
})

export const createHeatingPipe = (id: string, points: Point[], data: HeatingData): RectShape => {
  const x = Math.min(...points.map((p) => p.x)), y = Math.min(...points.map((p) => p.y))
  const width = Math.max(...points.map((p) => p.x)) - x, height = Math.max(...points.map((p) => p.y)) - y
  return { id, kind: 'rect', start: { x, y }, end: { x: x + width, y: y + height }, strokeWidth: 2,
    heating: { ...data, kind: 'pipe', points: points.map((p) => ({ x: width ? (p.x - x) / width : 0, y: height ? (p.y - y) / height : 0 })) } }
}

type HeatingCircuit = { path: string; lengthM: number; start: Point; end: Point }
export type HeatingLayout = { circuits: HeatingCircuit[]; areaM2: number; lengthM: number; warning?: string }

/** Generate rounded meanders in rectangular zones. The stated length excludes external leads. */
export const heatingLayout = (shape: RectShape): HeatingLayout => {
  const data = shape.heating!
  const bounds = heatingBounds(shape)
  const metre = (length: number) => drawingLengthMetres(length, data.drawingScale)
  if (data.kind === 'pipe') {
    const geometry = heatingPipeGeometry(shape), lengthM = metre(geometry.length)
    return { areaM2: 0, lengthM, circuits: geometry.points.length < 2 ? [] : [{ path: geometry.path, lengthM, start: geometry.localPoints[0], end: geometry.localPoints.at(-1)! }] }
  }
  const areaM2 = metre(bounds.width) * metre(bounds.height)
  if (data.kind !== 'zone') return { circuits: [], areaM2: 0, lengthM: 0 }
  const vertical = data.direction === 'vertical'
  const width = vertical ? bounds.height : bounds.width, height = vertical ? bounds.width : bounds.height
  const spacing = drawingUnitsForMetres(data.spacingMm / 1000, data.drawingScale)
  const edge = drawingUnitsForMetres(data.edgeMm / 1000, data.drawingScale)
  const strip = width / data.circuits, innerWidth = strip - 2 * edge, innerHeight = height - 2 * edge
  const rows = Math.min(1000, 2 * Math.floor((Math.floor(innerHeight / spacing) + 1) / 2))
  if (rows < 2 || innerWidth <= spacing || innerHeight < spacing) {
    return { circuits: [], areaM2, lengthM: 0, warning: 'Zone te klein voor deze buisafstand, randafstand en aantal lussen.' }
  }
  const radius = spacing / 2
  const point = (x: number, y: number): Point => vertical ? { x: bounds.x + y, y: bounds.y + x } : { x: bounds.x + x, y: bounds.y + y }
  const coordinates = (x: number, y: number) => { const p = point(x, y); return `${p.x} ${p.y}` }
  const circuits = Array.from({ length: data.circuits }, (_, index): HeatingCircuit => {
    const left = index * strip + edge, right = (index + 1) * strip - edge
    let path = `M ${coordinates(left, edge)} L ${coordinates(right - radius, edge)}`
    for (let row = 1; row < rows; row++) {
      const y = edge + row * spacing, rightTurn = row % 2 === 1
      const x = rightTurn ? right - radius : left + radius
      const sweep = (rightTurn !== vertical) ? 1 : 0
      path += ` A ${radius} ${radius} 0 0 ${sweep} ${coordinates(x, y)}`
      path += ` L ${coordinates(row === rows - 1 ? left : rightTurn ? left + radius : right - radius, y)}`
    }
    const lengthM = metre(rows * (innerWidth - 2 * radius) + 2 * radius + (rows - 1) * Math.PI * radius)
    return { path, lengthM, start: point(left, edge), end: point(left, edge + (rows - 1) * spacing) }
  })
  return { circuits, areaM2, lengthM: circuits.reduce((sum, item) => sum + item.lengthM, 0) }
}

export const heatingSchedule = (shapes: readonly RectShape[]): HeatingScheduleRow[] => {
  const rows = new Map<string, HeatingScheduleRow>()
  for (const shape of shapes) {
    const data = shape.heating
    if (!data?.circuitId || data.kind !== 'pipe') continue
    let row = rows.get(data.circuitId)
    if (!row) {
      row = { ...(data.spacingMinMm ? { spacingMinMm: data.spacingMinMm, spacingMaxMm: data.spacingMaxMm } : {}), id: data.circuitId, room: data.roomName ?? data.name, diameterMm: data.diameterMm, spacingMm: data.spacingMm,
        areaM2: 0, loopM: 0, supplyM: 0, returnM: 0, totalM: 0, flowLmin: 0 }
      rows.set(data.circuitId, row)
    }
    const length = heatingLayout(shape).lengthM
    if (data.pipeRole === 'loop') { row.loopM += length; row.areaM2 += data.servedAreaM2 ?? 0 }
    if (data.pipeRole === 'supply') row.supplyM += length
    if (data.pipeRole === 'return') row.returnM += length
    row.totalM += length
  }
  const design = shapes.find((s) => s.heating?.kind === 'manifold')?.heating?.design ?? shapes.find((s) => s.heating?.design)?.heating?.design
  const areaByRoom = new Map<string, number>()
  for (const row of rows.values()) areaByRoom.set(row.room, (areaByRoom.get(row.room) ?? 0) + row.areaM2)
  const calculated = [...rows.values()].map((row) => {
    const limits = heatingDesignLimits(row.diameterMm, design), loads = design?.roomHeatLoadsW
    const roomPower = loads && Object.hasOwn(loads, row.room) ? loads[row.room] : undefined
    const power = roomPower === undefined ? row.areaM2 * HEATING_FLOW_BASIS.heatWm2 : roomPower * row.areaM2 / Math.max(1e-9, areaByRoom.get(row.room) ?? 0)
    const cutM = row.totalM + limits.allowanceM, flowLmin = (power + (design?.downwardDesignWm2 ?? 0) * row.areaM2) * 60 / (limits.deltaTK * HEATING_FLOW_BASIS.specificHeat * HEATING_FLOW_BASIS.densityKgL)
    return { ...row, allowanceM: limits.allowanceM, cutM, flowLmin,
      hydraulics: heatingHydraulics(row.diameterMm, cutM, flowLmin, design),
      floor: heatingFloor(row.areaM2, roomPower === undefined ? undefined : power, row.diameterMm, row.spacingMm, design),
      flowEstimated: roomPower === undefined || design?.deltaTK === undefined }
  }).sort((a, b) => a.id.localeCompare(b.id))
  const criticalKpa = Math.max(0, ...calculated.map((r) => r.hydraulics?.totalKpa ?? 0))
  const water = heatingWater(design?.fluidTemperatureC ?? ((design?.supplyTemperatureC ?? 35) - (design?.deltaTK ?? 5) / 2))
  return calculated.map((row) => {
    const h = row.hydraulics
    if (!h) return row
    // With a known operating differential pressure, every parallel circuit must
    // consume that pressure at its design flow. Without it, balance to the minimum
    // required head of the critical circuit and keep pump verification outstanding.
    const targetPressureKpa = Math.max(criticalKpa, design?.availablePressureKpa ?? criticalKpa)
    const sufficientPressure = design?.availablePressureKpa === undefined || design.availablePressureKpa + .001 >= criticalKpa
    const balanceKpa = Math.max(0, targetPressureKpa - h.totalKpa)
    return { ...row, hydraulics: { ...h, balanceKpa,
      targetKv: sufficientPressure && balanceKpa > .001 && water ? row.flowLmin * .06 * Math.sqrt(water.densityKgM3 / 1000 / (balanceKpa / 100)) : undefined,
      pumpMarginKpa: design?.availablePressureKpa === undefined ? undefined : design.availablePressureKpa - criticalKpa } }
  })
}

export const HEATING_TABLE_ROW_HEIGHT = 64
export const heatingScheduleTotals = (rows: readonly HeatingScheduleRow[]) => rows.reduce((total, row) => ({
  circuits: total.circuits + 1, areaM2: total.areaM2 + row.areaM2,
  loopM: total.loopM + row.loopM, supplyM: total.supplyM + row.supplyM, returnM: total.returnM + row.returnM,
  totalM: total.totalM + row.totalM, allowanceM: total.allowanceM + (row.allowanceM ?? 0),
  cutM: total.cutM + (row.cutM ?? row.totalM), flowLmin: total.flowLmin + row.flowLmin
}), { circuits: 0, areaM2: 0, loopM: 0, supplyM: 0, returnM: 0, totalM: 0, allowanceM: 0, cutM: 0, flowLmin: 0 })
export const heatingTableSize = (rows: number) => ({ width: 1320, height: 560 + rows * HEATING_TABLE_ROW_HEIGHT })

/** One readable A4 schedule per chunk; the editor assigns each overflow chunk its own page. */
export const createHeatingScheduleTables = (rows: HeatingScheduleRow[], data: HeatingData, nextId: () => string, position: Point): RectShape[] => {
  const maxRows = Math.max(1, Math.floor((1384 - heatingTableSize(0).height) / HEATING_TABLE_ROW_HEIGHT))
  const tables: RectShape[] = []
  for (let offset = 0; offset < rows.length; offset += maxRows) {
    const pageRows = rows.slice(offset, offset + maxRows), size = heatingTableSize(pageRows.length)
    tables.push({ id: nextId(), kind: 'rect', start: { ...position }, end: { x: position.x + size.width, y: position.y + size.height },
      heating: { ...data, kind: 'table', automatic: true, rows: pageRows, rowOffset: offset, rowLimit: maxRows } })
  }
  return tables
}

const heatingPresentationCache = new WeakMap<Shape, { fingerprint: string; rows: HeatingScheduleRow[]; audit: HeatingAudit }>()
export const presentHeatingTables = (shapes: Shape[], sourceFor?: (key: string) => Shape[] | undefined,
  boundsFor?: (shape: Shape) => { x: number; y: number; width: number; height: number }): Shape[] => {
  const cache = new Map<string, { rows: HeatingScheduleRow[]; audit: HeatingAudit }>()
  const calculate = (key: string) => {
    if (cache.has(key)) return cache.get(key)
    const source = key ? sourceFor?.(key) : shapes
    if (!source) return
    const obstacles = boundsFor ? source.filter(isHeatingSymbolObstacle).map(boundsFor) : []
    const owner = source.find((shape) => shape.heating?.kind === 'manifold') ?? source[0]
    const fingerprint = JSON.stringify([source, obstacles]), cached = owner ? heatingPresentationCache.get(owner) : undefined
    if (cached?.fingerprint === fingerprint) { cache.set(key, cached); return cached }
    const rows = heatingSchedule(source.filter((s): s is RectShape => s.kind === 'rect'))
    const design = source.find((s) => s.heating?.kind === 'manifold')?.heating?.design
    const audit = checkHeatingPlan(source, rows, design, obstacles)
    const value = { rows: rows.map((row) => ({ ...row, checkMessages: audit.issues.filter((issue) => issue.circuits.includes(row.id)).map((issue) => issue.message) })), audit }
    if (owner) heatingPresentationCache.set(owner, { fingerprint, ...value })
    cache.set(key, value); return value
  }
  return shapes.map((shape) => {
    if (shape.kind !== 'rect' || !shape.heating?.automatic) return shape
    const data = shape.heating, result = calculate(data.kind === 'table' ? data.sourcePageKey ?? '' : '')
    if (!result) return shape
    if (data.kind === 'table') {
      const rows = result.rows.slice(data.rowOffset ?? 0, data.rowLimit ? (data.rowOffset ?? 0) + data.rowLimit : undefined)
      const height = heatingTableSize(rows.length).height * (Math.abs(shape.end.x - shape.start.x) / 1320)
      return { ...shape, end: { ...shape.end, y: shape.start.y + height }, heating: { ...data, rows, audit: result.audit, design: (data.sourcePageKey ? sourceFor?.(data.sourcePageKey) : shapes)?.find((s) => s.heating?.kind === 'manifold')?.heating?.design ?? data.design } }
    }
    return { ...shape, heating: { ...data, ...(data.kind === 'manifold' ? { audit: result.audit, rows: result.rows }
      : data.kind === 'pipe' ? { checks: result.audit.issues.filter((issue) => issue.circuits.includes(data.circuitId ?? '')) } : {}) } }
  })
}

const heatingTableMarkup = (shape: RectShape): string => {
  const data = shape.heating!, b = heatingBounds(shape), rows = data.rows ?? []
  const natural = heatingTableSize(rows.length), factor = b.width / natural.width
  const xs = [12, 90, 350, 460, 590, 760, 930, 1100]
  const cell = (column: number, y: number, text: string, bold = false) => `<text x="${xs[column]}" y="${y}" font-weight="${bold ? 600 : 400}">${escape(text)}</text>`
  const number = (n: number, digits = 1) => n.toLocaleString('nl-BE', { maximumFractionDigits: digits })
  const limits = heatingDesignLimits(data.diameterMm, data.design), audit = data.audit
  const status = `CONCEPT · ${audit?.errors ?? 0} fouten · ${audit?.reviews ?? 0} te controleren punten`
  let content = `<rect width="${natural.width}" height="${natural.height}" fill="white" stroke="#000" stroke-width="1"/>`
  content += `<text x="12" y="28" font-size="23" font-weight="600">Kringen vloerverwarming</text><text x="12" y="53" font-size="18" font-weight="600">${escape(status)}</text>`
  content += ['Kring', 'Ruimte', 'Buis Ø', 'h.o.h.', 'Lus (m)', 'Aansl. (m)', 'Knip (m)', 'Debiet l/min'].map((v, i) => cell(i, 82, v, true)).join('')
  rows.forEach((row, index) => {
    const y = 112 + index * HEATING_TABLE_ROW_HEIGHT
    content += `<g class="heating-schedule-row" data-circuit-id="${escape(row.id)}"><path d="M 0 ${y - 23} H ${natural.width}" stroke="#ddd" stroke-width="1"/>`
    content += [row.id, wrapPaperText(row.room, 19, 248)[0] ?? '', `${number(row.diameterMm)} mm`, `${row.spacingMinMm && row.spacingMaxMm && Math.abs(row.spacingMinMm - row.spacingMaxMm) > .1 ? `${number(row.spacingMinMm)}–${number(row.spacingMaxMm)}` : number(row.spacingMaxMm ?? row.spacingMm)} mm`, number(row.loopM),
      number(row.supplyM + row.returnM), number(row.cutM ?? row.totalM), `${number(row.flowLmin, 2)}${row.flowEstimated !== false ? '*' : ''}`].map((v, i) => cell(i, y, v)).join('')
    const checks = row.checkMessages ?? [], h = row.hydraulics, floor = row.floor
    const pressure = h ? `Δp buis ${number(h.pipeKpa, 2)} + lokaal ${number(h.localKpa, 2)} + verdeler ${h.manifoldKpa === undefined ? '?' : number(h.manifoldKpa, 2)} = ${number(h.totalKpa, 2)} kPa${h.complete ? '' : ' (gedeeltelijk)'} · extra smoren ${number(h.balanceKpa ?? 0, 2)} kPa · v ${number(h.velocityMs, 2)} m/s` : 'Drukverlies: geldige buiswanddikte en watertemperatuur nodig.'
    content += `<text x="90" y="${y + 19}" font-size="15">${escape(wrapPaperText(pressure, 15, natural.width - 130)[0] ?? '')}</text>`
    const thermal = floor ? `Vraag ${floor.demandWm2 === undefined ? '—' : number(floor.demandWm2)} W/m² · vloer nodig ${floor.requiredSurfaceC === undefined ? '—' : number(floor.requiredSurfaceC)} °C · 1D-bovengrens ${floor.upperBoundWm2 === undefined ? '—' : number(floor.upperBoundWm2)} W/m² · fabrikant ${floor.systemOutputWm2 === undefined ? '—' : number(floor.systemOutputWm2)} W/m²` : 'Vloeropbouw nog invullen.'
    content += `<text x="90" y="${y + 37}" font-size="15">${escape(wrapPaperText(checks.length ? `${checks[0]}${checks.length > 1 ? ` (+${checks.length - 1})` : ''}` : thermal, 15, natural.width - 110)[0] ?? '')}</text></g>`
  })
  const y = 116 + rows.length * HEATING_TABLE_ROW_HEIGHT
  const totals = heatingScheduleTotals(rows)
  content += cell(0, y, 'Subtotaal', true) + cell(4, y, number(totals.loopM), true) + cell(5, y, number(totals.supplyM + totals.returnM), true)
    + cell(6, y, number(totals.cutM), true) + cell(7, y, number(totals.flowLmin, 2), true)
  const floor = rows[0]?.floor, worst = Math.max(0, ...rows.map((r) => r.hydraulics?.totalKpa ?? 0))
  const notes = [
    `Kniplengte = lus + aanvoer + retour + ${number(limits.allowanceM)} m opstanden/snijreserve per kring${data.design?.allowanceM === undefined ? ' (reserve nog invullen)' : ''}.`,
    `* Richtdebiet: ontbrekende ruimtelast = 50 W/m²; ΔT ${number(limits.deltaTK)} K${data.design?.deltaTK === undefined ? ' (aanname)' : ''}. Zonder *: ingevoerde ruimtelast en ΔT.`,
    `Buis: ${(data.design?.product ?? 'product nog bevestigen').slice(0, 55)} · min. R ${number(limits.minBendRadiusMm)} mm${data.design?.minBendRadiusMm === undefined ? ' (aanname 5×Ø)' : ''} · max. ${number(limits.maxCircuitLengthM)} m/kring${data.design?.maxCircuitLengthM === undefined ? ' (aanname)' : ''}.`,
    `Gekozen maximale legafstand ${number(data.spacingMm)} mm; rechte legafstanden staan per kring, bochten wijken plaatselijk af.`,
    `Drukverlies: water ${number(data.design?.fluidTemperatureC ?? ((data.design?.supplyTemperatureC ?? 35) - (data.design?.deltaTK ?? 5) / 2))} °C · Darcy–Weisbach/Colebrook · ruwheid ${number(data.design?.roughnessMm ?? .007, 3)} mm${data.design?.roughnessMm === undefined ? ' (aanname)' : ''} · lokale ζ ${data.design?.localLossK ?? '?'} · verdeler-Kv ${data.design?.manifoldKv ?? '?'}.`,
    `${rows.some((r) => r.hydraulics) ? `Zwaarste berekende kring ${number(worst, 2)} kPa` : 'Drukverlies nog niet berekend'}${rows.some((r) => !r.hydraulics?.complete) ? ' (nog gedeeltelijk)' : ''}; beschikbare druk aan verdeler ${data.design?.availablePressureKpa === undefined ? '?' : number(data.design.availablePressureKpa)} kPa. Extra smoordruk geldt bij deze bedrijfsdruk; zonder invoer t.o.v. de zwaarste kring. Geen ventielstand.`,
    `Vloer R (m²K/W): afwerking ${floor?.coveringR === undefined ? '?' : number(floor.coveringR, 3)} · dekvloer boven buis ${floor?.screedR === undefined ? '?' : number(floor.screedR, 3)} · isolatie ${floor?.insulationR === undefined ? '?' : number(floor.insulationR, 2)}.`,
    `Aanvoer ${floor?.supplyC ?? 35} °C · retour ${floor?.returnC ?? 30} °C · ruimte ${floor?.roomC ?? 20} °C · vloergrens ${floor?.surfaceLimitC ?? 29} °C; niet ingevulde temperaturen zijn aannames.`,
    `1D-vloermodel: optimistische afgiftebovengrens; buis- en spreidingsweerstand ontbreken. Fabrikantafgifte: ${(data.design?.systemReference ?? 'nog bevestigen').slice(0, 80)}.`,
    `Ontwerpverlies naar beneden voor debiet: ${data.design?.downwardDesignWm2 === undefined ? 'niet ingevuld, nog exclusief' : `${number(data.design.downwardDesignWm2)} W/m²`}.`,
    'Markeringen: geometriefouten en muurdoorvoeren. Warmteverlies, productwaarden, constructie, inregeling en volledige controlelijst verifiëren.'
  ]
  content += notes.flatMap((note) => wrapPaperText(note, 17, natural.width - 24)).map((note, i) => `<text x="12" y="${y + 28 + i * 20}" font-size="17">${escape(note)} </text>`).join('')
  return `<g class="shape heating-shape heating-table" data-shape-id="${escape(shape.id)}" transform="translate(${b.x} ${b.y}) scale(${factor})" fill="#111" font-family="Segoe UI, Arial, sans-serif" font-size="19">${content}</g>`
}

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)

export const heatingAnchors = (shape: RectShape): Point[] => {
  const b = heatingBounds(shape), data = shape.heating!
  const points = data.kind === 'manifold' && data.points ? data.points.map((p) => ({ x: b.x + p.x * b.width, y: b.y + p.y * b.height })) : data.kind === 'manifold' ? Array.from({ length: data.circuits }, (_, i) => {
    const x = b.x + b.width * (i + 1) / (data.circuits + 1)
    return [{ x: x - 2, y: b.y + b.height }, { x: x + 2, y: b.y + b.height }]
  }).flat() : heatingLayout(shape).circuits.flatMap((circuit) => [circuit.start, circuit.end])
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2, radians = (shape.rotation ?? 0) * Math.PI / 180
  return points.map((p) => {
    const x = (p.x - cx) * (shape.flipX ? -1 : 1), y = (p.y - cy) * (shape.flipY ? -1 : 1)
    return { x: cx + x * Math.cos(radians) - y * Math.sin(radians), y: cy + x * Math.sin(radians) + y * Math.cos(radians) }
  })
}

export const heatingMarkup = (shape: RectShape, selected = false, monochrome = false): string => {
  if (shape.heating?.kind === 'table') return heatingTableMarkup(shape)
  const data = shape.heating!, b = heatingBounds(shape), layout = heatingLayout(shape)
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2
  const transform = `translate(${cx} ${cy}) rotate(${shape.rotation ?? 0}) scale(${shape.flipX ? -1 : 1} ${shape.flipY ? -1 : 1}) translate(${-cx} ${-cy})`
  const red = monochrome ? '#000000' : '#b42318', blue = monochrome ? '#000000' : '#175cd3'
  const label = (x: number, y: number, value: string) => {
    const fontSize = data.kind === 'manifold' ? 16 : 20, lineHeight = fontSize * 1.2
    const lines = wrapPaperText(value, fontSize, Math.max(data.kind === 'manifold' ? 600 : 160, b.width))
    const halo = data.kind === 'manifold' ? 'stroke="none"' : 'stroke="white" stroke-width="4" paint-order="stroke"'
    return `<text x="${x}" y="${y - (lines.length - 1) * lineHeight}" fill="#111111" ${halo} font-family="Segoe UI, Arial, sans-serif" font-size="${fontSize}">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${escape(line)}</tspan>`).join('')}</text>`
  }
  let markup = ''
  if (data.kind === 'manifold') {
    const top = b.y + b.height * .35, bottom = b.y + b.height * .7
    markup = `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="3" fill="none" stroke="#555" stroke-width="1" pointer-events="all"/>`
    markup += `<path d="M ${b.x + 6} ${top} H ${b.x + b.width - 6}" stroke="${red}"/><path d="M ${b.x + 6} ${bottom} H ${b.x + b.width - 6}" stroke="${blue}"/>`
    for (let i = 0; i < data.circuits; i++) {
      const x = b.x + b.width * (i + 1) / (data.circuits + 1)
      const supply = data.points?.[2 * i], returning = data.points?.[2 * i + 1]
      const sx = supply ? b.x + supply.x * b.width : x - 2, rx = returning ? b.x + returning.x * b.width : x + 2
      markup += `<path d="M ${sx} ${top} V ${b.y + b.height}" stroke="${red}"/><path d="M ${rx} ${bottom} V ${b.y + b.height}" stroke="${blue}"/>`
    }
    markup += label(b.x, b.y - 10, `${data.name} · ${data.circuits} groepen${data.automatic ? ` · CONCEPT (${data.audit?.errors ?? 0} fouten)` : ''}`)
  } else {
    if (data.kind === 'zone') markup += `<rect class="heating-zone-boundary" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="none" stroke="#777" stroke-width="1" stroke-dasharray="6 5"/>`
    for (const [index, circuit] of layout.circuits.entries()) {
      const color = data.kind === 'pipe' && data.pipeRole === 'return' ? blue : red
      markup += `<path class="heating-circuit" data-circuit="${index + 1}" d="${circuit.path}" stroke="${color}"${data.automatic && data.pipeRole === 'return' ? ' stroke-dasharray="8 4"' : ''}/>`
      if (data.kind === 'zone') {
        markup += `<circle cx="${circuit.start.x}" cy="${circuit.start.y}" r="3" fill="${red}" stroke="none"/><circle cx="${circuit.end.x}" cy="${circuit.end.y}" r="3" fill="${blue}" stroke="none"/>`
        markup += `<text x="${circuit.start.x + 8}" y="${circuit.start.y + 18}" fill="#111111" stroke="white" stroke-width="3" paint-order="stroke" font-family="Segoe UI, Arial, sans-serif" font-size="16">${index + 1}</text>`
      }
    }
    const details = data.kind === 'zone' ? `${data.name} · ${data.circuits} lus(sen) · h.o.h. ${data.spacingMm} mm · Ø${data.diameterMm} · ${layout.lengthM.toFixed(1)} m` : `${data.name} · Ø${data.diameterMm} · ${layout.lengthM.toFixed(1)} m`
    if (!data.automatic || data.pipeRole === 'loop') markup += label(b.x, b.y - 10, data.automatic ? data.circuitId ?? data.name : layout.warning ?? details)
  }
  const markers = (data.pipeRole === 'loop' ? data.checks ?? [] : []).filter((issue) => issue.point && issue.circuits[0] === data.circuitId).map((issue) => {
    const p = issue.point!, color = monochrome ? '#000' : issue.severity === 'error' ? '#b42318' : '#9a6700'
    return `<g class="heating-check-marker" data-check="${escape(issue.code)}" data-severity="${issue.severity}"><title>${escape(issue.message)}</title><circle cx="${p.x}" cy="${p.y}" r="8" fill="white" stroke="${color}" stroke-width="2"/><path d="M ${p.x} ${p.y - 4} V ${p.y + 1} M ${p.x} ${p.y + 4} h .1" stroke="${color}" stroke-width="2"/></g>`
  }).join('')
  return `<g class="shape heating-shape heating-${data.kind}" data-shape-id="${escape(shape.id)}" data-selected="${selected}" transform="${transform}" fill="none" stroke-width="${shape.strokeWidth ?? 2}" stroke-linecap="round" stroke-linejoin="round"><title>${escape(`${data.name} · ${data.roomName ?? ''} · ${layout.lengthM.toFixed(1)} m`)}</title>${markup}</g>${markers}`
}


/** A spreadsheet-safe workshop schedule; geometry checks remain explicit. */
export const heatingScheduleCSV = (rows: readonly HeatingScheduleRow[], audit?: HeatingAudit): string => {
  const text = (value: string | number) => {
    const raw = String(value), safe = typeof value === 'number' || /^-?\d+(,\d+)?$/.test(raw) ? raw : raw.replace(/^\s*[=+@-]/, "'$&")
    return `"${safe.replace(/"/g, '""')}"`
  }
  const decimal = (value: number) => value.toFixed(2).replace('.', ',')
  const totals = heatingScheduleTotals(rows)
  const records: (string | number)[][] = [
    ['CONCEPT — controle vóór uitvoering vereist'],
    ['Kring', 'Ruimte', 'Buis Ø mm', 'Legafstand mm', 'Oppervlakte m²', 'Lus m', 'Aanvoer m', 'Retour m', 'Getekend m', 'Reserve m', 'Kniplengte m', 'Debiet l/min', 'Debietbasis', 'Δp buis kPa', 'Δp lokaal kPa', 'Δp verdeler kPa', 'Δp totaal kPa', 'Extra smoordruk kPa', 'Kv equivalente extra weerstand', 'Snelheid m/s', 'Reynolds', 'Drukberekening', 'Drukmarge zwaarste kring kPa', 'R afwerking m²K/W', 'R dekvloer m²K/W', 'R isolatie m²K/W', 'Warmtevraag W/m²', 'Vloer benodigd °C', '1D afgiftebovengrens W/m²', 'Fabrikantafgifte W/m²', '1D bovengrens benedenverlies W/m²', 'Werkelijke min. legafstand mm', 'Werkelijke max. legafstand mm', 'Controlepunten'],
    ...rows.map((r) => [r.id, r.room, r.diameterMm, r.spacingMm, decimal(r.areaM2), decimal(r.loopM), decimal(r.supplyM), decimal(r.returnM), decimal(r.totalM),
      decimal(r.allowanceM ?? 0), decimal(r.cutM ?? r.totalM), decimal(r.flowLmin), r.flowEstimated !== false ? 'Richtwaarde (aannames)' : 'Ingevoerde ruimtelast en ΔT', ...[r.hydraulics?.pipeKpa, r.hydraulics?.localKpa, r.hydraulics?.manifoldKpa, r.hydraulics?.totalKpa, r.hydraulics?.balanceKpa, r.hydraulics?.targetKv, r.hydraulics?.velocityMs, r.hydraulics?.reynolds].map((n) => n === undefined ? '' : decimal(n)), r.hydraulics?.complete ? 'Buis + lokale verliezen + verdeler' : 'Gedeeltelijk / ontbrekend', ...[r.hydraulics?.pumpMarginKpa, r.floor?.coveringR, r.floor?.screedR, r.floor?.insulationR, r.floor?.demandWm2, r.floor?.requiredSurfaceC, r.floor?.upperBoundWm2, r.floor?.systemOutputWm2, r.floor?.downwardUpperWm2].map((n) => n === undefined ? '' : decimal(n)), decimal(r.spacingMinMm ?? r.spacingMm), decimal(r.spacingMaxMm ?? r.spacingMm), (r.checkMessages ?? []).join(' | ')]),
    ['TOTAAL', '', '', '', decimal(totals.areaM2), decimal(totals.loopM), decimal(totals.supplyM), decimal(totals.returnM),
      decimal(totals.totalM), decimal(totals.allowanceM), decimal(totals.cutM), decimal(totals.flowLmin)],
    [], ['Algemene controles'], ...(audit?.issues.filter((i) => !i.circuits.length).map((i) => [i.message]) ?? [])
  ]
  return '\uFEFF' + records.map((row) => row.map(text).join(';')).join('\r\n')
}
