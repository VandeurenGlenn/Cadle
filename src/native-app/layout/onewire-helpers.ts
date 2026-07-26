import { GRID_SIZE } from '../constants.js'
import { oneWireSymbolNodeInfo, oneWireSymbolRotationFor } from './onewire-symbol-nodes.js'
import type { LineShape, Point, Shape, SymbolShape, TextShape } from '../../native-draw/types.js'

type SymbolBounds = {
  x: number
  y: number
  width: number
  height: number
}

type OneWireComponentKind = 'breaker' | 'switch' | 'kamrail' | 'load'

type OneWireCatalogComponent = {
  bindingId: string
  kind: 'switch' | 'load'
  sourceShapeId?: string
  sourcePath?: string
  sourceName?: string
  breakerCurrentA?: number
  cableSectionMm2?: number
  poles?: number
  breakerCurve?: string
}

type OneWireBundleOptions = {
  amps: number
  cableSectionMm2?: number
  poles?: number
  phaseConfiguration?: 'single-phase' | 'three-phase'
  breakerCurve?: string
  family: string
  autoIncludeFamily: boolean
}

type OneWireResolvedComponent = {
  bindingId: string
  kind: 'switch' | 'load'
  sourcePath?: string
  sourceName?: string
  sourceShapeId?: string
  breakerCurrentA?: number
  cableSectionMm2?: number
  poles?: number
  breakerCurve?: string
}

type OneWireBuilderDeps = {
  nextShapeId: () => string
  oneWireComponentSymbol: (kind: OneWireComponentKind) => { name: string; path: string }
  oneWireSymbolScale: (path: string, kind: OneWireComponentKind) => number
  symbolContentBounds: (shape: SymbolShape) => SymbolBounds
  branchStroke: string
  kamrailAttachOffset: number
}

export type BuildKamrailCircuitBundleInput = {
  rail: LineShape
  anchorX: number
  options: OneWireBundleOptions
  familyComponents: OneWireCatalogComponent[]
} & OneWireBuilderDeps

export type BuildKamrailCircuitBundleResult = {
  shapes: Shape[]
  createdIds: string[]
  selectedId: string | null
}

type RowSymbolSpec = {
  kind: 'switch' | 'load'
  component: { name: string; path: string }
  scale: number
  node: ReturnType<typeof oneWireSymbolNodeInfo>
  rotation: number | undefined
  leftReach: number
  rightReach: number
}

const snapToGrid = (value: number): number => Math.round(value / GRID_SIZE) * GRID_SIZE

const resolveOrderedRows = (components: OneWireResolvedComponent[]): Array<[string, OneWireResolvedComponent[]]> => {
  const rows = new Map<string, OneWireResolvedComponent[]>()
  for (const entry of components) {
    const existing = rows.get(entry.bindingId)
    if (existing) existing.push(entry)
    else rows.set(entry.bindingId, [entry])
  }

  return [...rows.entries()].sort((a, b) => {
    const parse = (value: string): { letter: string; number: number } => {
      const match = /^([A-Z]+)(\d+)?$/.exec(value)
      return { letter: match?.[1] ?? value, number: Number(match?.[2] ?? '0') }
    }
    const ka = parse(a[0])
    const kb = parse(b[0])
    if (ka.letter !== kb.letter) return ka.letter.localeCompare(kb.letter)
    return ka.number - kb.number
  })
}

