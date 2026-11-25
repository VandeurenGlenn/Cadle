import type { PdfVectorText } from './pdf-vector-conversion.js'

export type SolarPanel = {
  manufacturer: string
  model: string
  powerWp: number
  vmpV?: number
  impA?: number
  vocV?: number
  iscA?: number
}

export type SolarPanelArray = {
  panel: SolarPanel
  panelCount: number
  stringCount: number
  panelsPerString?: number[]
}

export const distributeSolarPanels = (panelCount: number, stringCount: number): number[] => {
  if (!Number.isInteger(panelCount) || panelCount < 1 || panelCount > 10000 ||
    !Number.isInteger(stringCount) || stringCount < 1 || stringCount > panelCount) return []
  const base = Math.floor(panelCount / stringCount)
  return Array.from({ length: stringCount }, (_, index) =>
    base + (index >= stringCount - panelCount % stringCount ? 1 : 0))
}

export const solarStringPanelCounts = (array: SolarPanelArray): number[] =>
  array.panelsPerString ?? Array.from({ length: array.stringCount }, () => array.panelCount / array.stringCount)

export type SolarInverter = {
  inverterManufacturer: string
  inverterModel: string
  inverterPowerW: number
  phases: 1 | 3
  breakerCurrentA: number
  maxDcVoltageV?: number
  mpptCount?: number
}

export type SolarInstallation =
  | (SolarPanelArray & SolarInverter & { kind?: 'installation' })
  | (SolarPanelArray & { kind: 'panels' })
  | (SolarInverter & { kind: 'inverter' })

export const defaultPvCableForBreaker = (breakerCurrentA?: number) =>
  breakerCurrentA === 32 ? { conductors: 3, sectionMm2: 4, cableType: 'other' as const } : undefined

export const solarPanelFields = [
  { key: 'powerWp', label: 'Paneelvermogen STC (Wp)', pattern: /pmax|rated\s*peak\s*power|nominaal\s*vermogen/i },
  { key: 'vmpV', label: 'Vmp (V)', pattern: /vmp|maximum\s*power\s*voltage/i },
  { key: 'impA', label: 'Imp (A)', pattern: /imp\b|maximum\s*power\s*current/i },
  { key: 'vocV', label: 'Voc (V)', pattern: /voc|open\s*circuit\s*voltage/i },
  { key: 'iscA', label: 'Isc (A)', pattern: /isc\b|short\s*circuit\s*current/i }
] as const

export const solarDatasheetRows = (texts: readonly PdfVectorText[]): string => {
  const rows: { y: number; height: number; texts: PdfVectorText[] }[] = []
  for (const text of [...texts].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find((row) => Math.abs(row.y - text.y) < Math.max(4, Math.min(row.height, text.fontSize) * 0.8))
    if (row) row.texts.push(text)
    else rows.push({ y: text.y, height: text.fontSize, texts: [text] })
  }
  return rows.map((row) => row.texts.sort((a, b) => a.x - b.x).map((text) => text.text).join(' ')).join('\n')
}

export const normalizeSolarDatasheetHeaderContrast = (image: {
  width: number; height: number; data: Uint8ClampedArray
}): void => {
  const { width, height, data } = image
  for (let y = 0; y < height; y++) {
    let count = 0
    let first = width
    let last = 0
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4
      const red = data[index]
      const green = data[index + 1]
      const blue = data[index + 2]
      if (red > 100 && red < 200 && Math.max(red, green, blue) - Math.min(red, green, blue) < 20) {
        count++
        first = Math.min(first, x)
        last = x
      }
    }
    if (count < width * 0.4) continue
    // Turn light text on broad grey table headers into dark text on white.
    for (let x = first; x <= last; x++) {
      const index = (y * width + x) * 4
      const value = data[index] > 220 || data[index] < 70 ? 0 : 255
      data[index] = data[index + 1] = data[index + 2] = value
    }
  }
}

