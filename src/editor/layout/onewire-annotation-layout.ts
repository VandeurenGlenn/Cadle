import type { Shape, SymbolShape, TextShape } from '../model/types.js'
import { oneWireLayoutBounds } from './onewire-connections.js'
import { oneWireSymbolBounds, oneWireSymbolTerminalInfo } from './onewire-symbol-nodes.js'

// Paper clearances: 1.5 mm around protection values, 3 mm around cable text.
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
    const axisX = breaker.position.x + terminals.bottom.x
    const topY = breaker.position.y + terminals.top.y
    const positionLabel = (shape: TextShape, x: number, y: number): TextShape => {
      if (Math.abs(shape.position.x - x) < 1e-8 && Math.abs(shape.position.y - y) < 1e-8) return shape
      changed = true
      return { ...shape, position: { x, y } }
    }
    next = next.map((shape) => {
      if (!belongs(shape) || shape.kind !== 'text') return shape
      switch (shape.sourceLink?.role) {
        case 'breaker-poles': return positionLabel(shape, bounds.x - 12, breaker.position.y + 5)
        case 'breaker-current': return positionLabel(shape, bounds.x + bounds.width + 12, breaker.position.y + 5)
        // The rotated letters extend left of their baseline. Keep them wholly
        // to the right of the conductor rather than printing across it.
        case 'cable-section': return positionLabel(shape, axisX + 36, topY - 24)
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
    const delta = Math.min(0, oneWireLayoutBounds(cable).y - 24 - bottom)
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
  }
  return { shapes: next, changed }
}
