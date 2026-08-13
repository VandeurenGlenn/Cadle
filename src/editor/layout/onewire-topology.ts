import type { OneWireTopologyPlan } from '../../types.js'
import type { LineShape, Shape, SymbolShape, TextShape } from '../model/types.js'
import {
  ONE_WIRE_BREAKER_SCALE,
  ONE_WIRE_RCD_SCALE,
  oneWireSymbolTerminalInfo
} from './onewire-symbol-nodes.js'
import { assessOneWireCapacity } from '../onewire-capacity.js'
import {
  neutralPositionForManufacturer,
  phaseConfigurationLabel,
  shouldShowPhaseLabel
} from '../model/electrical.js'

const KWH_PATH = 'symbols/Consumption appliances/kWh meter.svg'
const RCD_PATH = 'symbols/Protection devices/Residual-current circuit breaker.svg'
const INVERTER_PATH = 'symbols/Photovoltaic devices (≠AREI)/Inverter.svg'
const SOLAR_PANEL_PATH = 'symbols/Photovoltaic devices (≠AREI)/Solar panel.svg'
const EARTH_PATH = 'symbols/Protection devices/Earth electrode.svg'
const BREAKER_PATH = 'symbols/Protection devices/Automaat.svg'
const TOPOLOGY_GEOMETRY_VERSION = 10

type TopologyRail = Pick<LineShape, 'start' | 'end'>

export type OneWireTopologyOptions = {
  gridProtectionCurrentA?: number
  defaultPoles?: number
  phaseConfiguration?: 'single-phase' | 'three-phase' | 'L1+N' | 'L2+N' | 'L3+N' | 'L1+L2+L3+N'
  protectionManufacturer?: string
  ev?: {
    bindingId: string
    name: string
    path: string
    scale: number
  }
}

