import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { buildOneWireTopology } from '../src/editor/layout/onewire-topology.ts'
import { oneWireSymbolTerminalInfo } from '../src/editor/layout/onewire-symbol-nodes.ts'
import {
  energyScenarioOpacityValues,
  oneWireEnergyFlowSegment,
  oneWireEnergyFlowSegments
} from '../src/editor/onewire-energy-flow.ts'

const ids = () => {
  let id = 0
  return () => `topology-${++id}`
}

test('keeps grid import and PV generation in exclusive animation phases', () => {
  const grid = energyScenarioOpacityValues('default').split(';').map(Number)
  const generator = energyScenarioOpacityValues('generator').split(';').map(Number)
  assert.equal(grid.length, generator.length)
  assert.ok(grid.some((value) => value > 0))
  assert.ok(generator.some((value) => value > 0))
  assert.ok(grid.every((value, index) => value === 0 || generator[index] === 0))
})

test('draws the solar branch beside the residual-breaker path after the main differential', () => {
  const shapes = buildOneWireTopology(
    {
      version: 1,
      incomingCable: { conductors: 4, sectionMm2: 10, cableType: 'EXVB' },
      mainSwitch: { ratedCurrentA: 25 },
      mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 },
      residualBreaker: true,
      solar: true,
      consumers: true,
      solarPlacement: 'parallel-after-main-differential',
      additionalDifferentials: [
        { count: 2, sensitivityMa: 30, purpose: 'consumers' },
        { count: 1, sensitivityMa: 30, purpose: 'ev' }
      ]
    },
    {
      start: { x: 80, y: 700 },
      end: { x: 920, y: 700 }
    },
    ids(),
    {
      ev: {
        bindingId: 'U',
        name: 'Elektrische wagen EV',
        path: 'symbols/Consumption appliances/Elektrische wagen EV.svg',
        scale: 2
      }
    }
  )

  const roles = new Set(shapes.map((shape) => shape.sourceLink?.role))
  assert.ok(roles.has('meter'))
  assert.ok(roles.has('main-switch'))
  assert.ok(roles.has('main-switch-to-meter'))
  assert.ok(roles.has('main-switch-title'))
  assert.ok(roles.has('main-differential'))
  assert.ok(roles.has('grid-incoming'))
  assert.ok(roles.has('earth'))
  assert.ok(roles.has('earth-rail'))
  assert.ok(roles.has('earth-drop'))
  assert.ok(roles.has('secondary-busbar'))
  assert.ok(roles.has('residual-breaker'))
  assert.ok(roles.has('solar-branch'))
  assert.ok(roles.has('solar-inverter'))
  assert.ok(roles.has('solar-breaker'))
  assert.ok(roles.has('solar-meter'))
  assert.ok(roles.has('solar-panels'))
  assert.ok(roles.has('residual-to-rail'))
  assert.ok(roles.has('residual-outgoing'))
  assert.ok(roles.has('additional-differential-consumers-1'))
  assert.ok(roles.has('additional-differential-ev-2'))
  assert.ok(roles.has('additional-differential-consumers-3'))
  assert.ok(roles.has('ev-load'))
  assert.ok(shapes.every((shape) => shape.groupId?.startsWith('onewire-topology-')))
  assert.ok(shapes.every((shape) => shape.generationKey?.startsWith('board:main:topology:v20:')))
  for (const shape of shapes) {
    if (shape.kind === 'line') {
      assert.equal(shape.strokeWidth, shape.sourceLink?.role === 'secondary-busbar' ? 10 : 2)
    } else if (shape.kind === 'symbol') {
      const source = readFileSync(new URL(`../www/${shape.path}`, import.meta.url), 'utf8')
      const viewBox = source.match(/viewBox="([^"]+)"/)![1].split(/\s+/).map(Number)
      const physicalPen = shape.strokeWidth! * 24 * shape.scale / Math.max(viewBox[2], viewBox[3])
      assert.ok(Math.abs(physicalPen - 2) < 1e-8, `${shape.name}: ${physicalPen}`)
    }
  }
  assert.ok(shapes.some((shape) => shape.kind === 'text' && shape.text === '4x10 mm² EXVB'))
  assert.ok(shapes.some((shape) => shape.kind === 'text' && shape.text === 'remautomaat'))
  assert.ok(shapes.some((shape) => shape.kind === 'text' && shape.text === 'Hoofdautomaat'))
  assert.ok(shapes.some((shape) => shape.kind === 'text' && shape.text === 'BEGRENZDE RAIL · REMAUTOMAAT C40A'))
  assert.ok(shapes.some((shape) => shape.kind === 'text' && shape.text === 'EV · U'))

  const busY = 700
  const meter = shapes.find((shape) => shape.sourceLink?.role === 'meter')
  const solar = shapes.find((shape) => shape.sourceLink?.role === 'solar-inverter')
  const additional = shapes.find((shape) => shape.sourceLink?.role === 'additional-differential-consumers-1')
  assert.ok(meter?.kind === 'symbol' && meter.position.y > busY)
  assert.ok(solar?.kind === 'symbol' && solar.position.y < busY)
  assert.ok(additional?.kind === 'symbol' && additional.position.y < busY)

  const terminal = (role: string, end: 'top' | 'bottom') => {
    const shape = shapes.find((item) => item.sourceLink?.role === role)
    assert.ok(shape?.kind === 'symbol')
    const offset = oneWireSymbolTerminalInfo(shape.path, shape.scale)?.[end]
    assert.ok(offset)
    return { x: shape.position.x + offset.x, y: shape.position.y + offset.y }
  }
  const topologyLine = (role: string) => {
    const shape = shapes.find((item) => item.sourceLink?.role === role)
    assert.ok(shape?.kind === 'line')
    return shape
  }

  const connections: Array<[string, 'start' | 'end', string, 'top' | 'bottom']> = [
    ['main-to-rail', 'start', 'main-differential', 'top'],
    ['incoming', 'start', 'meter', 'top'],
    ['incoming', 'end', 'main-differential', 'bottom'],
    ['main-switch-to-meter', 'start', 'meter', 'bottom'],
    ['main-switch-to-meter', 'end', 'main-switch', 'top'],
    ['grid-incoming', 'start', 'main-switch', 'bottom'],
    ['residual-to-rail', 'end', 'residual-breaker', 'bottom'],
    ['residual-outgoing', 'start', 'residual-breaker', 'top'],
    ['earth-drop', 'end', 'earth', 'top'],
    ['solar-branch', 'end', 'solar-breaker', 'bottom'],
    ['solar-breaker-to-meter', 'start', 'solar-breaker', 'top'],
    ['solar-breaker-to-meter', 'end', 'solar-meter', 'bottom'],
    ['solar-meter-to-inverter', 'start', 'solar-meter', 'top'],
    ['solar-meter-to-inverter', 'end', 'solar-inverter', 'bottom'],
    ['solar-inverter-to-panels', 'start', 'solar-inverter', 'top'],
    ['solar-inverter-to-panels', 'end', 'solar-panels', 'bottom'],
    ['additional-differential-ev-2-outgoing', 'end', 'ev-load', 'bottom']
  ]
  for (const [lineRole, endpoint, symbolRole, terminalName] of connections) {
    const actual = topologyLine(lineRole)[endpoint]
    const expected = terminal(symbolRole, terminalName)
    assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-9, lineRole)
  }

  const earth = shapes.find((shape) => shape.sourceLink?.role === 'earth')
  const main = shapes.find((shape) => shape.sourceLink?.role === 'main-differential')
  const mainSwitch = shapes.find((shape) => shape.sourceLink?.role === 'main-switch')
  const mainLabel = shapes.find((shape) => shape.sourceLink?.role === 'main-differential-label')
  assert.ok(earth?.kind === 'symbol' && main?.kind === 'symbol' && earth.position.x < main.position.x)
  assert.ok(mainSwitch?.kind === 'symbol')
  assert.ok(Math.abs(mainSwitch.scale * 24 / 8 - 8.4) < 1e-6)
  assert.equal(mainSwitch.electrical?.breakerCurrentA, 25)
  assert.equal(mainSwitch.symbolTextOverrides?.['rated-current'], '25A')
  assert.equal(mainLabel, undefined)
  assert.ok(main?.kind === 'symbol')
  assert.ok(Math.abs(main.scale * 24 * 29.8893 / 38.5625 / 8 - 8.4) < 1e-6)
  assert.equal(main.electrical?.breakerCurrentA, 40)
  assert.equal(main.electrical?.rcdSensitivityMa, 300)
  assert.equal(main.electrical?.manufacturer, 'Schneider Electric')
  assert.equal(main.electrical?.neutralPosition, 'left')
  assert.equal(main.symbolTextOverrides?.phase, 'N-L1')
  assert.equal(main.symbolTextOverrides?.['rated-current'], '40A')
  assert.equal(main.symbolTextOverrides?.['residual-current'], '300mA')

  const residualBreaker = shapes.find((shape) => shape.sourceLink?.role === 'residual-breaker')
  const additionalDifferential = shapes.find(
    (shape) => shape.sourceLink?.role === 'additional-differential-consumers-1'
  )
  assert.ok(residualBreaker?.kind === 'symbol' && additionalDifferential?.kind === 'symbol')
  assert.ok(Math.abs(additionalDifferential.scale * 24 * 29.8893 / 38.5625 / 8 - 8.4) < 1e-6)
  assert.equal(residualBreaker.electrical?.breakerCurrentA, 40)
  assert.ok(Math.abs(residualBreaker.scale * 24 / 8 - 8.4) < 1e-6)
  assert.equal(residualBreaker.electrical?.breakerCurve, 'C')
  assert.equal(residualBreaker.symbolTextOverrides?.['rated-current'], 'C40A')
  assert.equal(additionalDifferential.electrical?.breakerCurrentA, 40)
  assert.equal(additionalDifferential.electrical?.rcdSensitivityMa, 30)
  assert.equal(additionalDifferential.symbolTextOverrides?.['rated-current'], '40A')
  assert.equal(additionalDifferential.symbolTextOverrides?.['residual-current'], '30mA')

  const solarBreaker = shapes.find((shape) => shape.sourceLink?.role === 'solar-breaker')
  assert.ok(solarBreaker?.kind === 'symbol')
  assert.ok(Math.abs(solarBreaker.scale * 24 / 8 - 8.4) < 1e-6)
  assert.equal(solarBreaker.electrical?.breakerCurrentA, 20)
  assert.equal(solarBreaker.electrical?.breakerCurve, 'C')
  assert.equal(solarBreaker.symbolTextOverrides?.['rated-current'], 'C20A')

  const gridFlows = oneWireEnergyFlowSegments(topologyLine('grid-incoming'))
  const consumerFlows = oneWireEnergyFlowSegments(topologyLine('additional-differential-consumers-1-outgoing'))
  const consumerFlow = consumerFlows[0] ?? null
  const solarFlow = oneWireEnergyFlowSegment(topologyLine('solar-branch'))
  assert.ok(gridFlows.some((flow) => flow.to.y < flow.from.y))
  assert.ok(gridFlows.some((flow) => flow.to.y > flow.from.y))
  assert.ok(consumerFlow && consumerFlow.to.y < consumerFlow.from.y)
  assert.ok(solarFlow && solarFlow.to.y > solarFlow.from.y)
  assert.equal(consumerFlow?.source, 'default')
  assert.deepEqual(
    consumerFlows.map((flow) => flow.source),
    ['default', 'generator']
  )
  assert.ok(consumerFlows.every((flow) => flow.to.y < flow.from.y))
  assert.equal(solarFlow?.source, 'generator')
  for (const role of ['main-to-rail', 'incoming', 'main-switch-to-meter', 'grid-incoming']) {
    const flows = oneWireEnergyFlowSegments(topologyLine(role))
    assert.equal(flows.length, 2)
    assert.equal(flows.filter((flow) => flow.source === 'generator').length, 1)
    assert.equal(flows.filter((flow) => flow.source === 'default').length, 1)
    assert.deepEqual(flows[0].from, flows[1].to)
    assert.deepEqual(flows[0].to, flows[1].from)
  }
})