export const buildOneWireBreakerSection = (
  railY: number,
  startX: number,
  bindingId: string,
  familyLabel: string,
  deps: OneWireBuilderDeps,
  specification?: Pick<OneWireBundleOptions, 'amps' | 'poles' | 'phaseConfiguration' | 'cableSectionMm2'>
): { shapes: Shape[]; ids: string[]; breakerContentTopY: number } => {
  const x = snapToGrid(startX)
  const component = deps.oneWireComponentSymbol('breaker')
  const scale = deps.oneWireSymbolScale(component.path, 'breaker')
  const nodeInfo = oneWireSymbolNodeInfo(component.path, scale)

  const nodeOffsetX = nodeInfo?.offset.x ?? 0
  const nodeOffsetY = nodeInfo?.offset.y ?? 0
  const snappedY = snapToGrid(railY - deps.kamrailAttachOffset)
  const center: Point = { x: x - nodeOffsetX - 0.9, y: snappedY - nodeOffsetY }
  const groupId = `onewire-${deps.nextShapeId()}`

  const symbol: SymbolShape = {
    id: deps.nextShapeId(),
    kind: 'symbol',
    position: center,
    name: component.name,
    path: component.path,
    scale,
    strokeWidth: 0.5,
    bindingId,
    groupId
  }
  symbol.symbolTextOverrides = {
    'desc:nP': `${specification?.poles ?? 2}P`,
    'desc:n': specification?.phaseConfiguration === 'three-phase' ? '3N' : '1N',
    'desc:20A': `${specification?.amps ?? 20}A`
  }

  const connector: LineShape = {
    id: deps.nextShapeId(),
    kind: 'line',
    start: { x, y: snapToGrid(snappedY) },
    end: { x: snapToGrid(x), y: snapToGrid(railY) },
    stroke: deps.branchStroke,
    strokeWidth: 1.25,
    bindingId,
    groupId
  }

  const label: TextShape = {
    id: deps.nextShapeId(),
    kind: 'text',
    position: { x: x - 4, y: railY + 24 },
    text: familyLabel,
    scale: 0.7,
    fill: '#000000',
    stroke: 'none',
    bindingId,
    groupId
  }

  const specificationLabel: TextShape = {
    id: deps.nextShapeId(), kind: 'text', position: { x: x - 35, y: railY + 48 },
    text: `C${specification?.amps ?? 20} · ${specification?.poles ?? 2}P · ${specification?.cableSectionMm2 ?? 1.5} mm²`,
    fill: '#000000', stroke: 'none', scale: 0.55, bindingId, groupId
  }

  const breakerContentTopY = deps.symbolContentBounds(symbol).y
  return {
    shapes: [connector, symbol, label, specificationLabel],
    ids: [connector.id, symbol.id, label.id, specificationLabel.id],
    breakerContentTopY
  }
}

