import { GRID_SIZE } from '../constants.js'
import { oneWireSymbolNodeInfo, oneWireSymbolRotationFor } from './onewire-symbol-nodes.js'
import type { LineShape, Point, Shape, SymbolShape, TextShape } from '../../editor/model/types.js'

type SymbolBounds = {
  x: number
  y: number
  width: number
  height: number
}

type OneWireComponentKind = 'breaker' | 'switch' | 'kamrail' | 'load'

type OneWireCatalogComponent = {
  bindingId: string
  kind: 'switch' | 'load' | 'empty'
  sourceShapeId?: string
  sourcePath?: string
  sourceName?: string
  breakerCurrentA?: number
  cableSectionMm2?: number
  poles?: number
  breakerCurve?: string
}

export type OneWireCableInstallation =
  | 'conduit'
  | 'conduit-recessed'
  | 'without-conduit'
  | 'on-wall'
  | 'recessed'
  | 'underground'

type OneWireBundleOptions = {
  amps: number
  cableSectionMm2?: number
  cableConductors?: number
  cableType?: string
  cableInstallation?: OneWireCableInstallation
  poles?: number
  phaseConfiguration?: 'single-phase' | 'three-phase' | 'L1+N' | 'L2+N' | 'L3+N' | 'L1+L2+L3+N'
  breakerCurve?: string
  family: string
  autoIncludeFamily: boolean
}

type OneWireResolvedComponent = {
  bindingId: string
  kind: 'switch' | 'load' | 'empty'
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
  isSpot: boolean
  repeatCount: number
  scale: number
  node: ReturnType<typeof oneWireSymbolNodeInfo>
  rotation: number | undefined
  leftReach: number
  symbolRightReach: number
  rightReach: number
}

const snapToGrid = (value: number): number => Math.round(value / GRID_SIZE) * GRID_SIZE
const ONE_WIRE_FIRST_ROW_OFFSET_Y = 180
const ONE_WIRE_ROW_SPACING_Y = 40

export const oneWirePhaseLabelText = (phase: OneWireBundleOptions['phaseConfiguration'] | undefined): string => {
  if (phase === 'three-phase') return '3N'
  if (phase === 'single-phase' || !phase) return '1N'
  return phase
}

const ONE_WIRE_CABLE_INSTALLATION_PATHS: Record<OneWireCableInstallation, string> = {
  conduit: 'symbols/Wires/Cable in conduit.svg',
  'conduit-recessed': 'symbols/Wires/Cable in conduit recessed in wall.svg',
  'without-conduit': 'symbols/Wires/Cable without conduit.svg',
  'on-wall': 'symbols/Wires/Cable on wall.svg',
  recessed: 'symbols/Wires/Cable recessed in wall.svg',
  underground: 'symbols/Wires/Underground cable.svg'
}

