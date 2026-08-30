import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyDragMove,
  snapSymbolToWallOffset,
  snapWallSymbolNextToSymbol
} from '../src/editor/interaction/pointer-move.ts'
import { oneWireSymbolNodeInfo } from '../src/editor/layout/onewire-symbol-nodes.ts'
import type { Shape } from '../src/editor/model/types.ts'

test('snaps a dragged RCD by its electrical terminal', () => {
  const rcd: Shape = {
    id: 'rcd',
    kind: 'symbol',
    position: { x: 103, y: 207 },
    name: 'Residual-current circuit breaker',
    path: 'symbols/Protection devices/Residual-current circuit breaker.svg',
    scale: 4
  }
  const moved = applyDragMove(
    { x: 0, y: 0 },
    { ids: ['rcd'], pointerStart: { x: 0, y: 0 }, initial: [rcd] },
    (point) => ({ x: Math.round(point.x / 10) * 10, y: Math.round(point.y / 10) * 10 }),
    [rcd]
  )
  const movedRcd = moved[0]
  assert.equal(movedRcd?.kind, 'symbol')
  if (movedRcd?.kind !== 'symbol') return
  const node = oneWireSymbolNodeInfo(movedRcd.path, movedRcd.scale)
  assert.ok(node)
  const anchor = {
    x: movedRcd.position.x + node.offset.x,
    y: movedRcd.position.y + node.offset.y
  }
  assert.ok(Math.abs(anchor.x / 10 - Math.round(anchor.x / 10)) < 1e-9)
  assert.ok(Math.abs(anchor.y / 10 - Math.round(anchor.y / 10)) < 1e-9)
})

test('extends connected walls when dragging a wall', () => {
  const shapes: Shape[] = [
    { id: 'selected', kind: 'wall', start: { x: 100, y: 200 }, end: { x: 300, y: 200 } },
    { id: 'left', kind: 'wall', start: { x: 100, y: 100 }, end: { x: 100, y: 200 } },
    { id: 'middle', kind: 'wall', start: { x: 200, y: 200 }, end: { x: 200, y: 300 } },
    { id: 'right', kind: 'wall', start: { x: 300, y: 100 }, end: { x: 300, y: 200 } }
  ]
  const moved = applyDragMove(
    { x: 0, y: 40 },
    { ids: ['selected'], pointerStart: { x: 0, y: 0 }, initial: [shapes[0]] },
    (point) => point,
    shapes
  )

  assert.deepEqual(moved[0].kind === 'wall' ? moved[0].start : null, { x: 100, y: 240 })
  assert.deepEqual(moved[1].kind === 'wall' ? moved[1].end : null, { x: 100, y: 240 })
  assert.deepEqual(moved[2].kind === 'wall' ? moved[2].start : null, { x: 200, y: 240 })
  assert.deepEqual(moved[3].kind === 'wall' ? moved[3].end : null, { x: 300, y: 240 })

  const movedAgain = applyDragMove(
    { x: 0, y: 80 },
    { ids: ['selected'], pointerStart: { x: 0, y: 0 }, initial: [shapes[0]] },
    (point) => point,
    moved
  )

  assert.deepEqual(movedAgain[0].kind === 'wall' ? movedAgain[0].start : null, { x: 100, y: 280 })
  assert.deepEqual(movedAgain[1].kind === 'wall' ? movedAgain[1].end : null, { x: 100, y: 280 })
  assert.deepEqual(movedAgain[2].kind === 'wall' ? movedAgain[2].start : null, { x: 200, y: 280 })
  assert.deepEqual(movedAgain[3].kind === 'wall' ? movedAgain[3].end : null, { x: 300, y: 280 })
})

test('snaps dragged switches and socket outlets back to a wall offset', () => {
  const wall: Shape = {
    id: 'wall',
    kind: 'wall',
    start: { x: 0, y: 100 },
    end: { x: 300, y: 100 }
  }
  for (const [id, path] of [
    ['switch', 'symbols/Switches/Switch general symbol.svg'],
    ['socket', 'symbols/Socket outlets/Wall outlet with grounding.svg']
  ] as const) {
    const symbol: Shape = {
      id,
      kind: 'symbol',
      position: { x: 50, y: 50 },
      name: id,
      path,
      scale: 1.3
    }
    const moved = applyDragMove(
      { x: 100, y: 80 },
      { ids: [id], pointerStart: { x: 50, y: 50 }, initial: [symbol] },
      (point) => point,
      [wall, symbol]
    )

    const updatedSymbol = moved.find((shape) => shape.id === id)
    assert.equal(updatedSymbol?.kind, 'symbol')
    if (updatedSymbol?.kind !== 'symbol') continue
    assert.equal(updatedSymbol.position.x, 100)
    assert.ok(updatedSymbol.position.y < 100)
    assert.notEqual(updatedSymbol.position.y, 80)
  }
})