export const buildOneWireRowSection = (
  rowIndex: number,
  row: [string, OneWireResolvedComponent[]],
  railY: number,
  startX: number,
  deps: OneWireBuilderDeps
): { shapes: Shape[]; ids: string[] } => {
  const ROW_NUMBER_OFFSET_X = -25
  const ROW_SYMBOL_MARGIN_X = 0
  const ROW_TOP_OFFSET_Y = 130
  const ROW_SPACING_Y = 50

  const [bindingId, entries] = row
  const rowY = railY - ROW_TOP_OFFSET_Y - rowIndex * ROW_SPACING_Y
  const rowJunctionX = snapToGrid(startX)
  const symbolBaseX = snapToGrid(rowJunctionX + 48)
  const rowGroupId = `onewire-${deps.nextShapeId()}`

  const resolvedEntryPath = (entry: OneWireResolvedComponent): string =>
    entry.sourcePath ?? deps.oneWireComponentSymbol(entry.kind).path

  const lampEntries = entries.filter(
    (entry) => entry.kind === 'load' && /lighting|lamp|fluorescent/i.test(resolvedEntryPath(entry))
  )
  const lampCount = lampEntries.length
  const collapsedEntries =
    lampCount > 1 ? [...entries.filter((entry) => !lampEntries.includes(entry)), lampEntries[0]] : entries

  const sortedByKind = [...collapsedEntries].sort((a, b) => {
    const aPath = resolvedEntryPath(a)
    const bPath = resolvedEntryPath(b)
    const aIsIntermediate = a.kind === 'switch' && /intermediate switch/i.test(aPath)
    const bIsIntermediate = b.kind === 'switch' && /intermediate switch/i.test(bPath)

    if (!aIsIntermediate && aPath && a.kind === 'switch' && (bIsIntermediate || b.kind !== 'switch')) return -1
    if (!bIsIntermediate && bPath && b.kind === 'switch' && (aIsIntermediate || a.kind !== 'switch')) return 1
    if (aIsIntermediate && !bIsIntermediate) return -1
    if (!aIsIntermediate && bIsIntermediate) return 1
    return 0
  })

  const hasIntermediate = sortedByKind.some(
    (e) => e.kind === 'switch' && /intermediate switch/i.test(resolvedEntryPath(e))
  )
  const hasRegular = sortedByKind.some((e) => e.kind === 'switch' && !/intermediate switch/i.test(resolvedEntryPath(e)))

  let orderedEntries = sortedByKind
  if (hasIntermediate && hasRegular) {
    const regular = sortedByKind.filter(
      (e) => e.kind === 'switch' && !/intermediate switch/i.test(resolvedEntryPath(e))
    )
    const intermediate = sortedByKind.filter(
      (e) => e.kind === 'switch' && /intermediate switch/i.test(resolvedEntryPath(e))
    )
    const loads = sortedByKind.filter((e) => e.kind !== 'switch')
    orderedEntries =
      regular.length > 1
        ? [regular[0], ...intermediate, ...regular.slice(1), ...loads]
        : [...regular, ...intermediate, ...loads]
  }

  const rowSymbolSpecs: RowSymbolSpec[] = orderedEntries.map((entry) => {
    const fallback = deps.oneWireComponentSymbol(entry.kind)
    const component = { name: entry.sourceName ?? fallback.name, path: entry.sourcePath ?? fallback.path }
    const scale = deps.oneWireSymbolScale(component.path, entry.kind)
    const node = oneWireSymbolNodeInfo(component.path, scale)
    const rotation = oneWireSymbolRotationFor(component.path)
    const probeSlotX = 0
    const probe: SymbolShape = {
      id: deps.nextShapeId(),
      kind: 'symbol',
      position: node ? { x: probeSlotX - node.offset.x, y: rowY - node.offset.y } : { x: probeSlotX, y: rowY },
      name: component.name,
      path: component.path,
      scale,
      bindingId,
      groupId: rowGroupId
    }
    if (typeof rotation === 'number') probe.rotation = rotation
    const bounds = deps.symbolContentBounds(probe)
    return {
      kind: entry.kind,
      component,
      scale,
      node,
      rotation,
      leftReach: probeSlotX - bounds.x,
      rightReach: bounds.x + bounds.width - probeSlotX
    }
  })

  const slotXs: number[] = []
  for (const [symbolIndex, spec] of rowSymbolSpecs.entries()) {
    if (symbolIndex === 0) {
      slotXs.push(snapToGrid(symbolBaseX))
      continue
    }
    const prevSpec = rowSymbolSpecs[symbolIndex - 1]
    const prevX = slotXs[symbolIndex - 1]
    const gap =
      prevSpec.kind === 'switch' && spec.kind === 'switch'
        ? 30
        : prevSpec.kind === 'switch' && spec.kind === 'load'
          ? 30
          : prevSpec.rightReach + spec.leftReach + ROW_SYMBOL_MARGIN_X
    slotXs.push(snapToGrid(prevX + gap))
  }

  const rowSymbols: SymbolShape[] = rowSymbolSpecs.map((spec, symbolIndex) => {
    const slot: Point = { x: slotXs[symbolIndex] ?? symbolBaseX, y: rowY }
    const isLighting = /lighting|lamp|fluorescent/i.test(spec.component.path)
    const symbol: SymbolShape = {
      id: deps.nextShapeId(),
      kind: 'symbol',
      position: spec.node ? { x: slot.x - spec.node.offset.x, y: slot.y - spec.node.offset.y } : slot,
      name: spec.component.name,
      path: spec.component.path,
      scale: spec.scale,
      strokeWidth: isLighting ? 0.5 : 0.65,
      bindingId,
      groupId: rowGroupId
    }
    const source = orderedEntries[symbolIndex]
    symbol.sourceLink = {
      kind: source?.sourceShapeId ? 'device' : 'circuit',
      id: source?.sourceShapeId ?? bindingId,
      role: spec.kind
    }
    symbol.generationKey = `device:${source?.sourceShapeId ?? `${bindingId}:${spec.kind}:${symbolIndex}`}`
    if (typeof spec.rotation === 'number') symbol.rotation = spec.rotation
    return symbol
  })

  let cursor = rowJunctionX
  let wireEndX = rowJunctionX
  const wireSegments: Array<{ from: number; to: number }> = []
  for (const [symbolIndex, symbol] of rowSymbols.entries()) {
    const node = oneWireSymbolNodeInfo(symbol.path, symbol.scale)
    const slotX = slotXs[symbolIndex] ?? symbolBaseX
    const spec = rowSymbolSpecs[symbolIndex]

    if (node) {
      if (node.cutHalfWidth === null) {
        wireEndX = Math.max(wireEndX, slotX)
        continue
      }
      const from = slotX - node.cutHalfWidth
      const to = slotX + node.cutHalfWidth
      if (from > cursor + 0.5) wireSegments.push({ from: cursor, to: from })
      cursor = Math.max(cursor, to)
      wireEndX = Math.max(wireEndX, cursor)
      continue
    }

    if (spec?.kind === 'load') {
      const bounds = deps.symbolContentBounds(symbol)
      const leftReach = Math.max(0, slotX - bounds.x)
      const rightReach = Math.max(0, bounds.x + bounds.width - slotX)
      const centeredHalfWidth = Math.max(2, Math.min(leftReach, rightReach))
      const from = slotX - centeredHalfWidth
      const to = slotX + centeredHalfWidth
      if (from > cursor + 0.5) wireSegments.push({ from: cursor, to: from })
      cursor = Math.max(cursor, to)
      wireEndX = Math.max(wireEndX, cursor)
      continue
    }

    const bounds = deps.symbolContentBounds(symbol)
    if (bounds.x > cursor + 0.5) wireSegments.push({ from: cursor, to: bounds.x })
    cursor = Math.max(cursor, bounds.x + bounds.width)
    wireEndX = Math.max(wireEndX, cursor)
  }

  if (wireEndX > cursor + 0.5) wireSegments.push({ from: cursor, to: wireEndX })
  const lastSlotX = slotXs.length ? slotXs[slotXs.length - 1] : symbolBaseX

  const shapes: Shape[] = []
  const ids: string[] = []

  for (const segment of wireSegments) {
    const wire: LineShape = {
      id: deps.nextShapeId(), kind: 'line', start: { x: segment.from, y: rowY }, end: { x: segment.to, y: rowY },
      stroke: deps.branchStroke, strokeWidth: 1.25, bindingId, groupId: rowGroupId
    }
    shapes.push(wire)
    ids.push(wire.id)
  }

  const bindingNumberMatch = /^([A-Z]+)(\d+)$/.exec(bindingId)
  const rowNumber = bindingNumberMatch ? Number(bindingNumberMatch[2]) : rowIndex + 1
  const rowNumberText = `${rowNumber}`
  const rowNumberX = rowJunctionX + ROW_NUMBER_OFFSET_X - Math.max(0, rowNumberText.length - 1) * 7
  const rowNumberLabel: TextShape = {
    id: deps.nextShapeId(),
    kind: 'text',
    position: { x: rowNumberX, y: rowY + 5 },
    text: rowNumberText,
    fill: '#000000',
    scale: 0.7,
    bindingId,
    groupId: rowGroupId
  }
  rowNumberLabel.sourceLink = { kind: 'circuit', id: bindingId, role: 'number-label' }
  rowNumberLabel.generationKey = `circuit:${bindingId}:number-label`
  shapes.push(rowNumberLabel)
  ids.push(rowNumberLabel.id)

  if (lampCount > 1) {
    const countLabel: TextShape = {
      id: deps.nextShapeId(),
      kind: 'text',
      position: { x: lastSlotX + 26, y: rowY + 5 },
      text: `x${lampCount}`,
      fill: '#000000',
      scale: 0.7,
      bindingId,
      groupId: rowGroupId
    }
    shapes.push(countLabel)
    ids.push(countLabel.id)
  }

  for (const symbol of rowSymbols) {
    shapes.push(symbol)
    ids.push(symbol.id)
  }

  return { shapes, ids }
}

