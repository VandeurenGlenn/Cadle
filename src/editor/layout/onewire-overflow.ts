import type { LineShape, Shape, SymbolShape } from '../model/types.js'
import { cloneShape } from '../model/model.js'
import { translateShape } from '../interaction/shape-transforms.js'
import { oneWireLayoutBounds } from './onewire-connections.js'
import { oneWireSymbolTerminalInfo } from './onewire-symbol-nodes.js'
import { centerOneWireContent } from './page-scaling.js'
import { isOneWireRailShape } from './onewire-regeneration.js'
import { normalizeOneWireFamilyKey } from './onewire-layout-plan.js'

type Area = { x: number; y: number; width: number; height: number }
type Block = { shapes: Shape[]; rail: LineShape }
const family = (value = '') => normalizeOneWireFamilyKey(value) ?? value.trim().toUpperCase()
const box = (shapes: readonly Shape[]): Area => {
  const boxes = shapes.filter((shape) => !shape.hidden).map(oneWireLayoutBounds)
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 }
  const x = Math.min(...boxes.map((item) => item.x)), y = Math.min(...boxes.map((item) => item.y))
  return { x, y, width: Math.max(...boxes.map((item) => item.x + item.width)) - x,
    height: Math.max(...boxes.map((item) => item.y + item.height)) - y }
}
const overlaps = (a: Area, b: Area) => a.x < b.x + b.width + 16 && a.x + a.width + 16 > b.x &&
  a.y < b.y + b.height + 16 && a.y + a.height + 16 > b.y

/** Split an oversized family at complete numbered rows, preserving the device objects. */
const splitRows = (block: Block, height: number, nextId: () => string): Block[] => {
  if (box(block.shapes).height <= height) return [block]
  const breaker = block.shapes.find((shape): shape is SymbolShape => shape.kind === 'symbol' && shape.sourceLink?.role === 'breaker')
  const trunk = block.shapes.find((shape): shape is LineShape => shape.kind === 'line' && shape.sourceLink?.role === 'trunk')
  if (!breaker || !trunk) return [block]
  const rows = new Map<string, Shape[]>()
  for (const shape of block.shapes) {
    if (!shape.bindingId || shape.sourceLink?.kind === 'board' || !/\d+$/.test(shape.bindingId)) continue
    const members = rows.get(shape.bindingId) ?? []
    members.push(shape)
    rows.set(shape.bindingId, members)
  }
  if (rows.size < 2) return [block]
  const rowIds = new Set([...rows.values()].flat().map((shape) => shape.id))
  const base = block.shapes.filter((shape) => !rowIds.has(shape.id) &&
    !/^trunk(?:-\d+|-distribution)?$/.test(shape.sourceLink?.role ?? ''))
  const top = box(base).y
  const output: Block[] = []
  let placed: Shape[] = [], rowTop = top - 24, lastJunctionY = top - 24
  const finish = () => {
    if (!placed.length) return
    const copied = base.map((shape) => output.length ? { ...cloneShape(shape), id: nextId() } as Shape : shape)
    output.push({ rail: block.rail, shapes: [...copied, { ...(cloneShape(trunk) as LineShape),
      id: output.length ? nextId() : trunk.id, start: { ...trunk.start },
      end: { x: trunk.start.x, y: lastJunctionY } }, ...placed] })
    placed = []; rowTop = top - 24
  }
  for (const [binding, members] of [...rows].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
    const bounds = box(members)
    const number = members.find((shape) => shape.kind === 'text' && shape.sourceLink?.role === 'number-label')
    const junctionX = number?.kind === 'text' ? number.position.x + 12 : trunk.start.x
    const junctionY = number?.kind === 'text' ? number.position.y - 5 : bounds.y + bounds.height / 2
    if (placed.length && box([...base, ...placed]).y + box([...base, ...placed]).height - (rowTop - bounds.height) > height) finish()
    const dx = trunk.start.x - junctionX, dy = rowTop - bounds.y - bounds.height
    const shifted = members.map((shape) => translateShape(shape, dx, dy))
    placed.push(...shifted)
    lastJunctionY = junctionY + dy
    rowTop -= bounds.height + 24
    void binding
  }
  finish()
  return output
}

export type OverflowLayout = { pages: Shape[][]; changed: boolean; fits: boolean }