test('places one consumer differential as an outgoing branch on the distribution rail', () => {
  const shapes = buildOneWireTopology(
    {
      version: 1,
      incomingCable: { conductors: 4, sectionMm2: 10, cableType: 'EXVB' },
      mainSwitch: { ratedCurrentA: 40 },
      mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 },
      residualBreaker: false,
      solar: false,
      consumers: true,
      additionalDifferentials: [
        { count: 1, railId: 'rail-1', ratedCurrentA: 40, sensitivityMa: 30, purpose: 'consumers' }
      ]
    },
    {
      start: { x: 80, y: 700 },
      end: { x: 920, y: 700 }
    },
    ids()
  )

  const roles = new Set(shapes.map((shape) => shape.sourceLink?.role))
  assert.ok(roles.has('main-differential'))
  assert.ok(roles.has('main-to-rail'))
  assert.ok(roles.has('additional-differential-consumers-1'))
  assert.ok(roles.has('additional-differential-consumers-1-to-rail'))
  assert.ok(!roles.has('secondary-busbar'))

  const consumerDifferential = shapes.find((shape) => shape.sourceLink?.role === 'additional-differential-consumers-1')
  const branch = shapes.find((shape) => shape.sourceLink?.role === 'additional-differential-consumers-1-to-rail')
  assert.ok(consumerDifferential?.kind === 'symbol')
  assert.ok(branch?.kind === 'line')
  assert.equal(branch.start.y, 700)
  assert.equal(consumerDifferential.electrical?.rcdSensitivityMa, 30)
  assert.equal(consumerDifferential.symbolTextOverrides?.['residual-current'], '30mA')
  assert.ok(shapes.some((shape) => shape.kind === 'text' && shape.text === 'NAAR RIJ 1'))
})

