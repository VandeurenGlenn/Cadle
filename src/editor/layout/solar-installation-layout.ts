import { defaultPvCableForBreaker, solarStringPanelCounts, type SolarInstallation, type SolarPanel } from '../solar-installation.js'
import type { LineShape, Point, Shape, SymbolShape, TextShape } from '../model/types.js'
import { oneWireLayoutBounds, oneWireSymbolConnectionAnchors, positionOneWireSymbolForConnection } from './onewire-connections.js'
import { oneWireSymbolScaleFor, oneWireSymbolStrokeWidthFor } from './onewire-symbol-nodes.js'
import { paperTextScale } from './page-layout.js'
import { ONE_WIRE_CONDUCTOR_STROKE_WIDTH } from '../constants.js'
import { isOneWireRailShape } from './onewire-regeneration.js'
import { circuitDefaults, defaultHasProtectiveConductor } from '../circuit-defaults.js'
import { presentConnectionLabels } from './connection-label-presentation.js'
import { PROTECTION_TEXT_SIZE, PROTECTION_TEXT_WEIGHT } from './protection-label-layout.js'

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
  let solarBreakerId: string | undefined
  const text = (content: string, x: number, y: number): TextShape => ({
    id: nextId(), kind: 'text', text: content, position: { x, y }, scale: paperTextScale(2),
    fontWeight: 400, groupId,
    ...(railId ? { oneWireRailId: railId } : {})
  })
  const add = (path: string, name: string, description: string, quantity?: string) => {
    const scale = name === 'Zonnepanelen' ? 2.4 : oneWireSymbolScaleFor(path) ?? 1.35
    let shape: SymbolShape = {
      id: nextId(), kind: 'symbol', path, name, scale, groupId, ...(railId ? { oneWireRailId: railId } : {}),
      strokeWidth: oneWireSymbolStrokeWidthFor(path, scale),
      position: { x: 0, y: 0 },
      ...(name === 'Omvormer' && direction === 'bottom' ? { rotation: 180 } : {}),
      electrical: { role: 'load', oneWireEligible: true, solar: installation }
    }
    if (/Automaat\.svg$/.test(path) && installation.kind !== 'panels') {
      const defaultCable = defaultPvCableForBreaker(installation.breakerCurrentA)
      shape.electrical = { ...shape.electrical!, role: 'protection', breakerCurrentA: installation.breakerCurrentA,
        breakerCurve: 'C', poles: installation.phases === 3 ? 4 : 2,
        phaseConfiguration: installation.phases === 3 ? 'L1+L2+L3+N' : 'L1+N',
        ...(defaultCable ? { cableConductors: defaultCable.conductors, cableSectionMm2: defaultCable.sectionMm2,
          hasProtectiveConductor: true, cableType: 'none' as const } : {}) }
      shape.symbolTextOverrides = { 'rated-current': `C${installation.breakerCurrentA}A`,
        poles: `${shape.electrical.poles}P`, phase: '', 'residual-current': '' }
    }
    if (name === 'PV automaat') solarBreakerId = shape.id
    const placed = positionOneWireSymbolForConnection(shape, connection, direction, undefined,
      name === 'Omvormer' ? 300 : 48)
    shape = placed.symbol
    const body = oneWireLayoutBounds(shape)
    const row: (SymbolShape | TextShape)[] = [shape]
    if (description) row.push({ ...text(description, body.x + body.width + 24, body.y + 20),
      sourceLink: { kind: 'device', id: shape.id, role: name === 'Zonnepanelen' ? 'solar-panel-description' : 'solar-inverter-description' } })
    if (quantity) row.push({ ...text(quantity, body.x + body.width + 24, body.y - 10),
      sourceLink: { kind: 'device', id: shape.id, role: 'solar-panel-quantity' } })
    if (direction === 'top' && !disconnected) {
      const bottom = Math.max(...row.map(oneWireLayoutBounds).map((box) => box.y + box.height))
      const dy = Math.min(0, connection.y - 24 - bottom)
      for (const item of row) item.position.y += dy
      placed.connection.y += dy
    }
    if (!disconnected) {
      const solarCable = name === 'Omvormer' && solarBreakerId
      const cable: LineShape = {
        id: nextId(), kind: 'line', start: { ...connection }, end: placed.connection, groupId, oneWireRailId: railId,
        strokeWidth: ONE_WIRE_CONDUCTOR_STROKE_WIDTH,
        connection: solarCable
          ? { kind: 'cable', labelOwner: 'solar-installation', showLabel: true }
          : { kind: 'wire', showLabel: false },
        ...(solarCable ? { sourceLink: { kind: 'device' as const, id: solarBreakerId, role: 'solar-ac-cable' } } : {}),
        energyFlow: 'reverse', energySource: 'generator'
      }
      shapes.push(cable)
      if (solarCable) {
        const cableLabel = text(
          'nog op te geven',
          connection.x + 36,
          Math.max(connection.y, placed.connection.y) - 24
        )
        cableLabel.scale = PROTECTION_TEXT_SIZE / 18
        cableLabel.fontWeight = PROTECTION_TEXT_WEIGHT
        cableLabel.rotation = -90
        cableLabel.sourceLink = { kind: 'device', id: solarBreakerId, role: 'solar-ac-cable-label' }
        shapes.push(cableLabel)
      }
    }
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
    add('symbols/Protection devices/Automaat.svg', 'PV automaat', '')
    add('symbols/Photovoltaic devices (≠AREI)/Inverter.svg', 'Omvormer',
      [installation.inverterManufacturer, installation.inverterModel,
        `${installation.inverterPowerW / 1000} kW AC · ${installation.phases} fase(n)`,
        installation.maxDcVoltageV ? `Max DC ${installation.maxDcVoltageV} V` : '',
        installation.mpptCount ? `${installation.mpptCount} MPPT` : ''].filter(Boolean).join('\n'))
  }
  if (installation.kind !== 'inverter') {
    const panel = installation.panel
    const total = panel.powerWp * installation.panelCount / 1000
    const counts = solarStringPanelCounts(installation)
    const strings = counts.every((count) => count === counts[0])
      ? `${installation.stringCount} string(s) van ${counts[0]} panelen`
      : counts.map((count, index) => `String ${index + 1}: ${count} panelen`).join('\n')
    add('symbols/Photovoltaic devices (≠AREI)/Solar panel.svg', 'Zonnepanelen',
      [panel.manufacturer, panel.model, strings,
        ...solarElectricalLines(panel)].filter(Boolean).join('\n'),
      `${installation.panelCount} x ${panel.powerWp} Wp = ${Number(total.toFixed(3))} kWp`)
  }
  const solarBreaker = shapes.find((shape): shape is SymbolShape =>
    shape.kind === 'symbol' && shape.name === 'PV automaat')
  return solarBreaker ? updateSolarInstallationCable(shapes, solarBreaker) : shapes
}

