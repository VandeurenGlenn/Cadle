import type { OneWireTopologyPlan } from '../types.js'
import { validateOneWireTopology } from './onewire-topology-schema.js'
import { assessOneWireCapacity } from './onewire-capacity.js'

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

const mentionsAffirmatively = (text: string, term: RegExp): boolean => {
  const matches = text.matchAll(new RegExp(term.source, `${term.flags.replace('g', '')}g`))
  for (const match of matches) {
    if (match.index === undefined) continue
    const prefix = text.slice(Math.max(0, match.index - 36), match.index)
    if (!/\b(?:geen|zonder|afwezig|niet|noch)\b(?:\s+\p{L}+){0,3}\s*$/iu.test(prefix)) return true
  }
  return false
}

const topologyWarnings = (plan: OneWireTopologyPlan, prompt = ''): string[] => {
  const warnings: string[] = []
  if (!plan.incomingCable) {
    warnings.push('Geen volledige inkomende kabel herkend, bijvoorbeeld “4x10 mm² EXVB”.')
  }
  if (!plan.mainDifferential) {
    warnings.push('Hoofddifferentieel is onvolledig; vermeld zowel de nominale stroom in A als de gevoeligheid in mA.')
  }
  if (plan.solar && !/\b(samen|naast|kant|parallel|hoofdbus|verdeelrail)\b/iu.test(prompt)) {
    warnings.push('PV-positie niet vermeld; Cadle neemt parallel na de hoofddifferentieel aan. Controleer dit vóór het genereren.')
  }
  if (!plan.residualBreaker) {
    const capacity = assessOneWireCapacity(plan)
    if (capacity.status === 'overload') {
      warnings.push(
        `${capacity.message}. ${capacity.detail}. Een hogere differentieel begrenst de stroom niet; controleer rail, bedrading, klemmen en fabrikantgegevens.`
      )
    } else if (capacity.status === 'unknown' && plan.solar) {
      warnings.push('PV en downstream-verbruikers zonder remautomaat: vul de hoofdzekering in om de maximale kaststroom te controleren.')
    } else {
      warnings.push(
        plan.solar && (plan.consumers || (plan.additionalDifferentials?.length ?? 0) > 0)
          ? 'PV en downstream-verbruikers zonder remautomaat: controleer dat de som van net- en PV-stroom de nominale stroom van rails en differentieels niet overschrijdt.'
          : 'Het schema bevat geen remautomaat.'
      )
    }
  }
  if (plan.residualBreaker) {
    const residualLimitA = plan.residualBreakerRatedCurrentA ?? 40
    const undersizedDifferential = plan.additionalDifferentials?.find((item) =>
      (item.ratedCurrentA ?? plan.mainDifferential?.ratedCurrentA ?? residualLimitA) < residualLimitA
    )
    if (undersizedDifferential) {
      warnings.push(
        `Een downstream-differentieel is lager gedimensioneerd dan de remautomaat van ${residualLimitA} A. Controleer de overstroombeveiliging.`
      )
    }
  }
  if (!plan.consumers) warnings.push('Het schema bevat geen verbruikers of kringen.')
  return warnings
}

const differentialPurpose = (value: string): 'consumers' | 'ev' | 'other' => {
  if (/\b(ev|elektrische\s+(?:wagen|auto)|laadpaal)\b/iu.test(value)) return 'ev'
  if (/\b(verbruikers?|kringen?|groepen?|eindstroombanen?)\b/iu.test(value)) return 'consumers'
  return 'other'
}

const recognizedManufacturer = (value: string): string | undefined => {
  if (/\bschneider(?:\s+electric)?\b/iu.test(value)) return 'Schneider Electric'
  if (/\b(?:teco|tecko)\b/iu.test(value)) return 'TECO'
  if (/\bniko\b/iu.test(value)) return 'Niko'
  if (/\bhager\b/iu.test(value)) return 'Hager'
  if (/\babb\b/iu.test(value)) return 'ABB'
  if (/\blegrand\b/iu.test(value)) return 'Legrand'
  return undefined
}

const manufacturerNeutralPosition = (manufacturer: string | undefined): 'left' | 'right' | undefined =>
  manufacturer === 'Schneider Electric' ? 'left' : manufacturer === 'TECO' ? 'right' : undefined