export const oneWireCableInstallationPath = (installation: OneWireCableInstallation): string =>
  ONE_WIRE_CABLE_INSTALLATION_PATHS[installation]

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
  specification?: Pick<
    OneWireBundleOptions,
    | 'amps'
    | 'poles'
    | 'phaseConfiguration'
    | 'cableSectionMm2'
    | 'cableConductors'
    | 'cableType'
    | 'cableInstallation'
    | 'breakerCurve'
  >,
  railStrokeWidth = 10
): { shapes: Shape[]; ids: string[]; breakerContentTopY: number } => {
  const x = snapToGrid(startX)
  const component = deps.oneWireComponentSymbol('breaker')
  const scale = deps.oneWireSymbolScale(component.path, 'breaker')
  const nodeInfo = oneWireSymbolNodeInfo(component.path, scale)

  const nodeOffsetX = nodeInfo?.offset.x ?? 0
  const nodeOffsetY = nodeInfo?.offset.y ?? 0
  // The breaker's bottom terminal sits on the upper edge of the thick rail,
  // rather than disappearing into its centre line.
  const snappedY = railY - railStrokeWidth / 2
  // Place the symbol from its electrical node, not from its visual bounds.
  // The breaker terminal must remain exactly collinear with the feeder.
  const center: Point = { x: x - nodeOffsetX, y: snappedY - nodeOffsetY }
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

  const breakerBounds = deps.symbolContentBounds(symbol)
  const polesLabel: TextShape = {
    id: deps.nextShapeId(),
    kind: 'text',
    position: { x: x - 33, y: center.y + 4 },
    text: `${specification?.poles ?? 2}P`,
    fill: '#000000',
    stroke: 'none',
    scale: 0.55,
    bindingId,
    groupId
  }
  const currentLabel: TextShape = {
    id: deps.nextShapeId(),
    kind: 'text',
    position: { x: x + 8, y: center.y + 4 },
    text: `${specification?.breakerCurve ?? 'C'}${specification?.amps ?? 20}A`,
    fill: '#000000',
    stroke: 'none',
    scale: 0.65,
    bindingId,
    groupId
  }
  const phaseLabel: TextShape = {
    id: deps.nextShapeId(),
    kind: 'text',
    position: {
      x: x - 33,
      y: Math.min(breakerBounds.y + breakerBounds.height + 8, railY - 12)
    },
    text: oneWirePhaseLabelText(specification?.phaseConfiguration),
    fill: '#000000',
    stroke: 'none',
    scale: 0.65,
    bindingId,
    groupId
  }
  const cableSectionLabel: TextShape = {
    id: deps.nextShapeId(),
    kind: 'text',
    position: { x: x + 18, y: breakerBounds.y + 16 },
    text: `${specification?.cableConductors ?? 3}G${specification?.cableSectionMm2 ?? 1.5} mm² ${(specification?.cableType ?? 'VOB').replace('-', ' ')}`,
    fill: '#000000',
    stroke: 'none',
    scale: 0.65,
    rotation: -90,
    bindingId,
    groupId
  }
  const cableInstallation = specification?.cableInstallation ?? 'conduit-recessed'
  const cableInstallationSymbol: SymbolShape = {
    id: deps.nextShapeId(),
    kind: 'symbol',
    position: { x, y: breakerBounds.y - 28 },
    name: `Cable ${cableInstallation}`,
    path: oneWireCableInstallationPath(cableInstallation),
    scale: 3,
    strokeWidth: 1,
    bindingId,
    groupId,
    symbolTextOverrides: {
      'desc:VOB X x Ymm²': '',
      'desc:n': ''
    }
  }

  const linkedShapes: Array<[Shape, string]> = [
    [symbol, 'breaker'],
    [label, 'label'],
    [polesLabel, 'breaker-poles'],
    [currentLabel, 'breaker-current'],
    [phaseLabel, 'breaker-phase'],
    [cableSectionLabel, 'cable-section'],
    [cableInstallationSymbol, 'cable-installation']
  ]
  for (const [shape, role] of linkedShapes) {
    shape.sourceLink = { kind: 'board', id: familyLabel, role }
    shape.generationKey = `board:${familyLabel}:${role}`
  }

  const breakerContentTopY = breakerBounds.y
  return {
    shapes: linkedShapes.map(([shape]) => shape),
    ids: linkedShapes.map(([shape]) => shape.id),
    breakerContentTopY
  }
}

