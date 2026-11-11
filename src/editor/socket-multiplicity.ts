import type { Shape, SymbolShape } from './model/types.js'

export const isSocketSymbol = (shape: Pick<SymbolShape, 'name' | 'path' | 'electrical'>): boolean =>
  shape.electrical?.circuitType === 'sockets' || /socket|outlet|stopcontact/i.test(`${shape.name} ${shape.path}`)

export const socketCount = (shape: Pick<SymbolShape, 'electrical'>): number => {
  const value = shape.electrical?.socketCount
  return typeof value === 'number' && Number.isInteger(value) ? Math.max(1, Math.min(9, value)) : 1
}

export const socketCountFromKeyboardEvent = (
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>
): number | null => {
  if (event.ctrlKey || event.metaKey || event.altKey || !/^[1-9]$/.test(event.key)) return null
  return Number(event.key)
}

export const socketCopyOffsets = (count: number, size: number): number[] => {
  const normalized = Math.max(1, Math.min(9, Math.round(count)))
  const step = size * 0.46
  const start = -((normalized - 1) * step) / 2
  return Array.from({ length: normalized }, (_, index) => start + index * step)
}

export const withSocketCount = (shape: Shape, count: number): Shape => {
  if (shape.kind !== 'symbol' || !isSocketSymbol(shape)) return shape
  return {
    ...shape,
    electrical: {
      ...(shape.electrical ?? { role: 'load', oneWireEligible: true, circuitType: 'sockets' }),
      socketCount: Math.max(1, Math.min(9, Math.round(count)))
    }
  }
}
