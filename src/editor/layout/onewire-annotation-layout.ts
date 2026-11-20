import type { LineShape, Shape, SymbolShape, TextShape } from '../model/types.js'
import { oneWireLayoutBounds, oneWireSymbolConnectionAnchors } from './onewire-connections.js'
import { oneWireSymbolBounds, oneWireSymbolTerminalInfo } from './onewire-symbol-nodes.js'
import { protectionAnnotationLayout } from './protection-label-layout.js'
import { connectionSegments } from '../model/electrical-connection.js'
import { paperTextBounds } from './paper-text-layout.js'
import type { BindingLabelSide } from './symbol-layout.js'
import { nextShapeId } from '../model/model.js'
import { ONE_WIRE_CONDUCTOR_STROKE_WIDTH } from '../constants.js'

export const isOneWireFamilyLabel = (shape: Shape): shape is TextShape =>
  shape.kind === 'text' && shape.sourceLink?.role === 'label' &&
  (shape.sourceLink.kind === 'board' || shape.sourceLink.kind === 'circuit')

export const placeOneWireCountLabels = (shapes: readonly Shape[]): Shape[] => {
  if (!shapes.some((shape) => shape.sourceLink?.role === 'count-label')) return [...shapes]
  const rowKey = (shape: Shape) => JSON.stringify([shape.oneWireRailId, shape.groupId, shape.bindingId])
  const symbols = new Map<string, SymbolShape[]>()
  for (const shape of shapes) {
    if (shape.kind !== 'symbol' || (shape.sourceLink?.role !== 'load' && shape.sourceLink?.role !== 'switch')) continue
    const key = rowKey(shape)
    const row = symbols.get(key)
    if (row) row.push(shape)
    else symbols.set(key, [shape])
  }
  const wires = shapes.flatMap((shape) => shape.kind === 'line' && !shape.hidden
    ? connectionSegments(shape).filter(({ start, end }) => Math.abs(start.x - end.x) < 1e-8)
      .map((segment) => ({ ...segment, radius: (shape.strokeWidth ?? 2) / 2 })) : [])
  return shapes.map((shape) => {
    if (shape.kind !== 'text' || shape.sourceLink?.role !== 'count-label' || shape.hidden || shape.locked) return shape
    const index = /:count:(\d+)$/.exec(shape.generationKey ?? '')?.[1]
    const symbol = index === undefined ? undefined : symbols.get(rowKey(shape))?.[Number(index)]
    if (!symbol || symbol.hidden) return shape
    const body = oneWireLayoutBounds(symbol)
    const label: TextShape = { ...shape, textAnchor: 'middle', rotation: 0, flipX: false, flipY: false,
      position: { x: body.x + body.width / 2, y: body.y } }
    let bounds = paperTextBounds(label)
    label.position.y -= bounds.y + bounds.height - body.y + 6
    bounds = paperTextBounds(label)
    let blockers = wires.filter(({ start, end, radius }) =>
      start.x + radius > bounds.x && start.x - radius < bounds.x + bounds.width &&
      Math.max(start.y, end.y) + radius > bounds.y && Math.min(start.y, end.y) - radius < bounds.y + bounds.height)
    while (blockers.length) {
      label.position.x += Math.max(...blockers.map(({ start, radius }) => start.x + radius + 6)) - bounds.x
      bounds = paperTextBounds(label)
      blockers = wires.filter(({ start, end, radius }) =>
        start.x + radius > bounds.x && start.x - radius < bounds.x + bounds.width &&
        Math.max(start.y, end.y) + radius > bounds.y && Math.min(start.y, end.y) - radius < bounds.y + bounds.height)
    }
    return shape.textAnchor === 'middle' && !shape.rotation && !shape.flipX && !shape.flipY &&
      Math.abs(shape.position.x - label.position.x) < 1e-8 && Math.abs(shape.position.y - label.position.y) < 1e-8
      ? shape : label
  })
}