export const updateSolarInstallationCable = (shapes: readonly Shape[], breaker: SymbolShape): Shape[] => {
  const electrical = breaker.electrical
  const defaults = circuitDefaults(electrical?.circuitType)
  const defaultCable = defaultPvCableForBreaker(electrical?.breakerCurrentA)
  const sectionMm2 = electrical?.cableSectionMm2 ?? defaultCable?.sectionMm2
  const conductors = sectionMm2 ? electrical?.cableConductors ?? defaultCable?.conductors ?? defaults.cableConductors : undefined
  return presentConnectionLabels(shapes.map((shape) => {
    if (shape.kind === 'symbol' && shape.groupId === breaker.groupId &&
      shape.electrical?.solar && shape.electrical.solar.kind !== 'panels' &&
      typeof electrical?.breakerCurrentA === 'number') {
      return { ...shape, electrical: { ...shape.electrical,
        solar: { ...shape.electrical.solar, breakerCurrentA: electrical.breakerCurrentA } } }
    }
    if (shape.kind !== 'line' || shape.sourceLink?.role !== 'solar-ac-cable' ||
      shape.sourceLink.id !== breaker.id || !shape.connection) return shape
    return {
      ...shape,
      connection: {
        ...shape.connection,
        conductors,
        sectionMm2,
        cableType: sectionMm2 ? electrical?.cableType ?? (defaultCable ? 'none' : defaults.cableType) : undefined,
        fireClass: sectionMm2 ? electrical?.cableFireClass : undefined,
        hasProtectiveConductor: sectionMm2
          ? electrical?.hasProtectiveConductor ?? defaultHasProtectiveConductor(conductors)
          : undefined
      }
    }
  }))
}

export const preserveSolarBreakerSettings = (shapes: Shape[], previous?: SymbolShape): Shape[] => {
  const breaker = shapes.find((shape): shape is SymbolShape => shape.kind === 'symbol' && shape.name === 'PV automaat')
  if (!breaker || !previous?.electrical || !breaker.electrical) return shapes
  const electrical = { ...previous.electrical, ...breaker.electrical,
    cableConductors: previous.electrical.cableConductors,
    cableSectionMm2: previous.electrical.cableSectionMm2,
    cableType: previous.electrical.cableType,
    cableFireClass: previous.electrical.cableFireClass,
    hasProtectiveConductor: previous.electrical.hasProtectiveConductor,
    breakerCurve: previous.electrical.breakerCurve ?? breaker.electrical.breakerCurve }
  const restored: SymbolShape = {
    ...breaker, electrical,
    bindingId: previous.bindingId, bindingLabelOffset: previous.bindingLabelOffset,
    symbolTextOverrides: { ...previous.symbolTextOverrides, ...breaker.symbolTextOverrides,
      'rated-current': `${electrical.breakerCurve ?? 'C'}${electrical.breakerCurrentA}A` }
  }
  return updateSolarInstallationCable(shapes.map((shape) => shape.id === breaker.id ? restored : shape), restored)
}