export const buildOneWireTopology = (
  plan: OneWireTopologyPlan,
  rail: TopologyRail,
  nextId: () => string,
  options: OneWireTopologyOptions = {}
): Shape[] => {
  const groupId = `onewire-topology-${nextId()}`
  const shapes: Shape[] = []

  // Every branch connects to an explicit tap on the busbar. Using a fraction
  // keeps the network connected when the busbar is moved or resized.
  const busTap = (fraction: number) => ({
    x: rail.start.x + (rail.end.x - rail.start.x) * fraction,
    y: rail.start.y + (rail.end.y - rail.start.y) * fraction
  })

  const link = <T extends Shape>(shape: T, role: string): T => {
    shape.groupId = groupId
    shape.sourceLink = { kind: 'board', id: 'main', role }
    // Versioned because regeneration intentionally preserves old geometry.
    // A node-layout migration must replace pre-node shapes once.
    shape.generationKey = `board:main:topology:v${TOPOLOGY_GEOMETRY_VERSION}:${role}`
    return shape
  }
  const line = (
    role: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    strokeWidth = 1.25,
    energyFlow?: LineShape['energyFlow'],
    energySource?: LineShape['energySource']
  ): LineShape =>
    link({
      id: nextId(),
      kind: 'line',
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      stroke: '#000000',
      strokeWidth,
      ...(energyFlow ? { energyFlow } : {}),
      ...(energySource ? { energySource } : {})
    }, role)
  const symbol = (role: string, name: string, path: string, sx: number, sy: number, scale: number): SymbolShape =>
    link({
      id: nextId(),
      kind: 'symbol',
      position: { x: sx, y: sy },
      name,
      path,
      scale,
      strokeWidth: 0.65,
      ...(path === RCD_PATH || path === BREAKER_PATH
        ? {
            symbolTextOverrides: {
              poles: '',
              phase: '',
              'rated-current': '',
              'residual-current': ''
            }
          }
        : {})
    }, role)
  const protectionValues = (
    shape: SymbolShape,
    ratedCurrentA?: number,
    sensitivityMa?: number,
    device?: { manufacturer?: string; neutralPosition?: 'left' | 'right' }
  ): SymbolShape => {
    const breakerCurve = shape.path === BREAKER_PATH && ratedCurrentA ? 'C' as const : undefined
    const manufacturer = device?.manufacturer?.trim()
      || options.protectionManufacturer?.trim()
      || 'Schneider Electric'
    const neutralPosition =
      device?.neutralPosition
      ?? neutralPositionForManufacturer(manufacturer)
      ?? 'right'
    const poles = options.defaultPoles ?? 2
    const phaseConfiguration = options.phaseConfiguration ?? 'single-phase'
    shape.electrical = {
      role: 'protection',
      oneWireEligible: true,
      ...(ratedCurrentA ? { breakerCurrentA: ratedCurrentA } : {}),
      ...(breakerCurve ? { breakerCurve } : {}),
      ...(sensitivityMa ? { rcdSensitivityMa: sensitivityMa } : {}),
      poles,
      phaseConfiguration,
      manufacturer,
      neutralPosition,
      boardId: 'main'
    }
    shape.symbolTextOverrides = {
      ...(shape.symbolTextOverrides ?? {}),
      poles: `${poles}P`,
      phase: shouldShowPhaseLabel(poles, true)
        ? phaseConfigurationLabel(phaseConfiguration, neutralPosition)
        : '',
      'rated-current': ratedCurrentA ? `${breakerCurve ?? ''}${ratedCurrentA}A` : '',
      ...(shape.path === RCD_PATH
        ? { 'residual-current': sensitivityMa ? `${sensitivityMa}mA` : '' }
        : {})
    }
    return shape
  }
  const terminalOffset = (path: string, scale: number, terminal: 'top' | 'bottom') => {
    const offset = oneWireSymbolTerminalInfo(path, scale)?.[terminal]
    if (!offset) throw new Error(`Missing ${terminal} terminal metadata for ${path}.`)
    return offset
  }
  const symbolAtTerminal = (
    role: string,
    name: string,
    path: string,
    scale: number,
    terminal: 'top' | 'bottom',
    anchor: { x: number; y: number }
  ): SymbolShape => {
    const offset = terminalOffset(path, scale, terminal)
    return symbol(role, name, path, anchor.x - offset.x, anchor.y - offset.y, scale)
  }
  const terminalPoint = (shape: SymbolShape, terminal: 'top' | 'bottom') => {
    const offset = terminalOffset(shape.path, shape.scale, terminal)
    return { x: shape.position.x + offset.x, y: shape.position.y + offset.y }
  }
  const text = (
    role: string,
    value: string,
    tx: number,
    ty: number,
    scale = 0.58,
    rotation?: number
  ): TextShape =>
    link({
      id: nextId(),
      kind: 'text',
      position: { x: tx, y: ty },
      text: value,
      scale,
      fill: '#000000',
      stroke: 'none',
      ...(typeof rotation === 'number' ? { rotation } : {})
    }, role)

  const mainTap = busTap(0.5)
  const mainTop = { x: mainTap.x, y: mainTap.y + 40 }
  const mainDifferential = symbolAtTerminal(
    'main-differential', 'Main differential', RCD_PATH, ONE_WIRE_RCD_SCALE, 'top', mainTop
  )
  protectionValues(
    mainDifferential,
    plan.mainDifferential?.ratedCurrentA,
    plan.mainDifferential?.sensitivityMa,
    plan.mainDifferential
  )
  const mainBottom = terminalPoint(mainDifferential, 'bottom')
  const meterTop = { x: mainTap.x, y: mainBottom.y + 40 }
  const meter = symbolAtTerminal('meter', 'kWh meter', KWH_PATH, 2.5, 'top', meterTop)
  const meterBottom = terminalPoint(meter, 'bottom')
  const mainSwitchTop = { x: meterBottom.x, y: meterBottom.y + 34 }
  const mainSwitch = symbolAtTerminal(
    'main-switch', 'Hoofdschakelaar', BREAKER_PATH, ONE_WIRE_BREAKER_SCALE, 'top', mainSwitchTop
  )
  const mainSwitchBottom = terminalPoint(mainSwitch, 'bottom')
  const mainSwitchManufacturer =
    plan.mainSwitch?.manufacturer?.trim()
    || options.protectionManufacturer?.trim()
    || 'Schneider Electric'
  const mainSwitchNeutralPosition =
    plan.mainSwitch?.neutralPosition
    ?? neutralPositionForManufacturer(mainSwitchManufacturer)
    ?? 'right'
  const mainSwitchPoles = options.defaultPoles ?? 2
  const mainSwitchPhaseConfiguration = options.phaseConfiguration ?? 'single-phase'
  mainSwitch.electrical = {
    role: 'protection',
    oneWireEligible: true,
    ...(plan.mainSwitch?.ratedCurrentA
      ? { breakerCurrentA: plan.mainSwitch.ratedCurrentA }
      : {}),
    poles: mainSwitchPoles,
    phaseConfiguration: mainSwitchPhaseConfiguration,
    manufacturer: mainSwitchManufacturer,
    neutralPosition: mainSwitchNeutralPosition,
    boardId: 'main'
  }
  mainSwitch.symbolTextOverrides = {
    ...(mainSwitch.symbolTextOverrides ?? {}),
    poles: `${mainSwitchPoles}P`,
    phase: shouldShowPhaseLabel(mainSwitchPoles, true)
      ? phaseConfigurationLabel(mainSwitchPhaseConfiguration, mainSwitchNeutralPosition)
      : '',
    'rated-current': plan.mainSwitch?.ratedCurrentA ? `${plan.mainSwitch.ratedCurrentA}A` : ''
  }
  shapes.push(meter, mainDifferential, mainSwitch)
  shapes.push(line(
    'grid-incoming',
    mainSwitchBottom.x,
    mainSwitchBottom.y,
    mainSwitchBottom.x,
    mainSwitchBottom.y + 36,
    1.25,
    plan.solar ? 'bidirectional' : 'reverse'
  ))
  shapes.push(line(
    'main-switch-to-meter',
    meterBottom.x,
    meterBottom.y,
    mainSwitchTop.x,
    mainSwitchTop.y,
    1.25,
    plan.solar ? 'bidirectional' : 'reverse'
  ))
  shapes.push(line(
    'incoming', meterTop.x, meterTop.y, mainBottom.x, mainBottom.y, 1.25,
    plan.solar ? 'bidirectional' : 'forward'
  ))
  shapes.push(line(
    'main-to-rail', mainTop.x, mainTop.y, mainTap.x, mainTap.y, 1.25,
    plan.solar ? 'bidirectional' : 'forward'
  ))

  if (plan.incomingCable) {
    shapes.push(text(
      'incoming-cable-label',
      `${plan.incomingCable.conductors}x${plan.incomingCable.sectionMm2} mm² ${plan.incomingCable.cableType}`,
      meter.position.x + 30,
      meter.position.y - 34,
      0.62
    ))
  }
  if (plan.mainDifferential) {
    shapes.push(text('main-differential-title', 'Diff', mainDifferential.position.x - 43, mainDifferential.position.y + 5, 0.7))
  }
  shapes.push(text(
    'main-switch-title',
    'hoofdschakelaar',
    mainSwitch.position.x + 38,
    mainSwitch.position.y + 12,
    0.62
  ))

  const earthTap = busTap(0.06)
  const earthTop = { x: earthTap.x, y: earthTap.y + 40 }
  const earth = symbolAtTerminal('earth', 'Earth electrode', EARTH_PATH, 1.6, 'top', earthTop)
  shapes.push(line('earth-drop', earthTap.x, earthTap.y, earthTop.x, earthTop.y))
  shapes.push(earth)

  const additional = (plan.additionalDifferentials ?? []).flatMap((item) =>
    Array.from({ length: item.count }, () => item)
  )
  const capacity = assessOneWireCapacity(plan, {
    gridProtectionCurrentA: options.gridProtectionCurrentA
  })

  // Reference layout: the main busbar feeds a shifted upper distribution
  // busbar. Differential branches leave from the upper level; PV stays on the
  // right side of the main busbar.
  const railWidth = Math.abs(rail.end.x - rail.start.x)
  const upperGap = Math.min(280, Math.max(220, mainTap.y - 120))
  const upperShift = Math.min(railWidth * 0.36, Math.max(0, Math.min(rail.start.x, rail.end.x) - 40))
  const upperRail: TopologyRail = {
    start: { x: rail.start.x - upperShift, y: rail.start.y - upperGap },
    end: { x: rail.end.x - upperShift, y: rail.end.y - upperGap }
  }
  shapes.push(line(
    'secondary-busbar',
    upperRail.start.x,
    upperRail.start.y,
    upperRail.end.x,
    upperRail.end.y,
    10
  ))
  const upperTap = (fraction: number) => ({
    x: upperRail.start.x + (upperRail.end.x - upperRail.start.x) * fraction,
    y: upperRail.start.y + (upperRail.end.y - upperRail.start.y) * fraction
  })
  const upperTapAtX = (x: number) => {
    const dx = upperRail.end.x - upperRail.start.x
    const fraction = dx === 0 ? 0.5 : Math.max(0, Math.min(1, (x - upperRail.start.x) / dx))
    return upperTap(fraction)
  }

  if (plan.residualBreaker) {
    const status = text(
      'secondary-busbar-protection-label',
      capacity.message,
      upperRail.start.x + 8,
      upperRail.start.y + 28,
      0.5
    )
    if (capacity.status === 'overload') status.fill = '#b3261e'
    shapes.push(status)
    shapes.push(text(
      'secondary-busbar-capacity-detail',
      capacity.detail,
      upperRail.start.x + 8,
      upperRail.start.y + 42,
      0.43
    ))
  } else if (plan.solar && (plan.consumers || additional.length)) {
    const directTap = busTap(0.16)
    const directUpperTap = upperTapAtX(directTap.x)
    shapes.push(line(
      'unprotected-feeder',
      directTap.x,
      directTap.y,
      directUpperTap.x,
      directUpperTap.y,
      1.25,
      'forward',
      'mixed'
    ))
    const warning = text(
      'secondary-busbar-protection-warning',
      capacity.message,
      upperRail.start.x + 8,
      upperRail.start.y + 28,
      0.5
    )
    warning.fill = capacity.status === 'ok' ? '#8a5200' : '#b3261e'
    shapes.push(warning)
    const detail = text(
      'secondary-busbar-capacity-detail',
      capacity.detail,
      upperRail.start.x + 8,
      upperRail.start.y + 42,
      0.43
    )
    detail.fill = warning.fill
    shapes.push(detail)
  }

  if (plan.residualBreaker) {
    const feederTap = busTap(0.16)
    const breakerBottom = { x: feederTap.x, y: feederTap.y - 40 }
    const breaker = symbolAtTerminal(
      'residual-breaker', 'Distribution breaker', BREAKER_PATH, ONE_WIRE_BREAKER_SCALE, 'bottom', breakerBottom
    )
    protectionValues(
      breaker,
      plan.residualBreakerRatedCurrentA ?? 40,
      undefined,
      {
        manufacturer: plan.residualBreakerManufacturer,
        neutralPosition: plan.residualBreakerNeutralPosition
      }
    )
    const breakerTop = terminalPoint(breaker, 'top')
    const feederUpperTap = upperTapAtX(feederTap.x)
    shapes.push(breaker)
    const downstreamSource: LineShape['energySource'] = plan.solar ? 'mixed' : 'default'
    shapes.push(line('residual-to-rail', feederTap.x, feederTap.y, breakerBottom.x, breakerBottom.y, 1.25, undefined, downstreamSource))
    shapes.push(line('residual-outgoing', breakerTop.x, breakerTop.y, feederUpperTap.x, feederUpperTap.y, 1.25, undefined, downstreamSource))
    shapes.push(text(
      'residual-breaker-label',
      'remautomaat',
      breaker.position.x + 34,
      breaker.position.y + 18,
      0.58
    ))
  }

  const evDifferentials = additional.filter((item) => item.purpose === 'ev')
  const otherDifferentials = additional.filter((item) => item.purpose !== 'ev')
  const middle = Math.ceil(otherDifferentials.length / 2)
  const orderedDifferentials = [
    ...otherDifferentials.slice(0, middle),
    ...evDifferentials,
    ...otherDifferentials.slice(middle)
  ]
  for (const [additionalIndex, item] of orderedDifferentials.entries()) {
    const fraction = orderedDifferentials.length === 1
      ? 0.5
      : 0.14 + (0.72 * additionalIndex) / (orderedDifferentials.length - 1)
    const branchTap = upperTap(fraction)
    const role = `additional-differential-${item.purpose}-${additionalIndex + 1}`
    const purpose = item.purpose === 'ev' ? 'EV' : item.purpose === 'consumers' ? 'verbruikers' : 'overig'
    const ratedCurrentA = item.ratedCurrentA ?? plan.mainDifferential?.ratedCurrentA
    const branchBottom = { x: branchTap.x, y: branchTap.y - 40 }
    const differential = symbolAtTerminal(
      role,
      'Additional differential',
      RCD_PATH,
      ONE_WIRE_RCD_SCALE,
      'bottom',
      branchBottom
    )
    protectionValues(differential, ratedCurrentA, item.sensitivityMa, item)
    const branchTop = terminalPoint(differential, 'top')
    shapes.push(differential)
    const downstreamSource: LineShape['energySource'] = plan.solar ? 'mixed' : 'default'
    shapes.push(line(`${role}-to-rail`, branchTap.x, branchTap.y, branchBottom.x, branchBottom.y, 1.25, undefined, downstreamSource))
    const evLoad = item.purpose === 'ev' ? options.ev : undefined
    const outgoingEnd = evLoad ? { x: branchTop.x, y: branchTop.y - 72 } : { x: branchTop.x, y: branchTop.y - 54 }
    shapes.push(line(`${role}-outgoing`, branchTop.x, branchTop.y, outgoingEnd.x, outgoingEnd.y, 1.25, undefined, downstreamSource))
    if (evLoad) {
      const evSymbol = symbolAtTerminal(
        `${role}-load`, evLoad.name, evLoad.path, evLoad.scale, 'bottom', outgoingEnd
      )
      evSymbol.sourceLink = { kind: 'circuit', id: evLoad.bindingId, role: 'ev-load' }
      shapes.push(evSymbol)
      shapes.push(text(
        `${role}-load-label`,
        `EV · ${evLoad.bindingId}`,
        evSymbol.position.x + 34,
        evSymbol.position.y + 4,
        0.56
      ))
    } else {
      shapes.push(text(`${role}-destination`, `NAAR ${purpose.toUpperCase()}`, branchTop.x - 38, branchTop.y - 62, 0.52))
    }
  }

  if (plan.solar) {
    const solarTap = busTap(0.84)
    const breakerBottom = { x: solarTap.x, y: solarTap.y - 40 }
    const solarBreaker = symbolAtTerminal(
      'solar-breaker', 'PV breaker', BREAKER_PATH, ONE_WIRE_BREAKER_SCALE, 'bottom', breakerBottom
    )
    protectionValues(
      solarBreaker,
      plan.solarBreakerRatedCurrentA ?? 20,
      undefined,
      {
        manufacturer: plan.solarBreakerManufacturer,
        neutralPosition: plan.solarBreakerNeutralPosition
      }
    )
    const breakerTop = terminalPoint(solarBreaker, 'top')
    const solarMeterBottom = { x: solarTap.x, y: breakerTop.y - 34 }
    const solarMeter = symbolAtTerminal('solar-meter', 'PV kWh meter', KWH_PATH, 2, 'bottom', solarMeterBottom)
    const solarMeterTop = terminalPoint(solarMeter, 'top')
    const inverterBottom = { x: solarTap.x, y: solarMeterTop.y - 34 }
    const inverter = symbolAtTerminal('solar-inverter', 'PV inverter', INVERTER_PATH, 2.3, 'bottom', inverterBottom)
    const inverterTop = terminalPoint(inverter, 'top')
    const panelBottom = { x: solarTap.x, y: inverterTop.y - 34 }
    const panels = symbolAtTerminal('solar-panels', 'Solar panels', SOLAR_PANEL_PATH, 1.8, 'bottom', panelBottom)
    shapes.push(line('solar-branch', solarTap.x, solarTap.y, breakerBottom.x, breakerBottom.y))
    shapes.push(solarBreaker)
    shapes.push(line('solar-breaker-to-meter', breakerTop.x, breakerTop.y, solarMeterBottom.x, solarMeterBottom.y))
    shapes.push(solarMeter)
    shapes.push(line('solar-meter-to-inverter', solarMeterTop.x, solarMeterTop.y, inverterBottom.x, inverterBottom.y))
    shapes.push(inverter)
    shapes.push(line('solar-inverter-to-panels', inverterTop.x, inverterTop.y, panelBottom.x, panelBottom.y))
    shapes.push(panels)
    shapes.push(text('solar-label', 'zonnepanelen / omvormer', inverter.position.x + 38, inverter.position.y + 18, 0.58))
  }

  return shapes
}
