import type { LineShape, Point } from './model/types.js'

export type OneWireEnergyFlowSegment = {
  from: Point
  to: Point
  source: 'default' | 'generator'
}

export const ENERGY_SCENARIO_DURATION = '3.6s'
export const ENERGY_SCENARIO_KEY_TIMES = '0;0.04;0.42;0.5;0.54;0.96;1'

// The first half visualises grid import; the second half visualises PV
// self-consumption and possible surplus export. The windows never overlap.
export const energyScenarioOpacityValues = (source: OneWireEnergyFlowSegment['source']): string =>
  source === 'generator' ? '0;0;0;0;1;1;0' : '0;1;1;0;0;0;0'

const FORWARD_ROLES = new Set([
  'incoming',
  'main-to-rail',
  'residual-to-rail',
  'residual-outgoing'
])

const REVERSE_ROLES = new Set([
  'grid-incoming',
  'solar-branch',
  'solar-breaker-to-meter',
  'solar-meter-to-inverter',
  'solar-inverter-to-panels'
])

const GENERATOR_ROLES = new Set([
  'solar-branch',
  'solar-breaker-to-meter',
  'solar-meter-to-inverter',
  'solar-inverter-to-panels'
])

const BIDIRECTIONAL_GENERATOR_FORWARD_ROLES = new Set(['grid-incoming', 'main-switch-to-meter'])
const BIDIRECTIONAL_GENERATOR_REVERSE_ROLES = new Set(['incoming', 'main-to-rail'])

const sourceForRole = (role: string | undefined): OneWireEnergyFlowSegment['source'] =>
  role && (
    GENERATOR_ROLES.has(role) ||
    /(?:^|-)(?:generator|production|producer|wind|pv)(?:-|$)/.test(role)
  )
    ? 'generator'
    : 'default'

const flowSegments = (
  from: Point,
  to: Point,
  source: LineShape['energySource'] | OneWireEnergyFlowSegment['source']
): OneWireEnergyFlowSegment[] =>
  source === 'mixed'
    ? [
        { from, to, source: 'default' },
        { from, to, source: 'generator' }
      ]
    : [{ from, to, source: source === 'generator' ? 'generator' : 'default' }]

export const oneWireEnergyFlowSegments = (shape: LineShape): OneWireEnergyFlowSegment[] => {
  const role = shape.sourceLink?.role
  const roleSource = shape.energySource ?? sourceForRole(role)
  if (shape.energyFlow === 'forward') return flowSegments(shape.start, shape.end, roleSource)
  if (shape.energyFlow === 'reverse') return flowSegments(shape.end, shape.start, roleSource)
  if (shape.energyFlow === 'bidirectional') {
    return [
      {
        from: shape.start,
        to: shape.end,
        source: roleSource === 'generator' || (role ? BIDIRECTIONAL_GENERATOR_FORWARD_ROLES.has(role) : false)
          ? 'generator'
          : 'default'
      },
      {
        from: shape.end,
        to: shape.start,
        source: roleSource === 'generator' || (role ? BIDIRECTIONAL_GENERATOR_REVERSE_ROLES.has(role) : false)
          ? 'generator'
          : 'default'
      }
    ]
  }
  if (!role) return []
  if (FORWARD_ROLES.has(role) || /^additional-differential-.+-(?:to-rail|outgoing)$/.test(role)) {
    return flowSegments(shape.start, shape.end, roleSource)
  }
  if (REVERSE_ROLES.has(role)) return flowSegments(shape.end, shape.start, roleSource)
  return []
}

export const oneWireEnergyFlowSegment = (shape: LineShape): OneWireEnergyFlowSegment | null =>
  oneWireEnergyFlowSegments(shape)[0] ?? null