test('balances two destination branches around the incoming supply', () => {
  const shapes = buildOneWireTopology(
    {
      version: 1,
      mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 },
      consumers: true,
      additionalDifferentials: [
        { count: 1, railId: 'rail-1', ratedCurrentA: 40, sensitivityMa: 30, purpose: 'consumers' },
        { count: 1, boardId: 'kitchen', ratedCurrentA: 40, sensitivityMa: 30, purpose: 'consumers' }
      ]
    },
    {
      start: { x: 80, y: 700 },
      end: { x: 920, y: 700 }
    },
    ids()
  )

  const feeders = shapes.filter(
    (shape) =>
      shape.kind === 'line' &&
      shape.sourceLink?.role?.startsWith('additional-differential-') &&
      shape.sourceLink.role.endsWith('-to-rail')
  )
  const destinations = shapes.filter(
    (shape) => shape.kind === 'text' && shape.sourceLink?.role?.endsWith('-destination')
  )

  assert.deepEqual(
    feeders.map((shape) => shape.start.x),
    [290, 710]
  )
  assert.ok(destinations.every((shape) => shape.textAnchor === 'middle'))
})

test('uses manufacturer metadata to render the physical neutral side', () => {
  const shapes = buildOneWireTopology(
    {
      version: 1,
      mainDifferential: {
        ratedCurrentA: 40,
        sensitivityMa: 300,
        manufacturer: 'TECO'
      },
      residualBreaker: true,
      residualBreakerManufacturer: 'Schneider Electric',
      solar: false,
      consumers: true,
      additionalDifferentials: [
        {
          count: 1,
          ratedCurrentA: 40,
          sensitivityMa: 30,
          purpose: 'consumers',
          manufacturer: 'TECO'
        }
      ]
    },
    {
      start: { x: 80, y: 700 },
      end: { x: 920, y: 700 }
    },
    ids()
  )

  const main = shapes.find((shape) => shape.sourceLink?.role === 'main-differential')
  const residual = shapes.find((shape) => shape.sourceLink?.role === 'residual-breaker')
  const downstream = shapes.find((shape) => shape.sourceLink?.role === 'additional-differential-consumers-1')
  assert.ok(main?.kind === 'symbol' && residual?.kind === 'symbol' && downstream?.kind === 'symbol')
  assert.equal(main.symbolTextOverrides?.phase, 'L1-N')
  assert.equal(residual.symbolTextOverrides?.phase, 'N-L1')
  assert.equal(downstream.symbolTextOverrides?.phase, 'L1-N')
})

