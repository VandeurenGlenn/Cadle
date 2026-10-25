import { GRID_SIZE } from '../constants.js'
import { PAPER_LABEL_FONT_SIZE, paperTextScale } from './page-layout.js'
import {
  ONE_WIRE_COLUMN_GAP_X,
  ONE_WIRE_FIRST_ROW_OFFSET_Y,
  ONE_WIRE_ROW_SPACING_Y
} from './onewire-layout-plan.js'
import { phaseConfigurationLabel, neutralPositionForManufacturer, shouldShowPhaseLabel } from '../model/electrical.js'
import {
  oneWireSymbolBounds,
  oneWireSymbolNodeInfo,
  oneWireSymbolRotationFor,
  oneWireSymbolScaleFor,
  oneWireSymbolStrokeWidthFor,
  oneWireSymbolTerminalInfo
} from './onewire-symbol-nodes.js'
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
  hasProtectiveConductor?: boolean
  cableType?: string
  cableInstallation?: OneWireCableInstallation
  showCableInstallation?: boolean
  poles?: number
  phaseConfiguration?: 'single-phase' | 'three-phase' | 'L1+N' | 'L2+N' | 'L3+N' | 'L1+L2+L3+N'
  manufacturer?: string
  neutralPosition?: 'left' | 'right'
  showPhaseLabel?: boolean
  breakerCurve?: string
  family: string
  autoIncludeFamily: boolean
  omitBreaker?: boolean
  hideFamilyLabel?: boolean
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
  minimumRowY?: number
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
const ONE_WIRE_COLUMN_SPACING_X = 200
export const ONE_WIRE_CONDUCTOR_STROKE_WIDTH = 2
const ONE_WIRE_LABEL_SCALE = paperTextScale(2.75)
const ONE_WIRE_TECHNICAL_LABEL_SCALE = paperTextScale(2.5)
const ONE_WIRE_LABEL_WEIGHT = 500
const ONE_WIRE_TECHNICAL_LABEL_WEIGHT = 400
const ONE_WIRE_BREAKER_RAIL_GAP = 40