export const buildOneWireRowSection = (
  rowIndex: number,
  row: [string, OneWireResolvedComponent[]],
  railY: number,
  startX: number,
  deps: OneWireBuilderDeps,
  compactSingleCircuit = false
): { shapes: Shape[]; ids: string[] } => {
  const ROW_NUMBER_OFFSET_X = -25
  const ROW_SYMBOL_MARGIN_X = 0
  const SPOT_LEADING_MARGIN_X = 10
  const [bindingId, entries] = row
  const rowY = railY - ONE_WIRE_FIRST_ROW_OFFSET_Y - rowIndex * ONE_WIRE_ROW_SPACING_Y
  const rowJunctionX = snapToGrid(startX)
  const drawableEntryCount = entries.filter((entry) => entry.kind !== 'empty').length
  const placeDirectlyOnTrunk = compactSingleCircuit && drawableEntryCount === 1
  const symbolBaseX = snapToGrid(placeDirectlyOnTrunk ? rowJunctionX : rowJunctionX + 48)
  const rowGroupId = `onewire-${deps.nextShapeId()}`

  const resolvedEntryPath = (entry: OneWireResolvedComponent): string =>
    entry.sourcePath ?? deps.oneWireComponentSymbol(entry.kind === 'empty' ? 'load' : entry.kind).path

  const repeatedLightingCounts = new Map<string, number>()
  const seenLightingPaths = new Set<string>()
  const collapsedEntries = entries.filter((
    entry
  ): entry is OneWireResolvedComponent & { kind: 'switch' | 'load' } => {
    if (entry.kind === 'empty') return false
    const path = resolvedEntryPath(entry)
    if (entry.kind !== 'load' || !/lighting|lamp|fluorescent|spot|wall light/i.test(path)) return true
    const key = path.toLowerCase()
    repeatedLightingCounts.set(key, (repeatedLightingCounts.get(key) ?? 0) + 1)
    if (seenLightingPaths.has(key)) return false
    seenLightingPaths.add(key)
    return true
  })

  const sortedByKind = [...collapsedEntries].sort((a, b) => {
    const aPath = resolvedEntryPath(a)
    const bPath = resolvedEntryPath(b)
    const aIsIntermediate = a.kind === 'switch' && /intermediate switch/i.test(aPath)
    const bIsIntermediate = b.kind === 'switch' && /intermediate switch/i.test(bPath)

    if (!aIsIntermediate && aPath && a.kind === 'switch' && (bIsIntermediate || b.kind !== 'switch')) return -1
    if (!bIsIntermediate && bPath && b.kind === 'switch' && (aIsIntermediate || a.kind !== 'switch')) return 1
    if (aIsIntermediate && !bIsIntermediate) return -1
    if (!aIsIntermediate && bIsIntermediate) return 1

    const aIsSpot = a.kind === 'load' && /(?:^|[\/\s])spot(?:light)?(?:\.svg)?$/i.test(`${aPath} ${a.sourceName ?? ''}`)
    const bIsSpot = b.kind === 'load' && /(?:^|[\/\s])spot(?:light)?(?:\.svg)?$/i.test(`${bPath} ${b.sourceName ?? ''}`)
    if (aIsSpot !== bIsSpot) return aIsSpot ? 1 : -1
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
    const repeatCount = repeatedLightingCounts.get(component.path.toLowerCase()) ?? 1
    const symbolRightReach = bounds.x + bounds.width - probeSlotX
    const isSpot = /(?:^|[\/\s])spot(?:light)?(?:\.svg)?$/i.test(`${component.path} ${component.name}`)
    return {
      kind: entry.kind,
      component,
      isSpot,
      repeatCount,
      scale,
      node,
      rotation,
      leftReach: probeSlotX - bounds.x,
      symbolRightReach,
      rightReach: symbolRightReach + (repeatCount > 1 ? 28 : 0)
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
          : prevSpec.rightReach + spec.leftReach + ROW_SYMBOL_MARGIN_X + (spec.isSpot ? SPOT_LEADING_MARGIN_X : 0)
    slotXs.push(snapToGrid(prevX + gap))
  }

  const rowSymbols: SymbolShape[] = rowSymbolSpecs.map((spec, symbolIndex) => {
    const slot: Point = { x: slotXs[symbolIndex] ?? symbolBaseX, y: rowY }
    const isLighting = /lighting|lamp|fluorescent/i.test(spec.component.path)
    const isFluorescent = /fluorescent/i.test(`${spec.component.path} ${spec.component.name}`)
    const isWallLight = /wall light/i.test(`${spec.component.path} ${spec.component.name}`)
    const symbol: SymbolShape = {
      id: deps.nextShapeId(),
      kind: 'symbol',
      position: spec.node ? { x: slot.x - spec.node.offset.x, y: slot.y - spec.node.offset.y } : slot,
      name: spec.component.name,
      path: spec.component.path,
      scale: spec.scale,
      strokeWidth: isFluorescent ? 1 : isWallLight ? 0.65 : isLighting ? 0.5 : 0.65,
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
  const shapes: Shape[] = []
  const ids: string[] = []

  for (const segment of wireSegments) {
    const wire: LineShape = {
      id: deps.nextShapeId(),
      kind: 'line',
      start: { x: segment.from, y: rowY },
      end: { x: segment.to, y: rowY },
      stroke: deps.branchStroke,
      strokeWidth: 1.25,
      bindingId,
      groupId: rowGroupId
    }
    shapes.push(wire)
    ids.push(wire.id)
  }

  if (!compactSingleCircuit) {
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
  }

  for (const [symbolIndex, spec] of rowSymbolSpecs.entries()) {
    if (spec.repeatCount <= 1) continue
    const countLabel: TextShape = {
      id: deps.nextShapeId(),
      kind: 'text',
      position: {
        x: (slotXs[symbolIndex] ?? symbolBaseX) + spec.symbolRightReach + 6,
        y: rowY + 5
      },
      text: `x${spec.repeatCount}`,
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
  if (options.autoIncludeFamily && familyComponents.length === 0) return null
  const resolvedComponents: OneWireResolvedComponent[] = familyComponents.length
    ? familyComponents
    : [{ bindingId: `${options.family}1`, kind: 'load', sourcePath: undefined, sourceName: undefined }]

  const orderedRows = resolveOrderedRows(resolvedComponents)
  const drawableRows = orderedRows.filter(([, entries]) => entries.some((entry) => entry.kind !== 'empty'))
  const compactSingleCircuit = orderedRows.length === 1
  const railY = rail.start.y
  const createdIds: string[] = []
  const shapes: Shape[] = []

  const breaker = buildOneWireBreakerSection(
    railY,
    startX,
    options.family,
    options.family,
    deps,
    options,
    rail.strokeWidth ?? 10
  )
  shapes.push(...breaker.shapes)
  createdIds.push(...breaker.ids)

  if (drawableRows.length > 0) {
    const trunkTopY = snapToGrid(
      railY - ONE_WIRE_FIRST_ROW_OFFSET_Y - (drawableRows.length - 1) * ONE_WIRE_ROW_SPACING_Y
    )
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

  for (const [rowIndex, row] of drawableRows.entries()) {
    const rowSection = buildOneWireRowSection(
      rowIndex,
      row,
      railY,
      startX,
      deps,
      compactSingleCircuit
    )
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
