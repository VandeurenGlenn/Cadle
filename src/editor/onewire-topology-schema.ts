import type { OneWireTopologyPlan } from '../types.js'

export const ONE_WIRE_TOPOLOGY_SCHEMA = {
  $id: 'https://cadle.be/schemas/onewire-topology.v1.json',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'residualBreaker', 'solar', 'consumers'],
  properties: {
    version: { const: 1 },
    incomingCable: {
      type: 'object',
      additionalProperties: false,
      required: ['conductors', 'sectionMm2', 'cableType'],
      properties: {
        conductors: { type: 'integer', minimum: 1, maximum: 12 },
        sectionMm2: { type: 'number', exclusiveMinimum: 0, maximum: 500 },
        cableType: { enum: ['VOB', 'XVB', 'XVB-Cca', 'XGB', 'XGB-Cca', 'EXVB', 'other'] }
      }
    },
    mainDifferential: {
      type: 'object',
      additionalProperties: false,
      required: ['ratedCurrentA', 'sensitivityMa'],
      properties: {
        ratedCurrentA: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
        sensitivityMa: { type: 'number', exclusiveMinimum: 0, maximum: 3000 }
      }
    },
    residualBreaker: { type: 'boolean' },
    solar: { type: 'boolean' },
    consumers: { type: 'boolean' },
    solarPlacement: { enum: ['parallel-after-main-differential'] }
  }
} as const

export type OneWireTopologyValidation = {
  valid: boolean
  value?: OneWireTopologyPlan
  errors: string[]
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

export const validateOneWireTopology = (input: unknown): OneWireTopologyValidation => {
  const value = record(input)
  const errors: string[] = []
  if (!value) return { valid: false, errors: ['Topologie moet een JSON-object zijn.'] }
  const allowedKeys = new Set([
    'version',
    'incomingCable',
    'mainDifferential',
    'residualBreaker',
    'solar',
    'consumers',
    'solarPlacement'
  ])
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push(`Onbekend topologieveld: ${key}.`)
  }
  if (value.version !== 1) errors.push('Topologieversie moet 1 zijn.')
  for (const key of ['residualBreaker', 'solar', 'consumers'] as const) {
    if (typeof value[key] !== 'boolean') errors.push(`${key} moet boolean zijn.`)
  }

  const cable = value.incomingCable === undefined ? null : record(value.incomingCable)
  if (value.incomingCable !== undefined && !cable) errors.push('incomingCable moet een object zijn.')
  if (cable) {
    for (const key of Object.keys(cable)) {
      if (!['conductors', 'sectionMm2', 'cableType'].includes(key)) {
        errors.push(`Onbekend incomingCable-veld: ${key}.`)
      }
    }
    if (!Number.isInteger(cable.conductors) || Number(cable.conductors) < 1) {
      errors.push('incomingCable.conductors moet een positief geheel getal zijn.')
    }
    if (typeof cable.sectionMm2 !== 'number' || !Number.isFinite(cable.sectionMm2) || cable.sectionMm2 <= 0) {
      errors.push('incomingCable.sectionMm2 moet een positief getal zijn.')
    }
    if (!['VOB', 'XVB', 'XVB-Cca', 'XGB', 'XGB-Cca', 'EXVB', 'other'].includes(String(cable.cableType))) {
      errors.push('incomingCable.cableType is ongeldig.')
    }
  }

  const differential = value.mainDifferential === undefined ? null : record(value.mainDifferential)
  if (value.mainDifferential !== undefined && !differential) errors.push('mainDifferential moet een object zijn.')
  if (differential) {
    for (const key of Object.keys(differential)) {
      if (!['ratedCurrentA', 'sensitivityMa'].includes(key)) {
        errors.push(`Onbekend mainDifferential-veld: ${key}.`)
      }
    }
    if (
      typeof differential.ratedCurrentA !== 'number'
      || !Number.isFinite(differential.ratedCurrentA)
      || differential.ratedCurrentA <= 0
    ) {
      errors.push('mainDifferential.ratedCurrentA moet positief zijn.')
    }
    if (
      typeof differential.sensitivityMa !== 'number'
      || !Number.isFinite(differential.sensitivityMa)
      || differential.sensitivityMa <= 0
    ) {
      errors.push('mainDifferential.sensitivityMa moet positief zijn.')
    }
  }

  if (
    value.solarPlacement !== undefined
    && value.solarPlacement !== 'parallel-after-main-differential'
  ) {
    errors.push('solarPlacement is ongeldig.')
  }
  return errors.length
    ? { valid: false, errors }
    : { valid: true, value: input as OneWireTopologyPlan, errors }
}
