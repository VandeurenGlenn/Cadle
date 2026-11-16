import type { LineShape, Shape, SymbolShape, TextShape } from '../model/types.js'
import { oneWireLayoutBounds } from './onewire-connections.js'
import { oneWireSymbolBounds, oneWireSymbolTerminalInfo } from './onewire-symbol-nodes.js'
import { protectionAnnotationLayout } from './protection-label-layout.js'

// Compact protection values beside the drawn body; 3 mm around cable text.
export const spaceOneWireCircuitAnnotations = (shapes: readonly Shape[], circuitKey: string) => {
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
        case 'breaker-current': return positionLabel(shape, labels.current.x, labels.current.y)
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
    const rows = next.filter((shape) => belongs(shape) && !shape.hidden && shape.sourceLink?.kind !== 'board')
    if (!cable || !rows.length) continue
    const bottom = Math.max(...rows.map((shape) => {
      const box = oneWireLayoutBounds(shape)
      return box.y + box.height
    }))
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
