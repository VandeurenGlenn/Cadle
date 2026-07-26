import type { OneWireTopologyPlan } from '../types.js'
import { validateOneWireTopology } from './onewire-topology-schema.js'

export type ParsedOneWirePrompt = {
  plan: OneWireTopologyPlan
  warnings: string[]
}

const normalizeCableType = (value: string): OneWireTopologyPlan['incomingCable']['cableType'] => {
  const normalized = value.toUpperCase().replace(/\s+/g, '')
  if (normalized === 'EXB' || normalized === 'EXVB') return 'EXVB'
  if (normalized === 'XVBCCA' || normalized === 'XVB-CCA') return 'XVB-Cca'
  if (normalized === 'XGBCCA' || normalized === 'XGB-CCA') return 'XGB-Cca'
  if (normalized === 'VOB' || normalized === 'XVB' || normalized === 'XGB') return normalized
  return 'other'
}

export const parseOneWirePrompt = (prompt: string): ParsedOneWirePrompt => {
  const text = prompt.trim()
  const lower = text.toLocaleLowerCase('nl-BE')
  const plan: OneWireTopologyPlan = {
    version: 1,
    residualBreaker: /\b(remautomaat|differentieelautomaat|rcbo)\b/i.test(text),
    solar: /\b(zonnepanelen|fotovolta|pv|omvormer)\b/i.test(text),
    consumers: /\b(verbruikers|kringen|groepen)\b/i.test(text)
  }
  const warnings: string[] = []

  const cable = /(\d+)\s*[xg]\s*(\d+(?:[.,]\d+)?)\s*(?:mm(?:²|2))?\s*(exvb|exb|xvb(?:[-\s]?cca)?|xgb(?:[-\s]?cca)?|vob)\b/i.exec(text)
  if (cable) {
    plan.incomingCable = {
      conductors: Number(cable[1]),
      sectionMm2: Number(cable[2].replace(',', '.')),
      cableType: normalizeCableType(cable[3])
    }
  } else {
    warnings.push('Geen volledige inkomende kabel herkend, bijvoorbeeld “4x10 mm² EXVB”.')
  }

  const differentialContext = /\b(?:hoofd)?diff(?:erentieel)?\b[^.\n,;]*/i.exec(text)?.[0] ?? text
  const current = /\b(\d+(?:[.,]\d+)?)\s*a\b/i.exec(differentialContext)
  const sensitivity = /\b(\d+(?:[.,]\d+)?)\s*ma\b/i.exec(differentialContext)
  if (current && sensitivity) {
    plan.mainDifferential = {
      ratedCurrentA: Number(current[1].replace(',', '.')),
      sensitivityMa: Number(sensitivity[1].replace(',', '.'))
    }
  } else {
    warnings.push('Hoofddifferentieel is onvolledig; vermeld zowel A als mA.')
  }

  if (plan.solar && /\b(samen|naast|kant|parallel)\b/i.test(lower)) {
    plan.solarPlacement = 'parallel-after-main-differential'
  } else if (plan.solar) {
    plan.solarPlacement = 'parallel-after-main-differential'
    warnings.push('Zonnepanelen worden volgens de beschreven AREI-opbouw parallel na de hoofddifferentieel geplaatst.')
  }
  if (!plan.residualBreaker) warnings.push('Geen remautomaat herkend.')
  if (!plan.consumers) warnings.push('Geen verbruikers of kringen herkend.')

  return { plan, warnings }
}

export type OneWirePromptModel = {
  infer: (prompt: string, schema: unknown) => Promise<unknown>
}

export const interpretOneWirePrompt = async (
  prompt: string,
  model?: OneWirePromptModel
): Promise<ParsedOneWirePrompt> => {
  if (!model) return parseOneWirePrompt(prompt)
  const inferred = await model.infer(prompt, (await import('./onewire-topology-schema.js')).ONE_WIRE_TOPOLOGY_SCHEMA)
  const validation = validateOneWireTopology(inferred)
  if (validation.valid && validation.value) return { plan: validation.value, warnings: [] }
  const fallback = parseOneWirePrompt(prompt)
  return {
    ...fallback,
    warnings: [
      `Lokaal model gaf ongeldige topologie: ${validation.errors.join(' ')}`,
      ...fallback.warnings
    ]
  }
}

export const oneWirePromptTree = (plan: OneWireTopologyPlan): string[] => {
  const cable = plan.incomingCable
    ? `${plan.incomingCable.conductors}x${plan.incomingCable.sectionMm2} mm² ${plan.incomingCable.cableType}`
    : 'inkomende kabel'
  const differential = plan.mainDifferential
    ? `hoofddifferentieel ${plan.mainDifferential.ratedCurrentA} A / ${plan.mainDifferential.sensitivityMa} mA`
    : 'hoofddifferentieel'
  return [
    `kWh-meter → ${cable} → ${differential}`,
    ...(plan.solar ? ['├─ zonnepanelen / omvormer'] : []),
    ...(plan.residualBreaker
      ? [`└─ remautomaat${plan.consumers ? ' → verbruikers' : ''}`]
      : plan.consumers
        ? ['└─ verbruikers']
        : [])
  ]
}