export const placeOneWireFamilyLabels = (
  shapes: readonly Shape[],
  manual?: { selectedIds: ReadonlySet<string>; side: BindingLabelSide | 'auto' }
): Shape[] => {
  const segments = shapes.flatMap((shape) => shape.kind === 'line' && !shape.hidden
    ? connectionSegments(shape).filter(({ start, end }) => Math.abs(start.x - end.x) < 1e-8 && Math.abs(start.y - end.y) > 1e-8)
      .map((segment) => ({ ...segment, radius: (shape.strokeWidth ?? 2) / 2 })) : [])
  return shapes.map((shape) => {
    if (!isOneWireFamilyLabel(shape) || shape.hidden || shape.locked || shape.rotation || shape.flipX || shape.flipY) return shape
    let label = shape
    if (manual) {
      const breaker = shapes.find((candidate): candidate is SymbolShape =>
        candidate.kind === 'symbol' && candidate.sourceLink?.role === 'breaker' &&
        candidate.sourceLink.id === shape.sourceLink!.id &&
        (shape.groupId ? candidate.groupId === shape.groupId
          : candidate.oneWireRailId === shape.oneWireRailId))
      if (!manual.selectedIds.has(shape.id) && (!breaker || !manual.selectedIds.has(breaker.id))) return shape
      const bottom = breaker && oneWireSymbolConnectionAnchors(breaker).find((anchor) => anchor.side === 'bottom')
      const axisX = bottom?.point.x ?? breaker?.position.x ?? shape.position.x - (shape.bindingLabelOffset?.x ?? 0)
      const origin = { x: axisX, y: shape.position.y - (shape.bindingLabelOffset?.y ?? 0) }
      const bounds = paperTextBounds(shape)
      const offset = manual.side === 'left' ? { x: -8 - (bounds.x + bounds.width - shape.position.x), y: 0 }
        : manual.side === 'right' ? { x: 8 - (bounds.x - shape.position.x), y: 0 }
          : manual.side === 'top' ? { x: 0, y: -bounds.height - 8 }
            : manual.side === 'bottom' ? { x: 0, y: bounds.height + 8 } : { x: 0, y: 0 }
      label = { ...shape, position: { x: origin.x + offset.x, y: origin.y + offset.y } }
      if (manual.side === 'auto') delete label.bindingLabelOffset
      else label.bindingLabelOffset = offset
    }
    if (label.bindingLabelOffset) return label
    const bounds = paperTextBounds(label)
    const crossings = (x: number) => segments.filter(({ start, end, radius }) =>
      start.x + radius > x && start.x - radius < x + bounds.width &&
      Math.max(start.y, end.y) + radius > bounds.y &&
      Math.min(start.y, end.y) - radius < bounds.y + bounds.height)
    if (!crossings(bounds.x).length) return label
    const candidates = [-1, 1].map((direction) => {
      let x = bounds.x
      let blockers = crossings(x)
      while (blockers.length) {
        x = direction < 0
          ? Math.min(...blockers.map(({ start, radius }) => start.x - radius - 8 - bounds.width))
          : Math.max(...blockers.map(({ start, radius }) => start.x + radius + 8))
        blockers = crossings(x)
      }
      return x - bounds.x
    })
    const dx = Math.abs(candidates[0]) <= Math.abs(candidates[1]) ? candidates[0] : candidates[1]
    return { ...label, position: { ...label.position, x: label.position.x + dx } }
  })
}

