import type { Point, RectShape, Shape } from './model/types.js'
import type { HeatingScheduleRow } from './heating-plan.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { heatingDesignLimits, type HeatingDesignInputs } from './heating-design.js'

export type HeatingCheck = { code: string; severity: 'error' | 'review'; circuits: string[]; message: string; point?: Point }
export type HeatingAudit = { errors: number; reviews: number; issues: HeatingCheck[] }
export const sanitizeHeatingAudit = (value: unknown): HeatingAudit | undefined => {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { issues?: unknown }).issues)) return
  const issues = ((value as { issues: unknown[] }).issues).slice(0, 500).flatMap((item): HeatingCheck[] => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    if (typeof raw.code !== 'string' || typeof raw.message !== 'string' || (raw.severity !== 'error' && raw.severity !== 'review') || !Array.isArray(raw.circuits)) return []
    const p = raw.point as Point | undefined
    return [{ code: raw.code.slice(0, 60), message: raw.message.slice(0, 500), severity: raw.severity,
      circuits: raw.circuits.filter((id): id is string => typeof id === 'string').slice(0, 24),
      ...(p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { point: { x: p.x, y: p.y } } : {}) }]
  })
  return { issues, errors: issues.filter((i) => i.severity === 'error').length, reviews: issues.filter((i) => i.severity === 'review').length }
}
type Box = { x: number; y: number; width: number; height: number }
const project = (p: Point, a: Point, b: Point): Point => {
  const x = b.x - a.x, y = b.y - a.y, d = x * x + y * y
  const t = d ? Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.y - a.y) * y) / d)) : 0
  return { x: a.x + t * x, y: a.y + t * y }
}
const separation = (a: Point, b: Point, c: Point, d: Point) => {
  const x = b.x - a.x, y = b.y - a.y, u = d.x - c.x, v = d.y - c.y, determinant = x * v - y * u
  if (Math.abs(determinant) > 1e-10) {
    const t = ((c.x - a.x) * v - (c.y - a.y) * u) / determinant, s = ((c.x - a.x) * y - (c.y - a.y) * x) / determinant
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return { distance: 0, point: { x: a.x + t * x, y: a.y + t * y } }
  }
  return [[a, project(a, c, d)], [b, project(b, c, d)], [c, project(c, a, b)], [d, project(d, a, b)]].map(([p, q]) =>
    ({ distance: Math.hypot(p.x - q.x, p.y - q.y), point: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } })).sort((p, q) => p.distance - q.distance)[0]
}

