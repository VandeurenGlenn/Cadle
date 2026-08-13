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
    mainSwitch: {
      type: 'object',
      additionalProperties: false,
      required: ['ratedCurrentA'],
      properties: {
        ratedCurrentA: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
        manufacturer: { type: 'string', minLength: 1, maxLength: 120 },
        neutralPosition: { enum: ['left', 'right'] }
      }
    },
    mainDifferential: {
      type: 'object',
      additionalProperties: false,
      required: ['ratedCurrentA', 'sensitivityMa'],
      properties: {
        ratedCurrentA: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
        sensitivityMa: { type: 'number', exclusiveMinimum: 0, maximum: 3000 },
        manufacturer: { type: 'string', minLength: 1, maxLength: 120 },
        neutralPosition: { enum: ['left', 'right'] }
      }
    },
    residualBreaker: { type: 'boolean' },
    residualBreakerRatedCurrentA: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
    residualBreakerManufacturer: { type: 'string', minLength: 1, maxLength: 120 },
    residualBreakerNeutralPosition: { enum: ['left', 'right'] },
    gridProtectionCurrentA: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
    solar: { type: 'boolean' },
    solarBreakerRatedCurrentA: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
    solarBreakerManufacturer: { type: 'string', minLength: 1, maxLength: 120 },
    solarBreakerNeutralPosition: { enum: ['left', 'right'] },
    consumers: { type: 'boolean' },
    solarPlacement: { enum: ['parallel-after-main-differential'] },
    additionalDifferentials: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['count', 'sensitivityMa', 'purpose'],
        properties: {
          count: { type: 'integer', minimum: 1, maximum: 12 },
          sensitivityMa: { type: 'number', exclusiveMinimum: 0, maximum: 3000 },
          ratedCurrentA: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
          manufacturer: { type: 'string', minLength: 1, maxLength: 120 },
          neutralPosition: { enum: ['left', 'right'] },
          purpose: { enum: ['consumers', 'ev', 'other'] }
        }
      }
    }
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
    'mainSwitch',
    'mainDifferential',
    'residualBreaker',
    'residualBreakerRatedCurrentA',
    'residualBreakerManufacturer',
    'residualBreakerNeutralPosition',
    'gridProtectionCurrentA',
    'solar',
    'solarBreakerRatedCurrentA',
    'solarBreakerManufacturer',
    'solarBreakerNeutralPosition',
    'consumers',
    'solarPlacement',
    'additionalDifferentials'
  ])
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push(`Onbekend topologieveld: ${key}.`)
  }
  if (value.version !== 1) errors.push('Topologieversie moet 1 zijn.')
  for (const key of ['residualBreaker', 'solar', 'consumers'] as const) {
    if (typeof value[key] !== 'boolean') errors.push(`${key} moet boolean zijn.`)
  }
  if (value.residualBreakerRatedCurrentA !== undefined && (
    typeof value.residualBreakerRatedCurrentA !== 'number'
    || !Number.isFinite(value.residualBreakerRatedCurrentA)
    || value.residualBreakerRatedCurrentA <= 0
  )) {
    errors.push('residualBreakerRatedCurrentA moet positief zijn.')
  }
  for (const key of ['gridProtectionCurrentA', 'solarBreakerRatedCurrentA'] as const) {
    if (value[key] !== undefined && (
      typeof value[key] !== 'number'
      || !Number.isFinite(value[key])
      || value[key] <= 0
    )) {
      errors.push(`${key} moet positief zijn.`)
    }
  }
  for (const key of ['residualBreakerManufacturer', 'solarBreakerManufacturer'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || !value[key].trim())) {
      errors.push(`${key} moet tekst zijn.`)
    }
  }
  for (const key of ['residualBreakerNeutralPosition', 'solarBreakerNeutralPosition'] as const) {
    if (value[key] !== undefined && value[key] !== 'left' && value[key] !== 'right') {
      errors.push(`${key} is ongeldig.`)
    }
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

  const mainSwitch = value.mainSwitch === undefined ? null : record(value.mainSwitch)
  if (value.mainSwitch !== undefined && !mainSwitch) errors.push('mainSwitch moet een object zijn.')
  if (mainSwitch) {
    for (const key of Object.keys(mainSwitch)) {
      if (!['ratedCurrentA', 'manufacturer', 'neutralPosition'].includes(key)) {
        errors.push(`Onbekend mainSwitch-veld: ${key}.`)
      }
    }
    if (
      typeof mainSwitch.ratedCurrentA !== 'number'
      || !Number.isFinite(mainSwitch.ratedCurrentA)
      || mainSwitch.ratedCurrentA <= 0
    ) {
      errors.push('mainSwitch.ratedCurrentA moet positief zijn.')
    }
    if (mainSwitch.manufacturer !== undefined && (
      typeof mainSwitch.manufacturer !== 'string' || !mainSwitch.manufacturer.trim()
    )) errors.push('mainSwitch.manufacturer moet tekst zijn.')
    if (
      mainSwitch.neutralPosition !== undefined
      && mainSwitch.neutralPosition !== 'left'
      && mainSwitch.neutralPosition !== 'right'
    ) {
      errors.push('mainSwitch.neutralPosition is ongeldig.')
    }
  }

  const differential = value.mainDifferential === undefined ? null : record(value.mainDifferential)
  if (value.mainDifferential !== undefined && !differential) errors.push('mainDifferential moet een object zijn.')
  if (differential) {
    for (const key of Object.keys(differential)) {
      if (!['ratedCurrentA', 'sensitivityMa', 'manufacturer', 'neutralPosition'].includes(key)) {
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
    if (differential.manufacturer !== undefined && (
      typeof differential.manufacturer !== 'string' || !differential.manufacturer.trim()
    )) errors.push('mainDifferential.manufacturer moet tekst zijn.')
    if (differential.neutralPosition !== undefined && differential.neutralPosition !== 'left' && differential.neutralPosition !== 'right') {
      errors.push('mainDifferential.neutralPosition is ongeldig.')
    }
  }

  if (
    value.solarPlacement !== undefined
    && value.solarPlacement !== 'parallel-after-main-differential'
  ) {
    errors.push('solarPlacement is ongeldig.')
  }

  if (value.additionalDifferentials !== undefined) {
    if (!Array.isArray(value.additionalDifferentials)) {
      errors.push('additionalDifferentials moet een array zijn.')
    } else if (value.additionalDifferentials.length > 12) {
      errors.push('additionalDifferentials mag maximaal 12 groepen bevatten.')
    } else {
      const totalCount = value.additionalDifferentials.reduce((sum, input) => {
        const differential = record(input)
        return sum + (differential && Number.isInteger(differential.count) ? Number(differential.count) : 0)
      }, 0)
      if (totalCount > 12) errors.push('additionalDifferentials mag samen maximaal 12 toestellen bevatten.')
      value.additionalDifferentials.forEach((input, index) => {
        const differential = record(input)
        const prefix = `additionalDifferentials[${index}]`
        if (!differential) {
          errors.push(`${prefix} moet een object zijn.`)
          return
        }
        for (const key of Object.keys(differential)) {
          if (!['count', 'sensitivityMa', 'ratedCurrentA', 'manufacturer', 'neutralPosition', 'purpose'].includes(key)) {
            errors.push(`Onbekend ${prefix}-veld: ${key}.`)
          }
        }
        if (!Number.isInteger(differential.count) || Number(differential.count) < 1 || Number(differential.count) > 12) {
          errors.push(`${prefix}.count moet een geheel getal van 1 tot en met 12 zijn.`)
        }
        if (typeof differential.sensitivityMa !== 'number' || !Number.isFinite(differential.sensitivityMa) || differential.sensitivityMa <= 0) {
          errors.push(`${prefix}.sensitivityMa moet positief zijn.`)
        }
        if (differential.ratedCurrentA !== undefined && (
          typeof differential.ratedCurrentA !== 'number'
          || !Number.isFinite(differential.ratedCurrentA)
          || differential.ratedCurrentA <= 0
        )) {
          errors.push(`${prefix}.ratedCurrentA moet positief zijn.`)
        }
        if (differential.manufacturer !== undefined && (
          typeof differential.manufacturer !== 'string' || !differential.manufacturer.trim()
        )) errors.push(`${prefix}.manufacturer moet tekst zijn.`)
        if (differential.neutralPosition !== undefined && differential.neutralPosition !== 'left' && differential.neutralPosition !== 'right') {
          errors.push(`${prefix}.neutralPosition is ongeldig.`)
        }
        if (!['consumers', 'ev', 'other'].includes(String(differential.purpose))) {
          errors.push(`${prefix}.purpose is ongeldig.`)
        }
      })
    }
  }
  return errors.length
    ? { valid: false, errors }
    : { valid: true, value: input as OneWireTopologyPlan, errors }
}