export const buildKamrailCircuitBundle = (
  input: BuildKamrailCircuitBundleInput
): BuildKamrailCircuitBundleResult | null => {
  const { rail, anchorX, options, familyComponents, ...deps } = input

  const clampX = Math.max(
    Math.min(anchorX, Math.max(rail.start.x, rail.end.x) - 20),
    Math.min(rail.start.x, rail.end.x) + 20
  )
  const startX = snapToGrid(clampX)
  const resolvedComponents: OneWireResolvedComponent[] = familyComponents.length
    ? familyComponents
    : [{ bindingId: `${options.family}1`, kind: 'load', sourcePath: undefined, sourceName: undefined }]

  const orderedRows = resolveOrderedRows(resolvedComponents)
  const railY = rail.start.y
  const createdIds: string[] = []
  const shapes: Shape[] = []

  const breaker = buildOneWireBreakerSection(railY, startX, options.family, options.family, deps, options)
  breaker.shapes.forEach((shape, index) => {
    shape.sourceLink = { kind: 'board', id: options.family, role: index === 1 ? 'breaker' : index === 0 ? 'feed' : 'label' }
    shape.generationKey = `board:${options.family}:${shape.sourceLink.role}`
  })
  shapes.push(...breaker.shapes)
  createdIds.push(...breaker.ids)

  if (orderedRows.length > 0) {
    const ROW_TOP_OFFSET_Y = 130
    const ROW_SPACING_Y = 50
    const trunkTopY = snapToGrid(railY - ROW_TOP_OFFSET_Y - (orderedRows.length - 1) * ROW_SPACING_Y)
    const trunk: LineShape = {
      id: deps.nextShapeId(),
      kind: 'line',
      start: { x: snapToGrid(startX), y: snapToGrid(breaker.breakerContentTopY) },
      end: { x: snapToGrid(startX), y: trunkTopY },
      stroke: deps.branchStroke,
      strokeWidth: 1.25,
      bindingId: options.family,
      groupId: `onewire-${deps.nextShapeId()}`
    }
    trunk.sourceLink = { kind: 'board', id: options.family, role: 'trunk' }
    trunk.generationKey = `board:${options.family}:trunk`
    shapes.push(trunk)
    createdIds.push(trunk.id)
  }

  for (const [rowIndex, row] of orderedRows.entries()) {
    const rowSection = buildOneWireRowSection(rowIndex, row, railY, startX, deps)
    shapes.push(...rowSection.shapes)
    createdIds.push(...rowSection.ids)
  }

  if (!createdIds.length) return null
  return {
    shapes,
    createdIds,
    selectedId: createdIds[1] ?? createdIds[0] ?? null
  }
}