const parseAdditionalDifferentials = (text: string): NonNullable<OneWireTopologyPlan['additionalDifferentials']> => {
  const result: NonNullable<OneWireTopologyPlan['additionalDifferentials']> = []
  const pattern = /(\d+)\s+(?:(?:bijkomende|extra)\s+)?(?:diffs?|differenti(?:e|ë)len?)\s+(?:(schneider(?:\s+electric)?|teco|tecko|niko|hager|abb|legrand)\s+)?(?:(\d+(?:[.,]\d+)?)\s*a\s+)?(\d+(?:[.,]\d+)?)\s*ma(?:\s+(?:voor|naar)\s+([^.,;]+))?/giu
  for (const match of text.matchAll(pattern)) {
    const count = Number(match[1])
    const ratedCurrentA = match[3] ? Number(match[3].replace(',', '.')) : undefined
    const sensitivityMa = Number(match[4].replace(',', '.'))
    const purposeText = match[5] ?? ''
    const manufacturer = recognizedManufacturer(match[2] ?? '')
    const neutralPosition = manufacturerNeutralPosition(manufacturer)
    const inheritedPattern = /\ben\s+(\d+)\s+(?:(?:diffs?|differenti(?:e|ë)len?)\s+)?(?:voor|naar)\s+([^,;.]+)/giu
    const firstInherited = inheritedPattern.exec(purposeText)
    const primaryPurpose = firstInherited ? purposeText.slice(0, firstInherited.index) : purposeText
    result.push({
      count,
      sensitivityMa,
      ...(ratedCurrentA ? { ratedCurrentA } : {}),
      ...(manufacturer ? { manufacturer } : {}),
      ...(neutralPosition ? { neutralPosition } : {}),
      purpose: differentialPurpose(primaryPurpose)
    })

    inheritedPattern.lastIndex = 0
    for (const inherited of purposeText.matchAll(inheritedPattern)) {
      result.push({
        count: Number(inherited[1]),
        sensitivityMa,
        ...(ratedCurrentA ? { ratedCurrentA } : {}),
        ...(manufacturer ? { manufacturer } : {}),
        ...(neutralPosition ? { neutralPosition } : {}),
        purpose: differentialPurpose(inherited[2])
      })
    }
  }
  return result
}

