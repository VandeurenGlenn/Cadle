import type { PaperPreset } from '../native-draw/types.js'

export const LEGACY_STORAGE_KEY = 'cadle-native-drawing-v1'
export const DEFAULT_WORLD_WIDTH = 2400
export const DEFAULT_WORLD_HEIGHT = 1400
export const GRID_SIZE = 20
export const DEFAULT_PRINT_MARGIN_MM = 10
export const ONE_WIRE_BREAKER_WIDTH = 240
export const ONE_WIRE_NODE_SIZE = 170
export const ONE_WIRE_CIRCUIT_SPACING = 300

export type OneWirePreset = 'lighting' | 'sockets' | 'motor'

export type OneWirePresetConfig = {
  label: string
  breaker: string
  load: string
  switchLabel: string
  wireSection: string
}

export type PaperPresetConfig = {
  label: string
  widthMm: number
  heightMm: number
}

export const ONE_WIRE_PRESETS: Record<OneWirePreset, OneWirePresetConfig> = {
  lighting: { label: 'Lighting', breaker: '16A', load: 'LIGHT', switchLabel: 'SW', wireSection: '1.5 mm2' },
  sockets: { label: 'Sockets', breaker: '20A', load: 'SOCKETS', switchLabel: 'BR', wireSection: '2.5 mm2' },
  motor: { label: 'Motor', breaker: '20A', load: 'MOTOR', switchLabel: 'KM', wireSection: '2.5 mm2' }
}

export const PAPER_PRESETS: Record<PaperPreset, PaperPresetConfig> = {
  'a4-portrait': { label: 'A4 Portrait', widthMm: 210, heightMm: 297 },
  'a4-landscape': { label: 'A4 Landscape', widthMm: 297, heightMm: 210 },
  'a3-portrait': { label: 'A3 Portrait', widthMm: 297, heightMm: 420 },
  'a3-landscape': { label: 'A3 Landscape', widthMm: 420, heightMm: 297 }
}

export const nextOneWireBindingId = (currentBindingId: string, preset: OneWirePreset): string => {
  const match = /^([A-Z]+)(\d+)$/.exec(currentBindingId)
  if (!match) return 'A1'
  const currentLetters = match[1]
  const currentNumber = Number(match[2])
  if (preset !== 'sockets' || currentNumber < 8) return `${currentLetters}${currentNumber + 1}`

  const letters = currentLetters.split('')
  for (let index = letters.length - 1; index >= 0; index -= 1) {
    if (letters[index] !== 'Z') {
      letters[index] = String.fromCharCode(letters[index].charCodeAt(0) + 1)
      return `${letters.join('')}1`
    }
    letters[index] = 'A'
  }
  return `A${letters.join('')}1`
}
