import type { SolarInstallation, SolarPanel } from '../solar-installation.js'
import type { LineShape, Point, Shape, SymbolShape, TextShape } from '../model/types.js'
import { oneWireLayoutBounds, oneWireSymbolConnectionAnchors, positionOneWireSymbolForConnection } from './onewire-connections.js'
import { oneWireSymbolScaleFor, oneWireSymbolStrokeWidthFor } from './onewire-symbol-nodes.js'
import { paperTextScale } from './page-layout.js'
import { ONE_WIRE_CONDUCTOR_STROKE_WIDTH } from '../constants.js'
import { isOneWireRailShape } from './onewire-regeneration.js'

export const buildSolarInstallation = (
  installation: SolarInstallation,
  railId: string | undefined,
  tap: Point,
  nextId: () => string,
  direction: 'top' | 'bottom' = 'top'
): Shape[] => {
  const groupId = `solar-installation-${nextId()}`
  const shapes: Shape[] = []
  const disconnected = installation.kind === 'panels'
  let connection = tap
  const text = (content: string, x: number, y: number): TextShape => ({
    id: nextId(), kind: 'text', text: content, position: { x, y }, scale: paperTextScale(2.5), groupId,
    ...(railId ? { oneWireRailId: railId } : {})
  })
  const add = (path: string, name: string, description: string, quantity?: string) => {
    const scale = oneWireSymbolScaleFor(path) ?? 1.35
    let shape: SymbolShape = {
      id: nextId(), kind: 'symbol', path, name, scale, groupId, ...(railId ? { oneWireRailId: railId } : {}),
      strokeWidth: oneWireSymbolStrokeWidthFor(path, scale),
      position: { x: 0, y: 0 },
      ...(name === 'Omvormer' && direction === 'bottom' ? { rotation: 180 } : {}),
      electrical: { role: 'load', oneWireEligible: true, solar: installation }
    }
    if (/Automaat\.svg$/.test(path) && installation.kind !== 'panels') {
      shape.electrical = { ...shape.electrical!, role: 'protection', breakerCurrentA: installation.breakerCurrentA,
        breakerCurve: 'C', poles: installation.phases === 3 ? 4 : 2,
        phaseConfiguration: installation.phases === 3 ? 'L1+L2+L3+N' : 'L1+N' }
      shape.symbolTextOverrides = { 'rated-current': `C${installation.breakerCurrentA}A`,
        poles: `${shape.electrical.poles}P`, phase: '', 'residual-current': '' }
    }
    const placed = positionOneWireSymbolForConnection(shape, connection, direction, undefined, 48)
    shape = placed.symbol
    const body = oneWireLayoutBounds(shape)
    const row: (SymbolShape | TextShape)[] = [shape, text(description, body.x + body.width + 24, body.y + 20)]
    if (quantity) row.push(text(quantity, body.x + body.width + 24, body.y - 10))
    if (direction === 'top' && !disconnected) {
      const bottom = Math.max(...row.map(oneWireLayoutBounds).map((box) => box.y + box.height))
      const dy = Math.min(0, connection.y - 24 - bottom)
      for (const item of row) item.position.y += dy
      placed.connection.y += dy
    }
    if (!disconnected) shapes.push({
      id: nextId(), kind: 'line', start: { ...connection }, end: placed.connection, groupId, oneWireRailId: railId,
      strokeWidth: ONE_WIRE_CONDUCTOR_STROKE_WIDTH, connection: { kind: 'wire', showLabel: false },
      energyFlow: 'reverse', energySource: 'generator'
    })
    shapes.push(...row)
    const outgoing = oneWireSymbolConnectionAnchors(shape).find((anchor) => anchor.side === direction)?.point
    if (!outgoing) return
    const bounds = row.map(oneWireLayoutBounds)
    connection = { x: outgoing.x, y: direction === 'top'
      ? Math.min(outgoing.y, ...bounds.map((box) => box.y))
      : Math.max(outgoing.y, ...bounds.map((box) => box.y + box.height)) }
    if (Math.abs(connection.y - outgoing.y) > 1e-8) shapes.push({
      id: nextId(), kind: 'line', start: outgoing, end: { ...connection }, groupId, oneWireRailId: railId,
      strokeWidth: ONE_WIRE_CONDUCTOR_STROKE_WIDTH, connection: { kind: 'wire', showLabel: false },
      energyFlow: 'reverse', energySource: 'generator'
    })
  }
  if (installation.kind !== 'panels') {
    add('symbols/Protection devices/Automaat.svg', 'PV automaat', 'PV')
    add('symbols/Photovoltaic devices (≠AREI)/Inverter.svg', 'Omvormer',
      [installation.inverterManufacturer, installation.inverterModel,
        `${installation.inverterPowerW / 1000} kW AC · ${installation.phases} fase(n)`,
        installation.maxDcVoltageV ? `Max DC ${installation.maxDcVoltageV} V` : '',
        installation.mpptCount ? `${installation.mpptCount} MPPT` : ''].filter(Boolean).join('\n'))
  }
  if (installation.kind !== 'inverter') {
    const panel = installation.panel
    const total = panel.powerWp * installation.panelCount / 1000
    add('symbols/Photovoltaic devices (≠AREI)/Solar panel.svg', 'Zonnepanelen',
      [panel.manufacturer, panel.model, `${installation.stringCount} string(s) van ${installation.panelCount / installation.stringCount} panelen`,
        ...solarElectricalLines(panel)].filter(Boolean).join('\n'),
      `${installation.panelCount} x ${panel.powerWp} Wp = ${Number(total.toFixed(3))} kWp`)
  }
  return shapes
}