export const parseOneWirePrompt = (prompt: string): ParsedOneWirePrompt => {
  const text = prompt.trim()
  const lower = text.toLocaleLowerCase('nl-BE')
  const residualBreakerTerm = /\b(remautomaat|differentieelautomaat|rcbo)\b/iu
  const solarTerm = /\b(zonnepanelen?|fotovolta(?:ïsch(?:e)?)?|pv(?:-installatie)?|omvormer)\b/iu
  const consumerTerm = /\b(verbruikers?|kringen?|groepen?|eindstroombanen?|stopcontact(?:en)?|lichtkringen?)\b/iu
  const plan: OneWireTopologyPlan = {
    version: 1,
    residualBreaker: mentionsAffirmatively(text, residualBreakerTerm),
    solar: mentionsAffirmatively(text, solarTerm),
    consumers: mentionsAffirmatively(text, consumerTerm)
  }
  const gridProtectionCurrent =
    /\b(?:hoofdzekering|netaansluiting|netautomaat|aansluitautomaat)\b[^.\n,;]{0,24}?\b(?:c\s*)?(\d+(?:[.,]\d+)?)\s*a\b/iu.exec(text)?.[1]
    ?? /\b(?:c\s*)?(\d+(?:[.,]\d+)?)\s*a\b[^.\n,;]{0,20}?\b(?:hoofdzekering|netaansluiting|netautomaat|aansluitautomaat)\b/iu.exec(text)?.[1]
  if (gridProtectionCurrent) {
    plan.gridProtectionCurrentA = Number(gridProtectionCurrent.replace(',', '.'))
  }
  if (plan.residualBreaker) {
    const residualContext =
      /\b(?:remautomaat|differentieelautomaat|rcbo)\b[^.\n,;]*/iu.exec(text)?.[0] ?? ''
    const residualManufacturer = recognizedManufacturer(residualContext)
    const residualBreakerCurrent =
      /\b(?:remautomaat|differentieelautomaat|rcbo)\b[^.\n,;]{0,30}?\b(?:c\s*)?(\d+(?:[.,]\d+)?)\s*a\b/iu.exec(text)?.[1]
      ?? /\b(?:c\s*)?(\d+(?:[.,]\d+)?)\s*a\b[^.\n,;]{0,20}?\b(?:remautomaat|differentieelautomaat|rcbo)\b/iu.exec(text)?.[1]
    plan.residualBreakerRatedCurrentA = residualBreakerCurrent
      ? Number(residualBreakerCurrent.replace(',', '.'))
      : 40
    if (residualManufacturer) {
      plan.residualBreakerManufacturer = residualManufacturer
      plan.residualBreakerNeutralPosition = manufacturerNeutralPosition(residualManufacturer)
    }
  }

  const mainSwitchContext =
    /\bhoofdschakelaar\b[^.\n,;]*/iu.exec(text)?.[0]
    ?? /\b(?:c\s*)?\d+(?:[.,]\d+)?\s*a\b[^.\n,;]{0,20}?\bhoofdschakelaar\b/iu.exec(text)?.[0]
    ?? ''
  const mainSwitchCurrent =
    /\bhoofdschakelaar\b[^.\n,;]{0,30}?\b(?:c\s*)?(\d+(?:[.,]\d+)?)\s*a\b/iu.exec(text)?.[1]
    ?? /\b(?:c\s*)?(\d+(?:[.,]\d+)?)\s*a\b[^.\n,;]{0,20}?\bhoofdschakelaar\b/iu.exec(text)?.[1]
  if (mainSwitchCurrent) {
    const manufacturer = recognizedManufacturer(mainSwitchContext)
    const neutralPosition = manufacturerNeutralPosition(manufacturer)
    plan.mainSwitch = {
      ratedCurrentA: Number(mainSwitchCurrent.replace(',', '.')),
      ...(manufacturer ? { manufacturer } : {}),
      ...(neutralPosition ? { neutralPosition } : {})
    }
  }

  const cable = /(\d+)\s*[xg×]\s*(\d+(?:[.,]\d+)?)\s*(?:mm(?:²|2))?\s*(exvb|exb|xvb(?:[-\s]?cca)?|xgb(?:[-\s]?cca)?|vob)\b/i.exec(text)
  if (cable) {
    plan.incomingCable = {
      conductors: Number(cable[1]),
      sectionMm2: Number(cable[2].replace(',', '.')),
      cableType: normalizeCableType(cable[3])
    }
  }

  const differentialContext = /\b(?:hoofd)?diff(?:erentieel)?\b[^.\n,;]*/i.exec(text)?.[0] ?? text
  const current = /\b(\d+(?:[.,]\d+)?)\s*a\b/i.exec(differentialContext)
  const sensitivity = /\b(\d+(?:[.,]\d+)?)\s*ma\b/i.exec(differentialContext)
  if (current && sensitivity) {
    const manufacturer = recognizedManufacturer(differentialContext)
    plan.mainDifferential = {
      ratedCurrentA: Number(current[1].replace(',', '.')),
      sensitivityMa: Number(sensitivity[1].replace(',', '.')),
      ...(manufacturer ? { manufacturer } : {}),
      ...(manufacturerNeutralPosition(manufacturer)
        ? { neutralPosition: manufacturerNeutralPosition(manufacturer) }
        : {})
    }
  }

  if (plan.solar && /\b(samen|naast|kant|parallel|hoofdbus|verdeelrail)\b/i.test(lower)) {
    plan.solarPlacement = 'parallel-after-main-differential'
  } else if (plan.solar) {
    plan.solarPlacement = 'parallel-after-main-differential'
  }
  if (plan.solar) {
    const solarBreakerCurrent =
      /\b(?:pv|solar|zonnepanelen?|omvormer)[-\s]?(?:automaat|beveiliging)\b[^.\n,;]{0,24}?\b(?:c\s*)?(\d+(?:[.,]\d+)?)\s*a\b/iu.exec(text)?.[1]
      ?? /\b(?:c\s*)?(\d+(?:[.,]\d+)?)\s*a\b[^.\n,;]{0,24}?\b(?:pv|solar|zonnepanelen?|omvormer)[-\s]?(?:automaat|beveiliging)\b/iu.exec(text)?.[1]
    if (solarBreakerCurrent) {
      plan.solarBreakerRatedCurrentA = Number(solarBreakerCurrent.replace(',', '.'))
    }
    const solarProtectionContext =
      /\b(?:pv|solar|zonnepanelen?|omvormer)[-\s]?(?:automaat|beveiliging)\b[^.\n,;]*/iu.exec(text)?.[0] ?? ''
    const solarManufacturer = recognizedManufacturer(solarProtectionContext)
    if (solarManufacturer) {
      plan.solarBreakerManufacturer = solarManufacturer
      plan.solarBreakerNeutralPosition = manufacturerNeutralPosition(solarManufacturer)
    }
  }
  const additionalDifferentials = parseAdditionalDifferentials(text)
  if (additionalDifferentials.length) plan.additionalDifferentials = additionalDifferentials

  return { plan, warnings: topologyWarnings(plan, text) }
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
  if (validation.valid && validation.value) {
    return { plan: validation.value, warnings: topologyWarnings(validation.value, prompt) }
  }
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
  const mainSwitch = plan.mainSwitch
    ? `hoofdschakelaar ${plan.mainSwitch.ratedCurrentA} A`
    : 'hoofdschakelaar'
  return [
    `${mainSwitch} → kWh-meter → ${cable} → ${differential}`,
    ...(plan.solar ? ['├─ zonnepanelen / omvormer'] : []),
    ...(plan.additionalDifferentials ?? []).map((item, index, items) => {
      const connector = index === items.length - 1 && !plan.residualBreaker ? '└─' : '├─'
      const purpose = item.purpose === 'ev' ? 'EV' : item.purpose === 'consumers' ? 'verbruikers' : 'overig'
      const rating = item.ratedCurrentA ? `${item.ratedCurrentA} A / ` : ''
      return `${connector} ${item.count}× differentieel ${rating}${item.sensitivityMa} mA → ${purpose}`
    }),
    ...(plan.residualBreaker
      ? [`└─ remautomaat ${plan.residualBreakerRatedCurrentA ?? 40} A${plan.consumers ? ' → verbruikers' : ''}`]
      : plan.consumers
        ? ['└─ verbruikers']
        : [])
  ]
}