export const oneWirePhaseLabelText = (
  phase: OneWireBundleOptions['phaseConfiguration'] | undefined,
  neutralPosition: OneWireBundleOptions['neutralPosition'] = 'right'
): string => {
  return phaseConfigurationLabel(phase, neutralPosition)
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

export const oneWireCableInstallationLabel = (installation: OneWireCableInstallation): string =>
  ({
    conduit: 'In conduit',
    'conduit-recessed': 'In conduit, recessed in wall',
    'without-conduit': 'Without conduit',
    'on-wall': 'On wall',
    recessed: 'Recessed in wall',
    underground: 'Underground'
  })[installation]

const IMPULSE_RELAY_PATH = 'symbols/Switches/Impulse relay.svg'
const CONTROL_DEVICE_PATH =
  /switches\/(?:impulse relay|time switch|thermostat|timer|dimmer switch|niko home control dimmer)\.svg$/i
const PUSH_BUTTON_PATH = /switches\/(?:illuminated |double )?push button\.svg$/i

export const oneWireCableLabelText = (cable: {
  conductors?: number
  sectionMm2?: number
  hasProtectiveConductor?: boolean
  cableType?: string
}): string => {
  const hasProtectiveConductor = cable.hasProtectiveConductor ?? cable.conductors !== 4
  const conductorMarker = hasProtectiveConductor ? 'G' : 'X'
  const cableType = cable.cableType?.trim()
  const cableTypeLabel = cableType && cableType !== 'none' ? ` ${cableType.replace('-', ' ')}` : ''
  return `${cable.conductors ?? 3}${conductorMarker}${cable.sectionMm2 ?? 1.5} mm²${cableTypeLabel}`
}

export const oneWireProtectionSymbolPath = (name: string, path: string): string => {
  const searchable = `${name} ${path}`
  if (/residual|differential|differentieel|rcd/i.test(searchable)) {
    return 'symbols/Protection devices/Residual-current circuit breaker.svg'
  }
  if (/automaat|breaker/i.test(searchable)) {
    return 'symbols/Protection devices/Automaat.svg'
  }
  return path
}

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
    | 'manufacturer'
    | 'neutralPosition'
    | 'showPhaseLabel'
    | 'cableSectionMm2'
    | 'cableConductors'
    | 'hasProtectiveConductor'
    | 'cableType'
    | 'cableInstallation'
    | 'showCableInstallation'
    | 'breakerCurve'
  >
): { shapes: Shape[]; ids: string[]; breakerContentTopY: number } => {
  const x = snapToGrid(startX)
  const component = deps.oneWireComponentSymbol('breaker')
  const scale = deps.oneWireSymbolScale(component.path, 'breaker')
  const nodeInfo = oneWireSymbolNodeInfo(component.path, scale)
  const terminals = oneWireSymbolTerminalInfo(component.path, scale)

  const bottomTerminal = terminals?.bottom ?? nodeInfo?.offset ?? { x: 0, y: 0 }
  const breakerBottomY = railY - ONE_WIRE_BREAKER_RAIL_GAP
  // Place the symbol from its electrical node, not from its visual bounds.
  // The breaker terminal must remain exactly collinear with the feeder.
  const center: Point = { x: x - bottomTerminal.x, y: breakerBottomY - bottomTerminal.y }
  const groupId = `onewire-${deps.nextShapeId()}`

  const symbol: SymbolShape = {
    id: deps.nextShapeId(),
    kind: 'symbol',
    position: center,
    name: component.name,
    path: component.path,
    scale,
    strokeWidth: oneWireSymbolStrokeWidthFor(component.path, scale),
    symbolTextOverrides: {
      poles: '',
      phase: '',
      'rated-current': ''
    },
    electrical: {
      role: 'protection',
      oneWireEligible: true,
      breakerCurrentA: specification?.amps ?? 20,
      poles: specification?.poles ?? 2,
      phaseConfiguration: specification?.phaseConfiguration ?? 'single-phase',
      manufacturer: specification?.manufacturer ?? 'Schneider Electric',
      neutralPosition:
        specification?.neutralPosition ??
        neutralPositionForManufacturer(specification?.manufacturer ?? 'Schneider Electric') ??
        'right',
      breakerCurve:
        specification?.breakerCurve === 'B' ||
        specification?.breakerCurve === 'C' ||
        specification?.breakerCurve === 'D' ||
        specification?.breakerCurve === 'other'
          ? specification.breakerCurve
          : 'C'
    },
    bindingId,
    groupId
  }
  const label: TextShape | null = familyLabel.trim()
    ? {
        id: deps.nextShapeId(),
        kind: 'text',
        position: { x, y: railY + 24 },
        textAnchor: 'middle',
        text: familyLabel,
        scale: ONE_WIRE_LABEL_SCALE,
        fontWeight: ONE_WIRE_LABEL_WEIGHT,
        fill: '#000000',
        stroke: 'none',
        bindingId,
        groupId
      }
    : null

  const breakerBounds = deps.symbolContentBounds(symbol)
  const breakerContentTopY = terminals?.top ? center.y + terminals.top.y : breakerBounds.y
  const polesLabel: TextShape = {
    id: deps.nextShapeId(),
    kind: 'text',
    position: { x: x - 16, y: center.y + 5 },
    textAnchor: 'end',
    text: `${specification?.poles ?? 2}P`,
    fill: '#000000',
    stroke: 'none',
    scale: ONE_WIRE_TECHNICAL_LABEL_SCALE,
    fontWeight: ONE_WIRE_TECHNICAL_LABEL_WEIGHT,
    bindingId,
    groupId
  }
  const currentLabel: TextShape = {
    id: deps.nextShapeId(),
    kind: 'text',
    position: { x: x + 12, y: center.y + 5 },
    text: `${specification?.breakerCurve ?? 'C'}${specification?.amps ?? 20}A`,
    fill: '#000000',
    stroke: 'none',
    scale: ONE_WIRE_TECHNICAL_LABEL_SCALE,
    fontWeight: ONE_WIRE_TECHNICAL_LABEL_WEIGHT,
    bindingId,
    groupId
  }
  const phaseLabel: TextShape = {
    id: deps.nextShapeId(),
    kind: 'text',
    position: {
      x: x - 13,
      y: railY - 6
    },
    text: shouldShowPhaseLabel(specification?.poles, specification?.showPhaseLabel)
      ? oneWirePhaseLabelText(
          specification?.phaseConfiguration,
          specification?.neutralPosition ??
            neutralPositionForManufacturer(specification?.manufacturer ?? 'Schneider Electric') ??
            'right'
        )
      : '',
    textAnchor: 'end',
    fill: '#000000',
    stroke: 'none',
    scale: ONE_WIRE_TECHNICAL_LABEL_SCALE,
    fontWeight: ONE_WIRE_TECHNICAL_LABEL_WEIGHT,
    bindingId,
    groupId
  }
  const cableInstallation = specification?.cableInstallation ?? 'conduit-recessed'
  const showCableInstallation = specification?.showCableInstallation !== false
  const cableDesignation = oneWireCableLabelText({
    conductors: specification?.cableConductors,
    sectionMm2: specification?.cableSectionMm2,
    hasProtectiveConductor: specification?.hasProtectiveConductor,
    cableType: specification?.cableType
  })
  const cableSectionLabel: TextShape = {
    id: deps.nextShapeId(),
    kind: 'text',
    position: { x: x + 18, y: breakerContentTopY - 12 },
    text: cableDesignation,
    fill: '#000000',
    stroke: 'none',
    scale: ONE_WIRE_TECHNICAL_LABEL_SCALE,
    fontWeight: ONE_WIRE_TECHNICAL_LABEL_WEIGHT,
    rotation: -90,
    bindingId,
    groupId
  }
  const cableInstallationLabel: TextShape = {
    id: deps.nextShapeId(),
    kind: 'text',
    position: { x: x + 32, y: breakerBounds.y - 10 },
    text: oneWireCableInstallationLabel(cableInstallation),
    fill: '#000000',
    stroke: 'none',
    scale: 0.54,
    fontWeight: ONE_WIRE_TECHNICAL_LABEL_WEIGHT,
    rotation: -90,
    hidden: true,
    bindingId,
    groupId
  }
  const cableInstallationPath = oneWireCableInstallationPath(cableInstallation)
  const cableInstallationScale = oneWireSymbolScaleFor(cableInstallationPath) ?? 1.35
  const installationNode = oneWireSymbolNodeInfo(cableInstallationPath, cableInstallationScale)?.offset ?? {
    x: 0,
    y: 0
  }
  const cableInstallationSymbol: SymbolShape = {
    id: deps.nextShapeId(),
    kind: 'symbol',
    position: { x: x - installationNode.x, y: breakerContentTopY - 8 - installationNode.y },
    name: `Cable ${cableInstallation}`,
    path: cableInstallationPath,
    scale: cableInstallationScale,
    strokeWidth: oneWireSymbolStrokeWidthFor(cableInstallationPath, cableInstallationScale),
    hidden: !showCableInstallation,
    bindingId,
    groupId,
    symbolTextOverrides: {
      'desc:VOB X x Ymm²': '',
      'desc:n': ''
    }
  }

  const feeder: LineShape = {
    id: deps.nextShapeId(),
    kind: 'line',
    start: { x, y: railY },
    end: { x, y: breakerBottomY },
    stroke: deps.branchStroke,
    strokeWidth: ONE_WIRE_CONDUCTOR_STROKE_WIDTH,
    bindingId,
    groupId
  }

  const linkedShapes: Array<[Shape, string]> = [
    [symbol, 'breaker'],
    [feeder, 'breaker-feed'],
    ...(label ? [[label, 'label'] as [Shape, string]] : []),
    [polesLabel, 'breaker-poles'],
    [currentLabel, 'breaker-current'],
    [phaseLabel, 'breaker-phase'],
    [cableSectionLabel, 'cable-section'],
    [cableInstallationSymbol, 'cable-installation'],
    [cableInstallationLabel, 'cable-installation-label']
  ]
  for (const [shape, role] of linkedShapes) {
    shape.sourceLink = { kind: 'board', id: bindingId, role }
    shape.generationKey = `board:${bindingId}:${role}`
  }

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
  compactSingleCircuit = false,
  rowSpacingY = ONE_WIRE_ROW_SPACING_Y
): { shapes: Shape[]; ids: string[] } => {
  const ROW_NUMBER_OFFSET_X = -12
  const ROW_FIRST_SYMBOL_OFFSET_X = 30
  const ROW_SYMBOL_MARGIN_X = 4
  const SPOT_LEADING_MARGIN_X = 0
  const [bindingId, entries] = row
  const rowY = railY - ONE_WIRE_FIRST_ROW_OFFSET_Y - rowIndex * rowSpacingY
  const rowJunctionX = snapToGrid(startX)
  const drawableEntryCount = entries.filter((entry) => entry.kind !== 'empty').length
  const placeDirectlyOnTrunk = compactSingleCircuit && drawableEntryCount === 1
  const symbolBaseX = snapToGrid(placeDirectlyOnTrunk ? rowJunctionX : rowJunctionX + ROW_FIRST_SYMBOL_OFFSET_X)
  const rowGroupId = `onewire-${deps.nextShapeId()}`

  const resolvedEntryPath = (entry: OneWireResolvedComponent): string =>
    entry.sourcePath ?? deps.oneWireComponentSymbol(entry.kind === 'empty' ? 'load' : entry.kind).path

  const hasPushButton = entries.some(
    (entry) => entry.kind === 'switch' && PUSH_BUTTON_PATH.test(resolvedEntryPath(entry))
  )
  const hasLoad = entries.some((entry) => entry.kind === 'load')
  const hasControlDevice = entries.some(
    (entry) => entry.kind === 'switch' && CONTROL_DEVICE_PATH.test(resolvedEntryPath(entry))
  )
  const resolvedEntries: OneWireResolvedComponent[] =
    hasPushButton && hasLoad && !hasControlDevice
      ? [
          ...entries.filter((entry) => entry.kind === 'switch'),
          {
            bindingId,
            kind: 'switch',
            sourcePath: IMPULSE_RELAY_PATH,
            sourceName: 'Impulse relay'
          },
          ...entries.filter((entry) => entry.kind !== 'switch')
        ]
      : entries

  const repeatedLightingCounts = new Map<string, number>()
  const seenLightingPaths = new Set<string>()
  const collapsedEntries = resolvedEntries.filter(
    (entry): entry is OneWireResolvedComponent & { kind: 'switch' | 'load' } => {
      if (entry.kind === 'empty') return false
      const path = resolvedEntryPath(entry)
      if (entry.kind !== 'load' || !/lighting|lamp|fluorescent|spot|wall light/i.test(path)) return true
      const key = path.toLowerCase()
      repeatedLightingCounts.set(key, (repeatedLightingCounts.get(key) ?? 0) + 1)
      if (seenLightingPaths.has(key)) return false
      seenLightingPaths.add(key)
      return true
    }
  )

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
    const inlineRotation = oneWireSymbolRotationFor(component.path)
    const isSocket = /socket|outlet|stopcontact/i.test(`${component.path} ${component.name}`)
    const rotation = placeDirectlyOnTrunk && isSocket ? (inlineRotation ?? 0) - 90 : inlineRotation
    const node = oneWireSymbolNodeInfo(component.path, scale, rotation)
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
    const bounds = oneWireSymbolBounds(probe) ?? deps.symbolContentBounds(probe)
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
      rightReach: symbolRightReach + (repeatCount > 1 ? 6 + `x${repeatCount}`.length * PAPER_LABEL_FONT_SIZE * 0.68 : 0)
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
    const gap = prevSpec.rightReach + spec.leftReach + ROW_SYMBOL_MARGIN_X + (spec.isSpot ? SPOT_LEADING_MARGIN_X : 0)
    slotXs.push(prevX + gap)
  }

  const rowSymbols: SymbolShape[] = rowSymbolSpecs.map((spec, symbolIndex) => {
    const slot: Point = { x: slotXs[symbolIndex] ?? symbolBaseX, y: rowY }
    const symbol: SymbolShape = {
      id: deps.nextShapeId(),
      kind: 'symbol',
      position: spec.node ? { x: slot.x - spec.node.offset.x, y: slot.y - spec.node.offset.y } : slot,
      name: spec.component.name,
      path: spec.component.path,
      scale: spec.scale,
      strokeWidth: oneWireSymbolStrokeWidthFor(spec.component.path, spec.scale),
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
    const node = oneWireSymbolNodeInfo(symbol.path, symbol.scale, symbol.rotation)
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

  for (const [segmentIndex, segment] of wireSegments.entries()) {
    const wire: LineShape = {
      id: deps.nextShapeId(),
      kind: 'line',
      start: { x: segment.from, y: rowY },
      end: { x: segment.to, y: rowY },
      stroke: deps.branchStroke,
      strokeWidth: ONE_WIRE_CONDUCTOR_STROKE_WIDTH,
      bindingId,
      groupId: rowGroupId,
      sourceLink: { kind: 'circuit', id: bindingId, role: 'row-wire' },
      generationKey: `circuit:${bindingId}:wire:${segmentIndex}`
    }
    shapes.push(wire)
    ids.push(wire.id)
  }

  if (!compactSingleCircuit) {
    const bindingNumberMatch = /^([A-Z]+)(\d+)$/.exec(bindingId)
    const rowNumber = bindingNumberMatch ? Number(bindingNumberMatch[2]) : rowIndex + 1
    const rowNumberText = `${rowNumber}`
    const rowNumberX = rowJunctionX + ROW_NUMBER_OFFSET_X
    const rowNumberLabel: TextShape = {
      id: deps.nextShapeId(),
      kind: 'text',
      position: { x: rowNumberX, y: rowY + 5 },
      text: rowNumberText,
      textAnchor: 'end',
      fill: '#000000',
      scale: ONE_WIRE_LABEL_SCALE,
      fontWeight: ONE_WIRE_LABEL_WEIGHT,
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
      scale: ONE_WIRE_LABEL_SCALE,
      fontWeight: ONE_WIRE_TECHNICAL_LABEL_WEIGHT,
      bindingId,
      groupId: rowGroupId
    }
    countLabel.sourceLink = { kind: 'circuit', id: bindingId, role: 'count-label' }
    countLabel.generationKey = `circuit:${bindingId}:count:${symbolIndex}`
    shapes.push(countLabel)
    ids.push(countLabel.id)
  }

  for (const symbol of rowSymbols) {
    shapes.push(symbol)
    ids.push(symbol.id)
  }

  if (compactSingleCircuit && drawableEntryCount > 1) {
    const rotatePointOntoTrunk = (point: Point): Point => ({
      x: rowJunctionX + (point.y - rowY),
      y: rowY - (point.x - rowJunctionX)
    })
    for (const shape of shapes) {
      if (shape.kind === 'line') {
        shape.start = rotatePointOntoTrunk(shape.start)
        shape.end = rotatePointOntoTrunk(shape.end)
        continue
      }
      if (shape.kind === 'symbol') {
        shape.position = rotatePointOntoTrunk(shape.position)
        shape.rotation = (shape.rotation ?? 0) - 90
        continue
      }
      if (shape.kind === 'text') {
        shape.position = rotatePointOntoTrunk(shape.position)
        // Multiplicity labels remain readable horizontally beside the stack.
        shape.position.x += 8
      }
    }
  }

  return { shapes, ids }
}

export const buildKamrailCircuitBundle = (
  input: BuildKamrailCircuitBundleInput
): BuildKamrailCircuitBundleResult | null => {
  const { rail, anchorX, options, familyComponents, minimumRowY, ...deps } = input

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
  const availableRowSpan =
    typeof minimumRowY === 'number' ? railY - ONE_WIRE_FIRST_ROW_OFFSET_Y - minimumRowY : Number.POSITIVE_INFINITY
  const maximumRowsPerColumn = Number.isFinite(availableRowSpan)
    ? Math.max(1, Math.floor(Math.max(0, availableRowSpan) / ONE_WIRE_ROW_SPACING_Y) + 1)
    : Math.max(1, drawableRows.length)
  const columnCount = Math.max(1, Math.ceil(drawableRows.length / maximumRowsPerColumn))
  const baseRowsPerColumn = Math.floor(drawableRows.length / columnCount)
  const columnsWithExtraRow = drawableRows.length % columnCount
  const rowCounts = Array.from(
    { length: columnCount },
    (_, index) => baseRowsPerColumn + (index < columnsWithExtraRow ? 1 : 0)
  )
  const columnXs: number[] = []
  const rowSections: Array<ReturnType<typeof buildOneWireRowSection>> = []
  let rowOffset = 0
  let columnX = startX
  for (const rowCount of rowCounts) {
    columnXs.push(columnX)
    let rightEdge = columnX
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const row = drawableRows[rowOffset + rowIndex]
      if (!row) continue
      const section = buildOneWireRowSection(rowIndex, row, railY, columnX, deps, compactSingleCircuit)
      rowSections.push(section)
      for (const shape of section.shapes) {
        if (shape.kind === 'line') rightEdge = Math.max(rightEdge, shape.start.x, shape.end.x)
        if (shape.kind === 'symbol') {
          const bounds = oneWireSymbolBounds(shape) ?? deps.symbolContentBounds(shape)
          rightEdge = Math.max(rightEdge, bounds.x + bounds.width)
        }
        if (shape.kind === 'text')
          rightEdge = Math.max(rightEdge, shape.position.x + shape.text.length * 11 * (shape.scale ?? 1))
      }
    }
    columnX = Math.ceil(
      Math.max(columnX + ONE_WIRE_COLUMN_SPACING_X, rightEdge + ONE_WIRE_COLUMN_GAP_X) / GRID_SIZE
    ) * GRID_SIZE
    rowOffset += rowCount
  }
  const createdIds: string[] = []
  const shapes: Shape[] = []

  let trunkStartY = railY
  if (!options.omitBreaker) {
    const breaker = buildOneWireBreakerSection(
      railY,
      startX,
      options.family,
      options.hideFamilyLabel ? '' : options.family,
      deps,
      options
    )
    shapes.push(...breaker.shapes)
    createdIds.push(...breaker.ids)
    trunkStartY = breaker.breakerContentTopY
  }

  if (drawableRows.length > 0) {
    const distributionY = trunkStartY
    if (columnCount > 1) {
      const distribution: LineShape = {
        id: deps.nextShapeId(),
        kind: 'line',
        start: { x: snapToGrid(columnXs[0]), y: distributionY },
        end: { x: snapToGrid(columnXs[columnXs.length - 1]), y: distributionY },
        stroke: deps.branchStroke,
        strokeWidth: ONE_WIRE_CONDUCTOR_STROKE_WIDTH,
        bindingId: options.family,
        groupId: `onewire-${deps.nextShapeId()}`,
        sourceLink: { kind: 'board', id: options.family, role: 'trunk-distribution' },
        generationKey: `board:${options.family}:trunk-distribution`
      }
      shapes.push(distribution)
      createdIds.push(distribution.id)
    }

    for (const [columnIndex, columnX] of columnXs.entries()) {
      const rowCount = rowCounts[columnIndex] ?? 0
      const trunkTopY = railY - ONE_WIRE_FIRST_ROW_OFFSET_Y - (rowCount - 1) * ONE_WIRE_ROW_SPACING_Y
      const role = columnIndex === 0 ? 'trunk' : `trunk-${columnIndex + 1}`
      const trunk: LineShape = {
        id: deps.nextShapeId(),
        kind: 'line',
        start: { x: snapToGrid(columnX), y: distributionY },
        end: { x: snapToGrid(columnX), y: trunkTopY },
        stroke: deps.branchStroke,
        strokeWidth: ONE_WIRE_CONDUCTOR_STROKE_WIDTH,
        bindingId: options.family,
        groupId: `onewire-${deps.nextShapeId()}`,
        sourceLink: { kind: 'board', id: options.family, role },
        generationKey: `board:${options.family}:${role}`
      }
      shapes.push(trunk)
      createdIds.push(trunk.id)
    }
  }

  for (const rowSection of rowSections) {
    shapes.push(...rowSection.shapes)
    createdIds.push(...rowSection.ids)
  }

  if (!createdIds.length) return null
  return {
    shapes,
    createdIds,
    // Breaker sections always put their protection symbol first. Selecting it
    // keeps the object pane editable instead of focusing a generated label.
    selectedId: createdIds[0] ?? null
  }
}