export const parseSolarDatasheet = (text: string): { panels: Partial<SolarPanel>[]; warnings: string[] } => {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const start = lines.findIndex((line) => /specification.*\bSTC\b|^\s*STC\s*$/i.test(line))
  const stc = (start < 0 ? lines : lines.slice(start + 1))
    .join('\n').split(/BNPI|bifacial|mechanical|operating parameters|NMOT|NOCT/i)[0].split('\n')
  const modelLine = stc.findIndex((line) => /model\s*(?:type|number|name)?/i.test(line))
  const modelText = modelLine < 0 ? '' : stc.slice(modelLine, modelLine + 2).join(' ')
  const models = (modelText.match(/\b[A-Z0-9]+(?:[-/.][A-Z0-9]+)*\b/gi) ?? [])
    .filter((model) => /[A-Z]/i.test(model) && /\d/.test(model))
  const values = solarPanelFields.map(({ key, pattern }) => {
    const line = stc.find((line) => pattern.test(line))
    const tokens = line?.slice((line.match(pattern)?.index ?? 0) + (line.match(pattern)?.[0].length ?? 0))
      .match(/(?<![a-zA-Z0-9])\d+(?:[.,]\d+)?/g) ?? []
    return { key, tokens, numbers: tokens.map((value) => Number(value.replace(',', '.'))) }
  })
  const powerValues = values.find(({ key }) => key === 'powerWp')!
  const count = models.length || powerValues.numbers.length
  const panels: Partial<SolarPanel>[] = Array.from({ length: count }, (_, index) => ({ model: models[index] ?? '' }))
  const warnings: string[] = []
  for (const { key, numbers, tokens } of values) {
    if (numbers.length !== count || !numbers.length || numbers.some((value) => value <= 0)) {
      warnings.push(`${solarPanelFields.find((field) => field.key === key)!.label}: niet betrouwbaar herkend; controleer of vul zelf in.`)
      continue
    }
    const decimalMax = Math.max(0, ...numbers.filter((_, index) => /[.,]/.test(tokens[index])))
    numbers.forEach((value, index) => {
      if (key !== 'powerWp' && decimalMax > 0 && !/[.,]/.test(tokens[index]) && value > decimalMax * 10) {
        warnings.push(`Variant ${index + 1}: ${solarPanelFields.find((field) => field.key === key)!.label} "${tokens[index]}" heeft mogelijk een ontbrekend decimaalteken. Vul de gecontroleerde waarde in.`)
      } else panels[index][key] = value
    })
  }
  const modelPatterns = new Map<string, number>()
  for (const panel of panels) {
    if (!panel.powerWp || !panel.model?.includes(String(panel.powerWp))) continue
    const pattern = panel.model.replace(String(panel.powerWp), '{Wp}')
    modelPatterns.set(pattern, (modelPatterns.get(pattern) ?? 0) + 1)
  }
  const pattern = [...modelPatterns].find(([, count]) => count >= Math.max(2, Math.ceil(panels.length * 0.6)))?.[0]
  panels.forEach((panel, index) => {
    for (const [key, reference] of [['vocV', 'vmpV'], ['iscA', 'impA']] as const) {
      if (panel[key] && panel[reference] && panel[key]! > panel[reference]! * 2) {
        warnings.push(`Variant ${index + 1}: ${solarPanelFields.find((field) => field.key === key)!.label} is onwaarschijnlijk. Controleer het decimaalteken.`)
        delete panel[key]
      }
    }
    if (pattern && panel.powerWp && panel.model !== pattern.replace('{Wp}', String(panel.powerWp))) {
      warnings.push(`Variant ${index + 1}: typenummer "${panel.model}" wijkt af van de modelreeks. Controleer en vul het typenummer in.`)
      panel.model = ''
    }
    if (panel.powerWp && panel.vmpV && panel.impA && Math.abs(panel.vmpV * panel.impA / panel.powerWp - 1) > 0.08) {
      warnings.push(`Variant ${index + 1}: Vmp × Imp komt niet overeen met het STC-vermogen. Controleer beide waarden en hun decimalen.`)
      delete panel.vmpV
      delete panel.impA
    }
  })
  if (!panels.length) warnings.unshift('Geen paneelgegevens herkend. Vul de gegevens handmatig in.')
  return { panels, warnings }
}