test('hides phase-order text on every four-pole protection device', () => {
  const shapes = buildOneWireTopology(
    {
      version: 1,
      mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 },
      residualBreaker: true,
      solar: true,
      consumers: true,
      additionalDifferentials: [{ count: 1, sensitivityMa: 30, purpose: 'consumers' }]
    },
    {
      start: { x: 80, y: 700 },
      end: { x: 920, y: 700 }
    },
    ids(),
    {
      defaultPoles: 4,
      phaseConfiguration: 'L1+L2+L3+N'
    }
  )

  const main = shapes.find((shape) => shape.sourceLink?.role === 'main-differential')
  const downstream = shapes.find((shape) => shape.sourceLink?.role === 'additional-differential-consumers-1')
  const residualBreaker = shapes.find((shape) => shape.sourceLink?.role === 'residual-breaker')
  const solarBreaker = shapes.find((shape) => shape.sourceLink?.role === 'solar-breaker')
  assert.ok(
    main?.kind === 'symbol' &&
      downstream?.kind === 'symbol' &&
      residualBreaker?.kind === 'symbol' &&
      solarBreaker?.kind === 'symbol'
  )
  assert.equal(main.symbolTextOverrides?.phase, '')
  assert.equal(downstream.symbolTextOverrides?.phase, '')
  assert.equal(residualBreaker.symbolTextOverrides?.phase, '')
  assert.equal(solarBreaker.symbolTextOverrides?.phase, '')
})