const solarTextAnchors = (shapes: readonly Shape[]) => {
  const result = new Map<string, { text: TextShape; anchor: Point }>()
  const symbols = new Map(shapes.filter((shape): shape is SymbolShape => shape.kind === 'symbol')
    .map((shape) => [shape.id, shape]))
  let precedingSymbol: SymbolShape | undefined
  for (const shape of shapes) {
    if (shape.kind === 'symbol') {
      precedingSymbol = shape
      continue
    }
    if (shape.kind === 'line') {
      precedingSymbol = undefined
      continue
    }
    if (shape.kind !== 'text') continue
    const role = shape.sourceLink?.role
    if (role === 'solar-ac-cable-label') {
      const cable = shapes.find((candidate): candidate is LineShape => candidate.kind === 'line' &&
        candidate.sourceLink?.role === 'solar-ac-cable' && candidate.sourceLink.id === shape.sourceLink?.id)
      if (cable) result.set(role, { text: shape, anchor: cable.start })
      continue
    }
    const symbol = shape.sourceLink ? symbols.get(shape.sourceLink.id) : precedingSymbol
    if (!symbol) continue
    const inferredRole = symbol.name === 'Zonnepanelen'
      ? /^\s*\d+\s*x\s+[\d.]+\s+Wp\s*=/i.test(shape.text) ? 'solar-panel-quantity' : 'solar-panel-description'
      : symbol.name === 'Omvormer' ? 'solar-inverter-description' : undefined
    const key = role === 'solar-panel-quantity' || role === 'solar-panel-description' ||
      role === 'solar-inverter-description' ? role : !shape.sourceLink ? inferredRole : undefined
    if (key) result.set(key, { text: shape, anchor: symbol.position })
  }
  return result
}

export const preserveSolarTextPositions = (shapes: Shape[], previous: readonly Shape[]): Shape[] => {
  const old = solarTextAnchors(previous)
  const fresh = solarTextAnchors(shapes)
  const positions = new Map<string, Point>()
  for (const [role, current] of fresh) {
    const original = old.get(role)
    if (!original) continue
    positions.set(current.text.id, {
      x: original.text.position.x + (current.anchor.x - original.anchor.x),
      y: original.text.position.y + (current.anchor.y - original.anchor.y)
    })
  }
  return shapes.map((shape) => {
    const position = positions.get(shape.id)
    return shape.kind === 'text' && position ? { ...shape, position } : shape
  })
}

const solarElectricalLines = (panel: SolarPanel) => [
  panel.vmpV !== undefined ? `Vmp ${panel.vmpV} V${panel.impA !== undefined ? ` · Imp ${panel.impA} A` : ''} (STC)` : panel.impA !== undefined ? `Imp ${panel.impA} A (STC)` : '',
  panel.vocV !== undefined ? `Voc ${panel.vocV} V${panel.iscA !== undefined ? ` · Isc ${panel.iscA} A` : ''} (STC)` : panel.iscA !== undefined ? `Isc ${panel.iscA} A (STC)` : ''
]

export const solarInstallationPlacement = (
  shapes: readonly Shape[],
  occupied: readonly Shape[],
  rail: LineShape | undefined,
  area: { x: number; y: number; width: number; height: number },
  preferredTapX?: number
): number | undefined => {
  const boxes = shapes.map(oneWireLayoutBounds)
  const minX = Math.min(...boxes.map((box) => box.x))
  const maxX = Math.max(...boxes.map((box) => box.x + box.width))
  if (boxes.some((box) => box.y < area.y || box.y + box.height > area.y + area.height)) return undefined
  const obstacles = occupied.filter((shape) => !shape.hidden && shape.id !== rail?.id).map(oneWireLayoutBounds)
  const otherRails = occupied.filter((shape): shape is LineShape =>
    shape.kind === 'line' && shape.id !== rail?.id && !shape.hidden && isOneWireRailShape(shape))
  const firstLine = shapes.find((shape): shape is LineShape => shape.kind === 'line')
  const firstSymbol = shapes.find((shape): shape is SymbolShape => shape.kind === 'symbol')
  const tapX = firstLine?.start.x ?? (firstSymbol
    ? oneWireSymbolConnectionAnchors(firstSymbol).find((anchor) => anchor.side === 'top')?.point.x ?? firstSymbol.position.x
    : minX)
  const minDx = Math.max(0, area.x - minX)
  const maxDx = area.x + area.width - maxX
  const candidates = preferredTapX === undefined
    ? Array.from({ length: Math.max(0, Math.floor((maxDx - minDx) / 24) + 1) }, (_, index) => minDx + index * 24)
    : (() => {
        const preferredDx = Math.max(minDx, Math.min(maxDx, preferredTapX - tapX))
        const offsets = [0]
        for (let offset = 24; offset <= Math.max(preferredDx - minDx, maxDx - preferredDx); offset += 24) {
          offsets.push(offset, -offset)
        }
        return offsets.map((offset) => preferredDx + offset)
      })()
  for (const dx of candidates) {
    if (dx < minDx || dx > maxDx) continue
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
