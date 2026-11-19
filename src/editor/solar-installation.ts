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

export type SolarInstallation = {
  panel: SolarPanel
  panelCount: number
  stringCount: number
  inverterManufacturer: string
  inverterModel: string
  inverterPowerW: number
  phases: 1 | 3
  breakerCurrentA: number
}

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
    const row = rows.find((row) => Math.abs(row.y - text.y) < Math.max(4, Math.min(row.height, text.fontSize) * 0.6))
    if (row) row.texts.push(text)
    else rows.push({ y: text.y, height: text.fontSize, texts: [text] })
  }
  return rows.map((row) => row.texts.sort((a, b) => a.x - b.x).map((text) => text.text).join(' ')).join('\n')
}

export const parseSolarDatasheet = (text: string): { panels: Partial<SolarPanel>[]; warnings: string[] } => {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const start = lines.findIndex((line) => /specification.*\bSTC\b|^\s*STC\s*$/i.test(line))
  const stc = (start < 0 ? lines : lines.slice(start + 1))
    .join('\n').split(/BNPI|bifacial|mechanical|operating parameters|NMOT|NOCT/i)[0].split('\n')
  const modelLine = stc.findIndex((line) => /model\s*(?:type|number|name)?/i.test(line))
  const modelText = modelLine < 0 ? '' : stc.slice(modelLine, modelLine + 2).join(' ')
  const models = modelText.match(/\b[A-Z]{1,12}\d{2,5}[A-Z0-9]*(?:[-/][A-Z0-9]+)*\b/gi) ?? []
  const values = solarPanelFields.map(({ key, pattern }) => {
    const line = stc.find((line) => pattern.test(line))
    const tokens = line?.slice((line.match(pattern)?.index ?? 0) + (line.match(pattern)?.[0].length ?? 0))
      .match(/(?<![a-zA-Z0-9])\d+(?:[.,]\d+)?/g) ?? []
    return { key, tokens, numbers: tokens.map((value) => Number(value.replace(',', '.'))) }
  })
  const count = models.length || Math.max(0, ...values.map(({ numbers }) => numbers.length))
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

export const validateSolarInstallation = (value: SolarInstallation): string | null => {
  if (!value.panel.model.trim() || !value.inverterModel.trim()) return 'Vul het paneelmodel en het omvormermodel in.'
  if (!Number.isInteger(value.panelCount) || value.panelCount < 1 || value.panelCount > 10000 ||
    !Number.isInteger(value.stringCount) || value.stringCount < 1 || value.panelCount % value.stringCount !== 0) {
    return 'Gebruik een positief aantal panelen en gelijke strings waarin alle panelen passen.'
  }
  if (![value.panel.powerWp, value.inverterPowerW, value.breakerCurrentA].every((number) => Number.isFinite(number) && number > 0) ||
    (value.phases !== 1 && value.phases !== 3)) return 'Controleer de vermogens, het aantal fasen en de automaatstroom.'
  for (const { key } of solarPanelFields) {
    const number = value.panel[key]
    if (number !== undefined && (!Number.isFinite(number) || number <= 0)) return 'Paneelwaarden moeten positieve getallen zijn.'
  }
  if (value.panel.vmpV && value.panel.vocV && value.panel.vmpV >= value.panel.vocV) return 'Vmp moet kleiner zijn dan Voc.'
  if (value.panel.impA && value.panel.iscA && value.panel.impA >= value.panel.iscA) return 'Imp moet kleiner zijn dan Isc.'
  return null
}

export const sanitizeSolarInstallation = (input: unknown): SolarInstallation | undefined => {
  if (!input || typeof input !== 'object') return undefined
  const raw = input as Record<string, unknown>
  if (!raw.panel || typeof raw.panel !== 'object') return undefined
  const panel = raw.panel as Record<string, unknown>
  const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
  const number = (value: unknown) => typeof value === 'number' ? value : NaN
  const value: SolarInstallation = {
    panel: { manufacturer: text(panel.manufacturer), model: text(panel.model), powerWp: number(panel.powerWp),
      ...Object.fromEntries(solarPanelFields.slice(1).filter(({ key }) => panel[key] !== undefined)
        .map(({ key }) => [key, number(panel[key])])) },
    panelCount: number(raw.panelCount), stringCount: number(raw.stringCount),
    inverterManufacturer: text(raw.inverterManufacturer), inverterModel: text(raw.inverterModel),
    inverterPowerW: number(raw.inverterPowerW), phases: raw.phases === 3 ? 3 : 1,
    breakerCurrentA: number(raw.breakerCurrentA)
  }
  if (raw.phases !== 1 && raw.phases !== 3) return undefined
  return validateSolarInstallation(value) ? undefined : value
}