test('marks a solar-fed downstream rail without a remautomaat as unprotected', () => {
  const shapes = buildOneWireTopology(
    {
      version: 1,
      mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 },
      residualBreaker: false,
      solar: true,
      consumers: true,
      additionalDifferentials: [{ count: 1, sensitivityMa: 30, purpose: 'consumers' }]
    },
    {
      start: { x: 80, y: 700 },
      end: { x: 920, y: 700 }
    },
    ids(),
    { gridProtectionCurrentA: 40 }
  )

  assert.ok(shapes.some((shape) => shape.sourceLink?.role === 'unprotected-feeder' && shape.kind === 'line'))
  assert.ok(
    shapes.some(
      (shape) =>
        shape.sourceLink?.role === 'secondary-busbar-protection-warning' &&
        shape.kind === 'text' &&
        shape.text.includes('MAX 60 A')
    )
  )
  assert.ok(
    shapes.some(
      (shape) =>
        shape.sourceLink?.role === 'secondary-busbar-capacity-detail' &&
        shape.kind === 'text' &&
        shape.text.includes('63 A')
    )
  )
  assert.equal(
    shapes.some((shape) => shape.sourceLink?.role === 'residual-breaker'),
    false
  )
})

test('connects every topology branch to a tap on a moved busbar', () => {
  const rail = {
    start: { x: 100, y: 680 },
    end: { x: 1100, y: 720 }
  }
  const shapes = buildOneWireTopology(
    {
      version: 1,
      residualBreaker: true,
      solar: true,
      consumers: true,
      additionalDifferentials: [{ count: 1, sensitivityMa: 30, purpose: 'ev' }]
    },
    rail,
    ids()
  )

  const onBusbar = (point: { x: number; y: number }, busbar: typeof rail) => {
    const dx = busbar.end.x - busbar.start.x
    const dy = busbar.end.y - busbar.start.y
    const crossProduct = (point.x - busbar.start.x) * dy - (point.y - busbar.start.y) * dx
    return Math.abs(crossProduct) < 1e-8
  }
  const primaryRoles = new Set(['main-to-rail', 'residual-to-rail', 'solar-branch'])
  const primaryLines = shapes.filter(
    (shape): shape is Extract<typeof shape, { kind: 'line' }> =>
      shape.kind === 'line' && primaryRoles.has(shape.sourceLink?.role ?? '')
  )
  const secondaryBusbar = shapes.find((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'secondary-busbar')
  const additionalLine = shapes.find(
    (shape) => shape.kind === 'line' && shape.sourceLink?.role === 'additional-differential-ev-1-to-rail'
  )
  const feederLine = shapes.find((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'residual-outgoing')

  assert.equal(primaryLines.length, primaryRoles.size)
  assert.ok(
    primaryLines.every((line) => onBusbar(line.sourceLink?.role === 'main-to-rail' ? line.end : line.start, rail))
  )
  assert.ok(secondaryBusbar?.kind === 'line')
  const earthDrop = shapes.find((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'earth-drop')
  assert.ok(earthDrop?.kind === 'line' && !onBusbar(earthDrop.start, rail))
  assert.ok(additionalLine?.kind === 'line' && onBusbar(additionalLine.start, secondaryBusbar))
  assert.ok(feederLine?.kind === 'line' && onBusbar(feederLine.end, secondaryBusbar))
})