// Compact protection values beside the drawn body; 3 mm around cable text.
export const spaceOneWireCircuitAnnotations = (
  shapes: readonly Shape[],
  circuitKey: string,
  { emptyOnly = false, nextId = nextShapeId }: { emptyOnly?: boolean; nextId?: () => string } = {}
) => {
  let next = [...shapes]
  let changed = false
  for (const breaker of shapes.filter((shape): shape is SymbolShape =>
    shape.kind === 'symbol' && shape.sourceLink?.role === 'breaker' && shape.sourceLink.id === circuitKey
  )) {
    const bounds = oneWireSymbolBounds(breaker)
    const terminals = oneWireSymbolTerminalInfo(breaker.path, breaker.scale)
    if (!bounds || !terminals?.top || !terminals.bottom || breaker.rotation || breaker.flipX || breaker.flipY) continue
    const belongs = (shape: Shape) => Boolean(shape.generationKey) && shape.oneWireRailId === breaker.oneWireRailId &&
      (shape.sourceLink?.kind === 'board' ? shape.sourceLink.id === circuitKey : shape.bindingId?.replace(/\d+$/, '') === circuitKey)
    if (shapes.some((shape) => shape.kind === 'symbol' && shape.sourceLink?.role === 'inline' &&
      shape.oneWireRailId === breaker.oneWireRailId &&
      shape.sourceLink.id.replace(/\d+$/, '') === circuitKey)) continue
    const allRows = next.filter((shape) => belongs(shape) && shape.sourceLink?.kind !== 'board')
    const rows = allRows.filter((shape) => !shape.hidden)
    if (emptyOnly && allRows.length) continue
    const cableCenterY = (items: readonly Shape[], trunk: LineShape): number => {
      const junctionYs = items.flatMap((candidate) => {
        if (candidate.kind !== 'line' || !belongs(candidate) || candidate.sourceLink?.role !== 'row-wire') return []
        return [candidate.start, candidate.end]
          .filter((point) => Math.abs(point.x - trunk.start.x) < 1e-8)
          .map((point) => point.y)
      })
      const nearestRowY = junctionYs.length ? Math.max(...junctionYs) : trunk.end.y
      return (trunk.start.y + nearestRowY) / 2
    }
    const axisX = breaker.position.x + terminals.bottom.x
    const topY = breaker.position.y + terminals.top.y
    let trunk = next.find((shape): shape is LineShape =>
      shape.kind === 'line' && belongs(shape) && shape.sourceLink?.role === 'trunk')
    if (!allRows.length && !trunk && breaker.generationKey && !breaker.locked && !breaker.hidden &&
      next.some((shape) => belongs(shape) && shape.sourceLink?.role === 'cable-section') &&
      !next.some((shape) => shape.kind === 'line' && !shape.hidden && connectionSegments(shape).some(({ start, end }) =>
        [start, end].some((point) => Math.hypot(point.x - axisX, point.y - topY) < 1e-8)))) {
      const electrical = breaker.electrical
      trunk = {
        id: nextId(), kind: 'line', start: { x: axisX, y: topY }, end: { x: axisX, y: topY - 48 },
        stroke: breaker.stroke ?? '#000000', strokeWidth: ONE_WIRE_CONDUCTOR_STROKE_WIDTH,
        bindingId: circuitKey, groupId: breaker.groupId, oneWireRailId: breaker.oneWireRailId,
        sourceLink: { kind: 'board', id: circuitKey, role: 'trunk' }, generationKey: `board:${circuitKey}:trunk`,
        connection: { kind: 'cable',
          showLabel: !next.find((shape) => belongs(shape) && shape.sourceLink?.role === 'cable-section')?.hidden,
          labelOwner: 'circuit',
          conductors: electrical?.cableConductors ?? 3, sectionMm2: electrical?.cableSectionMm2 ?? 2.5,
          hasProtectiveConductor: electrical?.hasProtectiveConductor ?? electrical?.cableConductors !== 4,
          cableType: electrical?.cableType ?? 'VOB', fireClass: electrical?.cableFireClass }
      }
      next.push(trunk)
      changed = true
    }
    const labels = protectionAnnotationLayout(breaker)!
    const positionLabel = (shape: TextShape, x: number, y: number): TextShape => {
      if (Math.abs(shape.position.x - x) < 1e-8 && Math.abs(shape.position.y - y) < 1e-8) return shape
      changed = true
      return { ...shape, position: { x, y } }
    }
    next = next.map((shape) => {
      if (!belongs(shape) || shape.kind !== 'text') return shape
      switch (shape.sourceLink?.role) {
        case 'breaker-poles': return positionLabel(shape, labels.poles.x, labels.poles.y)
        case 'breaker-current': {
          let current = positionLabel(shape, labels.current.x, labels.current.y)
          if (current.textAnchor !== 'start') {
            changed = true
            current = { ...current, textAnchor: 'start' }
          }
          return current
        }
        case 'breaker-phase': {
          const position = labels.phase
          const phase = positionLabel(shape, position.x, position.y)
          if (phase.textAnchor === 'start') return phase
          changed = true
          return { ...phase, textAnchor: 'start' as const }
        }
        // The rotated letters extend left of their baseline. Keep them wholly
        // to the right of the conductor rather than printing across it.
        case 'cable-section': {
          const trunk = next.find((candidate): candidate is LineShape =>
            candidate.kind === 'line' && belongs(candidate) && /^trunk(?:-\d+)?$/.test(candidate.sourceLink?.role ?? '')
          )
          const cable = positionLabel(shape, axisX + 36, trunk ? cableCenterY(next, trunk) : topY - 24)
          if (cable.textAnchor === 'middle') return cable
          changed = true
          return { ...cable, textAnchor: 'middle' }
        }
        default: return shape
      }
    })
    const cable = next.find((shape) => belongs(shape) && shape.kind === 'text' && shape.sourceLink?.role === 'cable-section')
    if (!cable || (!rows.length && (!trunk || allRows.length))) continue
    const bottom = rows.length ? Math.max(...rows.map((shape) => {
      const box = oneWireLayoutBounds(shape)
      return box.y + box.height
    })) : trunk!.end.y
    const delta = Math.min(0, 2 * (oneWireLayoutBounds(cable).y - 24 - bottom))
    if (delta > -1e-8) continue
    changed = true
    next = next.map((shape): Shape => {
      if (!belongs(shape)) return shape
      if (shape.kind === 'line' && /^trunk(?:-\d+)?$/.test(shape.sourceLink?.role ?? '')) {
        return { ...shape, end: { ...shape.end, y: shape.end.y + delta } }
      }
      if (shape.sourceLink?.kind === 'board' && shape.sourceLink.role !== 'description') return shape
      if ('position' in shape) return { ...shape, position: { ...shape.position, y: shape.position.y + delta } }
      return { ...shape, start: { ...shape.start, y: shape.start.y + delta }, end: { ...shape.end, y: shape.end.y + delta } }
    })
    const shiftedTrunk = next.find((candidate): candidate is LineShape =>
      candidate.kind === 'line' && belongs(candidate) && /^trunk(?:-\d+)?$/.test(candidate.sourceLink?.role ?? '')
    )
    const shiftedCable = next.find((candidate): candidate is TextShape =>
      candidate.kind === 'text' && belongs(candidate) && candidate.sourceLink?.role === 'cable-section'
    )
    if (shiftedTrunk && shiftedCable) {
      const y = cableCenterY(next, shiftedTrunk)
      if (shiftedCable.position.y !== y || shiftedCable.textAnchor !== 'middle') {
        next = next.map((candidate) => candidate === shiftedCable
          ? { ...candidate, position: { ...candidate.position, y }, textAnchor: 'middle' } : candidate)
      }
    }
  }
  return { shapes: next, changed }
}