/** Move whole circuits to continuation sheets; never shrink their paper scale. */
export const paginateOneWireCircuits = (shapes: readonly Shape[], area: Area, nextId: () => string): OverflowLayout => {
  const unchanged = { pages: [[...shapes]], changed: false, fits: true }
  const total = box(shapes)
  if (total.width <= area.width - 48 && total.height <= area.height - 48) return unchanged
  if (shapes.some((shape) => shape.locked)) return { ...unchanged, fits: false }
  const rails = shapes.filter((shape): shape is LineShape => shape.kind === 'line' && isOneWireRailShape(shape))
  const breakers = shapes.filter((shape): shape is SymbolShape => shape.kind === 'symbol' && shape.sourceLink?.role === 'breaker')
  if (!rails.length || !breakers.length) return { ...unchanged, fits: false }
  const used = new Set<string>()
  const blocks: Block[] = []
  for (const breaker of breakers) {
    const key = family(breaker.sourceLink!.id)
    const terminal = oneWireSymbolTerminalInfo(breaker.path, breaker.scale)?.bottom
    const baseline = breaker.position.y + (terminal?.y ?? 0)
    const rail = rails.find((candidate) => breaker.oneWireRailId ? candidate.id === breaker.oneWireRailId
      : Math.abs(candidate.start.y - baseline) < 1)
    if (!rail) return { ...unchanged, fits: false }
    const members = shapes.filter((shape) => !isOneWireRailShape(shape) && !used.has(shape.id) &&
      (!shape.oneWireRailId || shape.oneWireRailId === rail.id) &&
      (shape.sourceLink?.kind === 'board' ? family(shape.sourceLink.id) === key : family(shape.bindingId) === key))
    if (!members.length || members.some((shape) => shape.locked)) return { ...unchanged, fits: false }
    members.forEach((shape) => used.add(shape.id))
    blocks.push(...splitRows({ shapes: members, rail }, area.height - 188, nextId))
  }
  if (blocks.some((block) => box(block.shapes).width > area.width - 48 || box(block.shapes).height > area.height - 188)) {
    return { ...unchanged, fits: false }
  }
  // Empty/manual rails are still user content; only replace rails actually packed.
  const railIds = new Set(blocks.map((block) => block.rail.id))
  const headers = shapes.filter((shape) => !used.has(shape.id) && rails.some((rail) =>
    shape.groupId === rail.groupId && shape.sourceLink?.role.startsWith('sheet-reference:')))
  headers.forEach((shape) => used.add(shape.id))
  const retained = shapes.filter((shape) => !used.has(shape.id) && !railIds.has(shape.id))
  const pages: Array<{ shapes: Shape[]; rail?: LineShape; sourceRailId?: string; min: number; max: number; cursor: number; obstacles: Area[] }> = [
    { shapes: retained, min: Infinity, max: -Infinity, cursor: area.x + 24,
      obstacles: retained.filter((shape) => !shape.hidden).map(oneWireLayoutBounds) }
  ]
  let current = pages[0]
  const railCopies = new Set<string>()
  for (const block of blocks) {
    const bounds = box(block.shapes)
    const below = Math.max(140, ...blocks.filter((candidate) => candidate.rail.id === block.rail.id)
      .map((candidate) => { const b = box(candidate.shapes); return b.y + b.height - candidate.rail.start.y }))
    const dy = area.y + area.height - 24 - below - block.rail.start.y
    if (current.rail && current.sourceRailId !== block.rail.id) {
      current = { shapes: [], min: Infinity, max: -Infinity, cursor: area.x + 24, obstacles: [] }
      pages.push(current)
    }
    let x = current.cursor
    let candidate: Area = { ...bounds, x, y: bounds.y + dy }
    for (let pass = 0; pass <= current.obstacles.length; pass++) {
      const hit = current.obstacles.find((obstacle) => overlaps(candidate, obstacle))
      if (!hit) break
      x = hit.x + hit.width + 24; candidate = { ...candidate, x }
    }
    if (x + bounds.width > area.x + area.width - 24) {
      current = { shapes: [], min: Infinity, max: -Infinity, cursor: area.x + 24, obstacles: [] }
      pages.push(current); x = current.cursor
    }
    if (!current.rail) {
      current.rail = { ...cloneShape(block.rail), id: railCopies.has(block.rail.id) ? nextId() : block.rail.id } as LineShape
      current.sourceRailId = block.rail.id
    }
    railCopies.add(block.rail.id)
    const dx = x - bounds.x
    const moved = block.shapes.map((shape) => ({ ...translateShape(shape, dx, dy), oneWireRailId: current.rail!.id }))
    current.shapes.push(...moved)
    const terminals = moved.flatMap((shape) => shape.kind === 'symbol' && shape.sourceLink?.role === 'breaker'
      ? [{ x: shape.position.x + oneWireSymbolTerminalInfo(shape.path, shape.scale)!.bottom!.x }] : [])
    current.min = Math.min(current.min, ...terminals.map((point) => point.x))
    current.max = Math.max(current.max, ...terminals.map((point) => point.x))
    current.rail.start.y = current.rail.end.y = block.rail.start.y + dy
    current.cursor = x + bounds.width + 24
  }
  const output = pages.map((page) => {
    if (page.rail) page.shapes.push({ ...page.rail, start: { x: page.min - 20, y: page.rail.start.y },
      end: { x: page.max + 20, y: page.rail.end.y } })
    if (page.rail) for (const header of headers.filter((shape) => shape.groupId === rails.find((rail) => rail.id === page.sourceRailId)?.groupId)) {
      if (header.kind !== 'text') continue
      page.shapes.push({ ...header, id: nextId(), position: { x: page.min - 20, y: page.rail.start.y + 42 },
        text: header.text.split(' · ').filter((part) => !/^(?:BLAD|VAN|VERVOLG)\s/.test(part)).join(' · ') })
    }
    return centerOneWireContent(page.shapes, area).shapes
  })
  return { pages: output, changed: true, fits: output.every((page) => {
    const b = box(page)
    return b.width <= area.width - 48 && b.height <= area.height - 48
  }) }
}