const solarElectricalLines = (panel: SolarPanel) => [
  panel.vmpV !== undefined ? `Vmp ${panel.vmpV} V${panel.impA !== undefined ? ` · Imp ${panel.impA} A` : ''} (STC)` : panel.impA !== undefined ? `Imp ${panel.impA} A (STC)` : '',
  panel.vocV !== undefined ? `Voc ${panel.vocV} V${panel.iscA !== undefined ? ` · Isc ${panel.iscA} A` : ''} (STC)` : panel.iscA !== undefined ? `Isc ${panel.iscA} A (STC)` : ''
]

export const solarInstallationPlacement = (
  shapes: readonly Shape[],
  occupied: readonly Shape[],
  rail: LineShape | undefined,
  area: { x: number; y: number; width: number; height: number }
): number | undefined => {
  const boxes = shapes.map(oneWireLayoutBounds)
  const minX = Math.min(...boxes.map((box) => box.x))
  const maxX = Math.max(...boxes.map((box) => box.x + box.width))
  if (boxes.some((box) => box.y < area.y || box.y + box.height > area.y + area.height)) return undefined
  const obstacles = occupied.filter((shape) => !shape.hidden && shape.id !== rail?.id).map(oneWireLayoutBounds)
  const otherRails = occupied.filter((shape): shape is LineShape =>
    shape.kind === 'line' && shape.id !== rail?.id && !shape.hidden && isOneWireRailShape(shape))
  const tapX = shapes.find((shape): shape is LineShape => shape.kind === 'line')?.start.x ?? minX
  const start = Math.max(0, area.x - minX)
  for (let dx = start; maxX + dx <= area.x + area.width; dx += 24) {
    if (rail) {
      const railLeft = Math.min(rail.start.x, rail.end.x, tapX + dx - 20)
      const railRight = Math.max(rail.start.x, rail.end.x, tapX + dx + 20)
      if (otherRails.some((other) => Math.abs(other.start.y - rail.start.y) < 16 &&
        Math.max(other.start.x, other.end.x) + 16 > railLeft && Math.min(other.start.x, other.end.x) - 16 < railRight)) continue
    }
    if (boxes.every((box) => obstacles.every((other) =>
      box.x + dx + box.width + 16 <= other.x || box.x + dx >= other.x + other.width + 16 ||
      box.y + box.height + 16 <= other.y || box.y >= other.y + other.height + 16))) return dx
  }
  return undefined
}