test('snaps switches close enough for their visible edge to reach the wall', () => {
  const wall: Shape = {
    id: 'wall',
    kind: 'wall',
    start: { x: 100, y: 0 },
    end: { x: 100, y: 300 }
  }
  const symbol: Extract<Shape, { kind: 'symbol' }> = {
    id: 'switch',
    kind: 'symbol',
    position: { x: 70, y: 100 },
    name: 'Switch general symbol',
    path: 'symbols/Switches/Switch general symbol.svg',
    scale: 1.3
  }
  const halfExtent = (24 * symbol.scale) / 2
  const snapped = snapSymbolToWallOffset(symbol.position, halfExtent, [wall], 1, symbol)

  assert.equal(snapped.snapped, true)
  assert.ok(snapped.point.x > 79)
  assert.ok(snapped.point.x < wall.start.x)
})

test('snaps a wall symbol above, below, left, or right of another symbol', () => {
  const stationary: Shape = {
    id: 'stationary',
    kind: 'symbol',
    position: { x: 100, y: 70 },
    name: 'Switch general symbol',
    path: 'symbols/Switches/Switch general symbol.svg',
    scale: 1.3
  }
  const dragged: Shape = {
    id: 'dragged',
    kind: 'symbol',
    position: { x: 50, y: 50 },
    name: 'Push button',
    path: 'symbols/Switches/Push button.svg',
    scale: 0.8
  }

  const sourceHalfExtent = (24 * dragged.scale) / 2
  const targetHalfExtent = (24 * stationary.scale) / 2
  const offset = sourceHalfExtent + targetHalfExtent + 4
  const expectedAnchors = [
    { x: stationary.position.x, y: stationary.position.y - offset },
    { x: stationary.position.x, y: stationary.position.y + offset },
    { x: stationary.position.x - offset, y: stationary.position.y },
    { x: stationary.position.x + offset, y: stationary.position.y }
  ]

  for (const anchor of expectedAnchors) {
    const snapped = snapWallSymbolNextToSymbol(
      { x: anchor.x + 3, y: anchor.y + 2 },
      dragged,
      [stationary, dragged],
      new Set(['dragged'])
    )
    assert.equal(snapped.snapped, true)
    assert.ok(Math.abs(snapped.point.x - anchor.x) < 1e-9)
    assert.ok(Math.abs(snapped.point.y - anchor.y) < 1e-9)
  }

  const center = snapWallSymbolNextToSymbol(stationary.position, dragged, [stationary, dragged], new Set(['dragged']))
  assert.equal(center.snapped, false)
})

test('keeps adjacent symbols on the same side of a wall', () => {
  const wall: Extract<Shape, { kind: 'wall' }> = {
    id: 'wall',
    kind: 'wall',
    start: { x: 0, y: 100 },
    end: { x: 300, y: 100 }
  }
  const stationary: Shape = {
    id: 'stationary',
    kind: 'symbol',
    position: { x: 100, y: 73.9 },
    name: 'Switch general symbol',
    path: 'symbols/Switches/Switch general symbol.svg',
    scale: 1.3
  }
  const sourceHalfExtent = (24 * 0.8) / 2
  const wallPoint = snapSymbolToWallOffset({ x: 126, y: 81 }, sourceHalfExtent, [wall])
  assert.equal(wallPoint.snapped, true)

  const snapped = snapWallSymbolNextToSymbol(
    wallPoint.point,
    {
      id: 'dragged',
      kind: 'symbol',
      position: wallPoint.point,
      name: 'Push button',
      path: 'symbols/Switches/Push button.svg',
      scale: 0.8
    },
    [wall, stationary],
    new Set(),
    1,
    wall
  )

  assert.equal(snapped.snapped, true)
  assert.ok(Math.abs(snapped.point.x - 129.2) < 1e-9)
  assert.ok(Math.abs(snapped.point.y - stationary.position.y) < 1e-9)
})

test('uses the target wall direction when the dragged symbol is outside wall range', () => {
  const wall: Extract<Shape, { kind: 'wall' }> = {
    id: 'wall',
    kind: 'wall',
    start: { x: 100, y: 0 },
    end: { x: 100, y: 300 }
  }
  const stationary: Shape = {
    id: 'stationary',
    kind: 'symbol',
    position: { x: 126.1, y: 100 },
    name: 'Switch general symbol',
    path: 'symbols/Switches/Switch general symbol.svg',
    scale: 1.3
  }
  const dragged: Extract<Shape, { kind: 'symbol' }> = {
    id: 'dragged',
    kind: 'symbol',
    position: { x: 118, y: 130 },
    name: 'Push button',
    path: 'symbols/Switches/Push button.svg',
    scale: 0.8
  }

  const snapped = snapWallSymbolNextToSymbol(
    dragged.position,
    dragged,
    [wall, stationary, dragged],
    new Set(['dragged'])
  )
  assert.equal(snapped.snapped, true)
  assert.ok(Math.abs(snapped.point.x - stationary.position.x) < 1e-9)
  assert.ok(Math.abs(snapped.point.y - 129.2) < 1e-9)

  const throughWall = snapWallSymbolNextToSymbol(
    { x: 155, y: 100 },
    dragged,
    [wall, stationary, dragged],
    new Set(['dragged'])
  )
  assert.equal(throughWall.snapped, false)
})