export const checkHeatingPlan = (shapes: readonly Shape[], rows: readonly HeatingScheduleRow[], design?: HeatingDesignInputs,
  obstacles: Box[] = []): HeatingAudit => {
  const pipes = shapes.filter((s): s is RectShape => s.kind === 'rect' && s.heating?.kind === 'pipe' && Boolean(s.heating.circuitId))
  const issues: HeatingCheck[] = [], seen = new Set<string>()
  const add = (key: string, issue: HeatingCheck) => { if (!seen.has(key)) { seen.add(key); issues.push(issue) } }
  const manifold = shapes.find((s) => s.kind === 'rect' && s.heating?.kind === 'manifold') as RectShape | undefined
  const scale = manifold?.heating?.drawingScale ?? pipes[0]?.heating?.drawingScale ?? 100
  const inManifoldZone = (p: Point) => manifold && p.x >= Math.min(manifold.start.x, manifold.end.x) - 1600 / scale &&
    p.x <= Math.max(manifold.start.x, manifold.end.x) + 1600 / scale && p.y >= Math.min(manifold.start.y, manifold.end.y) - 1600 / scale &&
    p.y <= Math.max(manifold.start.y, manifold.end.y) + 1600 / scale
  if (manifold?.heating?.automatic) for (let i = 0; i < manifold.heating.circuits; i++) {
    const id = `VV${String(i + 1).padStart(2, '0')}`
    if (!rows.some((row) => row.id === id)) add(`${id}:absent`, { code: 'continuity', severity: 'error', circuits: [id], message: `${id}: volledige kring ontbreekt bij de verdeler.` })
  }
  const geometries = pipes.map(heatingPipeGeometry)
  for (const [index, pipe] of pipes.entries()) {
    const data = pipe.heating!, id = data.circuitId!, geometry = geometries[index], limits = heatingDesignLimits(data.diameterMm, design ?? data.design)
    if (data.manualRoute) add(`${id}:manual`, { code: 'manual', severity: 'review', circuits: [id], message: `${id}: handmatig aangepast traject; legafstand, volledige vloerdekking en doorvoeren controleren.` })
    for (const bend of geometry.bends) if (bend.radiusMm + .1 < limits.minBendRadiusMm) {
      const severity = inManifoldZone(bend.point) ? 'review' : 'error'
      add(`${id}:bend:${severity}`, { code: 'bend', severity, circuits: [id], point: bend.point,
        message: `${id}: bocht R${bend.radiusMm.toFixed(0)} mm < ingestelde R${limits.minBendRadiusMm} mm${severity === 'review' ? ' (aansluitzone verdeler)' : ''}.` })
    }
    for (const piece of geometry.pieces) for (const box of obstacles) {
      const radius = data.diameterMm * 4 / data.drawingScale
      // Sampling step is bounded by half a pipe diameter, including the rendered arcs.
      const n = Math.max(1, Math.ceil(Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y) / Math.max(.2, radius)))
      for (let i = 0; i <= n; i++) {
        const p = { x: piece.a.x + (piece.b.x - piece.a.x) * i / n, y: piece.a.y + (piece.b.y - piece.a.y) * i / n }
        if (p.x > box.x - radius && p.x < box.x + box.width + radius && p.y > box.y - radius && p.y < box.y + box.height + radius) {
          add(`${id}:obstacle`, { code: 'obstacle', severity: 'error', circuits: [id], point: p, message: `${id}: buis raakt een symbool of de vrije ruimte eromheen.` }); break
        }
      }
    }
  }
  // Spatial buckets avoid comparing every piece of every pipe against the whole drawing.
  type Entry = { pipe: number; piece: number }
  const buckets = new Map<string, Entry[]>(), tested = new Set<string>(), bucket = 4000 / scale
  for (const [i, geometry] of geometries.entries()) for (const [j, piece] of geometry.pieces.entries()) {
    const diameter = pipes[i].heating!.diameterMm * 8 / scale
    const minX = Math.floor((Math.min(piece.a.x, piece.b.x) - diameter) / bucket), maxX = Math.floor((Math.max(piece.a.x, piece.b.x) + diameter) / bucket)
    const minY = Math.floor((Math.min(piece.a.y, piece.b.y) - diameter) / bucket), maxY = Math.floor((Math.max(piece.a.y, piece.b.y) + diameter) / bucket)
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const key = `${x},${y}`, entries = buckets.get(key) ?? []
      for (const other of entries) {
        if (other.pipe === i && Math.abs(geometries[i].pieces[other.piece].primitive - piece.primitive) <= 1) continue
        const pair = `${other.pipe}:${other.piece}:${i}:${j}`
        if (tested.has(pair)) continue
        tested.add(pair)
        const a = geometries[other.pipe].pieces[other.piece], b = piece
        const distance = separation(a.a, a.b, b.a, b.b), first = pipes[other.pipe].heating!, second = pipes[i].heating!
        const minimum = (first.diameterMm + second.diameterMm) * 4 / scale
        if (other.pipe === i) {
          const pa = project(distance.point, a.a, a.b), pb = project(distance.point, b.a, b.b)
          const alongA = a.offset + Math.hypot(pa.x - a.a.x, pa.y - a.a.y), alongB = b.offset + Math.hypot(pb.x - b.a.x, pb.y - b.a.y)
          // Smooth neighbouring pieces share a physical tube envelope, even when a tiny
          // fillet introduces more than one primitive between them. This is not a crossing.
          if (Math.abs(alongA - alongB) < minimum * 2.5) continue
        }
        if (distance.distance + 8 / scale >= minimum) continue
        const sameCircuit = first.circuitId === second.circuitId
        const endsA = [geometries[other.pipe].points[0], geometries[other.pipe].points.at(-1)!]
        const endsB = [geometries[i].points[0], geometries[i].points.at(-1)!]
        if (sameCircuit && other.pipe !== i && endsA.some((p) => endsB.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6 && Math.hypot(p.x - distance.point.x, p.y - distance.point.y) < minimum * 1.5))) continue
        const ids = [...new Set([first.circuitId!, second.circuitId!])].sort(), severity = inManifoldZone(distance.point) ? 'review' : 'error'
        add(`collision:${ids.join(':')}:${severity}`, { code: 'collision', severity, circuits: ids, point: distance.point,
          message: `${ids.join(' / ')}: kruising of onvoldoende ruimte tussen buizen${severity === 'review' ? ' bij de verdeler' : ''}.` })
      }
      entries.push({ pipe: i, piece: j }); buckets.set(key, entries)
    }
  }
  for (const row of rows) {
    const limit = heatingDesignLimits(row.diameterMm, design)
    const h = row.hydraulics, floor = row.floor
    if (design?.pipeWallMm !== undefined && row.diameterMm - 2 * design.pipeWallMm <= 0) add(`${row.id}:diameter`, { code: 'hydraulic-diameter', severity: 'error', circuits: [row.id], message: `${row.id}: wanddikte laat geen vrije binnendiameter over.` })
    if (h?.transition) add(`${row.id}:transition`, { code: 'flow-regime', severity: 'review', circuits: [row.id], message: `${row.id}: overgangsstroming (Re ${h.reynolds.toFixed(0)}); drukverlies is een conservatieve schatting.` })
    if (h && h.velocityMs > (design?.maxVelocityMs ?? .5)) add(`${row.id}:velocity`, { code: 'velocity', severity: design?.maxVelocityMs === undefined ? 'review' : 'error', circuits: [row.id], message: `${row.id}: snelheid ${h.velocityMs.toFixed(2)} m/s > ${design?.maxVelocityMs ?? .5} m/s${design?.maxVelocityMs === undefined ? ' (planaanname)' : ' (ontwerpgrens)'}.` })
    if (h?.pumpMarginKpa !== undefined && h.pumpMarginKpa < -.01) add('pump', { code: 'pump-head', severity: 'error', circuits: [], message: `Beschikbare verschildruk aan de verdeler is ${(-h.pumpMarginKpa).toFixed(1)} kPa te laag voor de zwaarste kring${h.complete ? '' : ' (nog zonder alle lokale verliezen)'}.` })
    if (floor) {
      if (floor.returnC <= floor.roomC) add('temperature', { code: 'temperature', severity: 'error', circuits: [], message: 'Retourtemperatuur moet boven de ruimtetemperatuur liggen voor deze verwarmingsberekening.' })
      if (floor.coveringR !== undefined && floor.coveringR > .15) add('covering', { code: 'floor-covering', severity: 'review', circuits: [], message: `Vloerafwerking R ${floor.coveringR.toFixed(3)} m²K/W is hoger dan de gebruikelijke ontwerpreferentie 0,15; systeem en afwerking verifiëren.` })
      if (floor.insulationR !== undefined && floor.insulationR < (design?.minimumInsulationR ?? 1.25)) add('insulation', { code: 'floor-insulation', severity: design?.minimumInsulationR === undefined ? 'review' : 'error', circuits: [], message: `Isolatie R ${floor.insulationR.toFixed(2)} m²K/W < ${design?.minimumInsulationR ?? 1.25}${design?.minimumInsulationR === undefined ? ' (planaanname; projectsituatie invullen)' : ' (ontwerpminimum)'}.` })
      if (floor.requiredSurfaceC !== undefined && floor.requiredSurfaceC > floor.surfaceLimitC + .01) add(`${row.id}:surface`, { code: 'floor-surface', severity: 'error', circuits: [row.id], message: `${row.id}: benodigde gemiddelde vloertemperatuur ${floor.requiredSurfaceC.toFixed(1)} °C > grens ${floor.surfaceLimitC} °C.` })
      if (floor.demandWm2 !== undefined && floor.upperBoundWm2 !== undefined && floor.demandWm2 > floor.upperBoundWm2 + .1) add(`${row.id}:capacity`, { code: 'floor-capacity', severity: 'error', circuits: [row.id], message: `${row.id}: ${floor.demandWm2.toFixed(1)} W/m² gevraagd; zelfs de optimistische 1D-bovengrens is ${floor.upperBoundWm2.toFixed(1)} W/m².` })
      if (floor.outputStale) add('output-stale', { code: 'system-output', severity: 'review', circuits: [], message: 'Fabrikantafgifte heeft geen actuele onderbouwing of past niet meer bij de ingevoerde legafstand, temperaturen en vloeropbouw.' })
      if (floor.demandWm2 !== undefined && floor.systemOutputWm2 !== undefined && floor.demandWm2 > floor.systemOutputWm2 + .1) add(`${row.id}:output`, { code: 'system-capacity', severity: 'error', circuits: [row.id], message: `${row.id}: ${floor.demandWm2.toFixed(1)} W/m² gevraagd > bevestigde systeemafgifte ${floor.systemOutputWm2.toFixed(1)} W/m².` })
    }
    if ((row.cutM ?? row.totalM) > limit.maxCircuitLengthM + .05) add(`${row.id}:length`, { code: 'length', severity: 'error', circuits: [row.id],
      message: `${row.id}: ${(row.cutM ?? row.totalM).toFixed(1)} m inclusief reserve > grens ${limit.maxCircuitLengthM} m.` })
    const parts = pipes.filter((s) => s.heating?.circuitId === row.id)
    const get = (role: string) => parts.find((s) => s.heating?.pipeRole === role)
    const loop = get('loop'), supply = get('supply'), returning = get('return')
    if (!loop || !supply || !returning) {
      add(`${row.id}:missing`, { code: 'continuity', severity: 'error', circuits: [row.id], message: `${row.id}: lus, aanvoer of retour ontbreekt.` }); continue
    }
    const l = heatingPipeGeometry(loop).points, s = heatingPipeGeometry(supply).points, r = heatingPipeGeometry(returning).points
    if (manifold) {
      const index = Number(row.id.replace(/^VV/, '')) - 1, ports = manifold.heating?.points
      const x = Math.min(manifold.start.x, manifold.end.x), y = Math.min(manifold.start.y, manifold.end.y)
      const width = Math.abs(manifold.end.x - manifold.start.x), height = Math.abs(manifold.end.y - manifold.start.y)
      const cx = x + width / 2, cy = y + height / 2, angle = (manifold.rotation ?? 0) * Math.PI / 180
      const port = (offset: number) => {
        const p = ports?.[index * 2 + offset]
        if (!p) return
        const dx = (p.x * width - width / 2) * (manifold.flipX ? -1 : 1), dy = (p.y * height - height / 2) * (manifold.flipY ? -1 : 1)
        return { x: cx + dx * Math.cos(angle) - dy * Math.sin(angle), y: cy + dx * Math.sin(angle) + dy * Math.cos(angle) }
      }
      const a = port(0), b = port(1)
      if (!a || !b || Math.hypot(a.x - s[0].x, a.y - s[0].y) > .01 || Math.hypot(b.x - r.at(-1)!.x, b.y - r.at(-1)!.y) > .01) {
        add(`${row.id}:manifold`, { code: 'continuity', severity: 'error', circuits: [row.id], point: s[0], message: `${row.id}: aanvoer of retour sluit niet aan op de verdeler.` })
      }
    } else add(`${row.id}:manifold`, { code: 'continuity', severity: 'error', circuits: [row.id], message: `${row.id}: verdeler ontbreekt.` })
    if (Math.hypot(l[0].x - s.at(-1)!.x, l[0].y - s.at(-1)!.y) > .01 || Math.hypot(l.at(-1)!.x - r[0].x, l.at(-1)!.y - r[0].y) > .01) {
      add(`${row.id}:endpoints`, { code: 'continuity', severity: 'error', circuits: [row.id], message: `${row.id}: aansluitingen sluiten niet aan op de lus.` })
    }
  }
  const penetrations = shapes.filter((s) => s.generationKey?.startsWith('heating-penetration:'))
  if (penetrations.length) add('wall', { code: 'penetration', severity: 'review', circuits: [], message: `${penetrations.length} muurdoorvoeren: locatie, constructie en bescherming controleren.` })
  if (!design?.product || design.minBendRadiusMm === undefined) add('pipe-data', { code: 'product', severity: 'review', circuits: [], message: 'Buisproduct en minimale buigradius uit het productblad zijn nog niet bevestigd.' })
  if (design?.allowanceM === undefined) add('allowance', { code: 'allowance', severity: 'review', circuits: [], message: 'Opstanden bij de verdeler en snijreserve zijn nog niet ingevuld.' })
  if (rows.some((row) => row.flowEstimated !== false)) add('heat-load', { code: 'hydraulics', severity: 'review', circuits: [], message: 'Debiet is een richtwaarde: vul ruimtelasten en ontwerp-ΔT in voor een ontwerpdebiet.' })
  if (rows.some((r) => !r.hydraulics)) add('hydraulic-input', { code: 'hydraulic-input', severity: 'review', circuits: [], message: 'Drukverlies: vul een geldige buiswanddikte en watertemperatuur in.' })
  else if (rows.some((r) => !r.hydraulics?.complete)) add('hydraulic-local', { code: 'hydraulic-input', severity: 'review', circuits: [], message: 'Drukverlies is gedeeltelijk: bevestig ruwheid, totale lokale ζ-verliezen en de Kv van het volledige verdelertraject per kring.' })
  if (design?.availablePressureKpa === undefined) add('pressure', { code: 'pump-head', severity: 'review', circuits: [], message: 'Beschikbare verschildruk aan de verdeler is nog niet ingevuld; pomp en toevoerleiding zijn niet gecontroleerd.' })
  if (rows.some((r) => r.floor?.coveringR === undefined || r.floor?.screedR === undefined || r.floor?.insulationR === undefined)) add('floor-input', { code: 'floor-input', severity: 'review', circuits: [], message: 'Vloeropbouw: vul dikte en λ van afwerking, dekvloer boven de buis en isolatie in.' })
  if (design?.downwardDesignWm2 === undefined) add('downward', { code: 'floor-downward', severity: 'review', circuits: [], message: 'Debiet is nog exclusief ontwerpverlies naar beneden; vul dit verlies in (0 indien onderbouwd).' })
  if (rows.some((r) => r.floor?.systemOutputWm2 === undefined)) add('system', { code: 'system', severity: 'review', circuits: [], message: 'De 1D-vloerberekening geeft een bovengrens; bevestig fabrikantafgifte bij de actuele buisafstand en vloeropbouw. Inregeling op locatie blijft nodig.' })
  else add('commissioning', { code: 'commissioning', severity: 'review', circuits: [], message: 'Berekende drukverliezen en extra smoordruk zijn ontwerpwaarden; werkelijke ventielinstelling en debieten op locatie inregelen.' })
  issues.sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'))
  return { errors: issues.filter((i) => i.severity === 'error').length, reviews: issues.filter((i) => i.severity === 'review').length, issues }
}