export const parseInverterDatasheet = (text: string): { inverters: Partial<SolarInverter>[]; warnings: string[] } => {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const warnings: string[] = []
  const headerEnd = lines.findIndex((line) => /^(?:efficiency|DC\s*input|input|output)\b/i.test(line))
  const header = lines.slice(0, headerEnd < 0 ? 15 : headerEnd)
  let models: string[] = []
  for (let index = 0; index < header.length; index++) {
    const candidates = (header[index].match(/\b[A-Z][A-Z0-9]*(?:[-/.][A-Z0-9]+)+-?/gi) ?? [])
      .filter((model) => /\d/.test(model) && !/\d+\//.test(model))
    if (!candidates.length) continue
    const wrapped = candidates.some((model) => model.endsWith('-'))
    const suffixes = wrapped ? header.slice(index + 1, index + 4)
      .map((line) => line.split(/\s+/).filter((part) => /^[A-Z][A-Z0-9]{1,7}$/.test(part)))
      .find((parts) => parts.length === candidates.length) : undefined
    const minimumParts = Math.min(...candidates.map((model) => model.split(/[-/]/).filter(Boolean).length))
    models = candidates.map((model, column) => {
      if (suffixes && model.split(/[-/]/).filter(Boolean).length === minimumParts) return `${model.replace(/-$/, '')}-${suffixes[column]}`
      if (!model.endsWith('-')) return model
      warnings.push(`Variant ${column + 1}: modelcode lijkt afgebroken. Controleer en vul het volledige typenummer in.`)
      return ''
    })
    models.forEach((model, column) => {
      if (/-[A-Z]*O[A-Z]*$/.test(model)) {
        warnings.push(`Variant ${column + 1}: controleer letter O versus cijfer 0 in "${model}". De modelcode wordt niet automatisch gecorrigeerd.`)
      }
    })
    break
  }
  const powerPattern = /^(?:rated\s*(?:AC\s*)?output\s*power|nominal\s*(?:AC\s*)?(?:output\s*)?power|nominaal\s*(?:AC[- ]?)?vermogen)\b/i
  const powerLine = lines.find((line) => powerPattern.test(line))
  const tail = powerLine?.replace(powerPattern, '') ?? ''
  const unit = /^\s*\(?\s*(kW|W)\b/i.exec(tail)?.[1]
  const powers = [...tail.matchAll(/(\d[\d.,]*)\s*(kW|W)?/gi)].map((match) => {
    const powerUnit = match[2] ?? unit
    const kilo = /^kW$/i.test(powerUnit ?? '')
    const raw = !kilo && /^\d{1,3}(?:[.,]\d{3})+$/.test(match[1]) ? match[1].replace(/[.,]/g, '') : match[1].replace(',', '.')
    return { value: Number(raw) * (kilo ? 1000 : 1), unit: powerUnit }
  })
  const count = models.length || powers.length
  const inverters: Partial<SolarInverter>[] = Array.from({ length: count }, (_, index) => ({ inverterModel: models[index] ?? '' }))
  const manufacturer = /^(?:manufacturer|fabrikant|merk)\s*:\s*(.+)$/im.exec(text)?.[1]?.trim()
  if (manufacturer) inverters.forEach((inverter) => { inverter.inverterManufacturer = manufacturer })
  if (powers.length === count && powers.every((power) => power.unit && Number.isFinite(power.value) && power.value > 0)) {
    powers.forEach((power, index) => { inverters[index].inverterPowerW = power.value })
  } else warnings.push('Nominaal AC-uitgangsvermogen: niet betrouwbaar herkend; controleer of vul zelf in. DC-paneelvermogen en maximaal/schijnbaar vermogen worden niet gebruikt.')
  for (const { key, pattern, integer } of [
    { key: 'maxDcVoltageV', pattern: /^(?:max(?:imum)?\.?\s*input\s*voltage|maximale\s*DC[- ]?spanning)\b/i, integer: false },
    { key: 'mpptCount', pattern: /^(?:number\s*of\s*MPP(?:T)?\s*trackers|aantal\s*MPPT(?:[- ]?trackers)?)\b/i, integer: true }
  ] as const) {
    const line = lines.find((line) => pattern.test(line))
    const numbers = line?.replace(pattern, '').match(/\d[\d.,]*/g)?.map((raw) =>
      Number(/^\d{1,3}(?:[.,]\d{3})+$/.test(raw) ? raw.replace(/[.,]/g, '') : raw.replace(',', '.'))) ?? []
    if ((numbers.length === 1 || numbers.length === count) &&
      numbers.every((value) => Number.isFinite(value) && value > 0 && (!integer || Number.isInteger(value)))) {
      inverters.forEach((inverter, index) => { inverter[key] = numbers.length === 1 ? numbers[0] : numbers[index] })
    }
  }
  if (/3W\/?N\+PE|3L\+N|threephase|3phase|3fas/i.test(text.replace(/\s+/g, ''))) {
    inverters.forEach((inverter) => { inverter.phases = 3 })
  }
  if (!inverters.length) warnings.unshift('Geen omvormergegevens herkend. Vul de gegevens handmatig in.')
  return { inverters, warnings }
}

export const validateSolarInstallation = (value: SolarInstallation): string | null => {
  if (value.kind !== 'inverter') {
    if (!value.panel.model.trim()) return 'Vul het paneelmodel in.'
    if (!Number.isInteger(value.panelCount) || value.panelCount < 1 || value.panelCount > 10000 ||
      !Number.isInteger(value.stringCount) || value.stringCount < 1 || value.stringCount > value.panelCount) {
      return 'Gebruik een positief aantal panelen en maximaal één string per paneel.'
    }
    if (value.panelsPerString !== undefined) {
      if (!Array.isArray(value.panelsPerString) || value.panelsPerString.length !== value.stringCount ||
        value.panelsPerString.some((count) => !Number.isInteger(count) || count < 1) ||
        value.panelsPerString.reduce((sum, count) => sum + count, 0) !== value.panelCount) {
        return 'De aantallen per string moeten positieve gehele getallen zijn en samen gelijk zijn aan het aantal panelen.'
      }
    } else if (value.panelCount % value.stringCount !== 0) {
      return 'Vul het aantal panelen per string in; de panelen zijn niet gelijk verdeeld.'
    }
    for (const { key } of solarPanelFields) {
      const number = value.panel[key]
      if ((key === 'powerWp' || number !== undefined) && (!Number.isFinite(number) || number! <= 0)) return 'Paneelwaarden moeten positieve getallen zijn.'
    }
    if (value.panel.vmpV && value.panel.vocV && value.panel.vmpV >= value.panel.vocV) return 'Vmp moet kleiner zijn dan Voc.'
    if (value.panel.impA && value.panel.iscA && value.panel.impA >= value.panel.iscA) return 'Imp moet kleiner zijn dan Isc.'
  }
  if (value.kind !== 'panels') {
    if (!value.inverterModel.trim()) return 'Vul het omvormermodel in.'
    if (![value.inverterPowerW, value.breakerCurrentA].every((number) => Number.isFinite(number) && number > 0) ||
      (value.phases !== 1 && value.phases !== 3)) return 'Controleer het AC-vermogen, het aantal fasen en de automaatstroom.'
    if ((value.maxDcVoltageV !== undefined && (!Number.isFinite(value.maxDcVoltageV) || value.maxDcVoltageV <= 0)) ||
      (value.mpptCount !== undefined && (!Number.isInteger(value.mpptCount) || value.mpptCount < 1))) return 'Controleer de maximale DC-spanning en het aantal MPPT-trackers.'
  }
  return null
}

export const sanitizeSolarInstallation = (input: unknown): SolarInstallation | undefined => {
  if (!input || typeof input !== 'object') return undefined
  const raw = input as Record<string, unknown>
  if (raw.kind !== undefined && raw.kind !== 'installation' && raw.kind !== 'panels' && raw.kind !== 'inverter') return undefined
  const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
  const number = (value: unknown) => typeof value === 'number' ? value : NaN
  let panels: SolarPanelArray | undefined
  if (raw.kind !== 'inverter') {
    if (!raw.panel || typeof raw.panel !== 'object') return undefined
    const panel = raw.panel as Record<string, unknown>
    panels = { panel: { manufacturer: text(panel.manufacturer), model: text(panel.model), powerWp: number(panel.powerWp),
      ...Object.fromEntries(solarPanelFields.slice(1).filter(({ key }) => panel[key] !== undefined)
        .map(({ key }) => [key, number(panel[key])])) },
      panelCount: number(raw.panelCount), stringCount: number(raw.stringCount),
      ...(raw.panelsPerString !== undefined ? {
        panelsPerString: Array.isArray(raw.panelsPerString) ? raw.panelsPerString.map(number) : []
      } : {}) }
  }
  let inverter: SolarInverter | undefined
  if (raw.kind !== 'panels') {
    if (raw.phases !== 1 && raw.phases !== 3) return undefined
    inverter = { inverterManufacturer: text(raw.inverterManufacturer), inverterModel: text(raw.inverterModel),
      inverterPowerW: number(raw.inverterPowerW), phases: raw.phases, breakerCurrentA: number(raw.breakerCurrentA),
      ...(raw.maxDcVoltageV !== undefined ? { maxDcVoltageV: number(raw.maxDcVoltageV) } : {}),
      ...(raw.mpptCount !== undefined ? { mpptCount: number(raw.mpptCount) } : {}) }
  }
  const value: SolarInstallation = raw.kind === 'inverter' ? { ...inverter!, kind: 'inverter' }
    : raw.kind === 'panels' ? { ...panels!, kind: 'panels' }
      : { ...panels!, ...inverter!, ...(raw.kind === 'installation' ? { kind: 'installation' as const } : {}) }
  return validateSolarInstallation(value) ? undefined : value
}
