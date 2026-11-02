import type { SymbolShape } from './model/types.js'
import { protectionAnnotationLayout, PROTECTION_FONT_FAMILY, PROTECTION_TEXT_SIZE, PROTECTION_TEXT_WEIGHT } from './layout/protection-label-layout.js'
import { rcdTypeLabel } from './model/electrical.js'
import { paperTextContentMarkup } from './layout/paper-text-layout.js'


export type SymbolTextFieldDefinition = {
  key: string
  legacyKeys?: string[]
  label: string
  defaultValue: string
  x: number
  y: number
  fontSize: number
  fontFamily?: string
  rotation?: number
}

export type SymbolMetadataDefinition = {
  textFields: SymbolTextFieldDefinition[]
}

const decodePath = (path: string): string => {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

const normalizePath = (path: string): string =>
  decodePath(path)
    .replace(/\\/g, '/')
    .replace(/^.*\/symbols\//i, 'symbols/')
    .toLowerCase()

const SYMBOL_METADATA: Record<string, SymbolMetadataDefinition> = {
  'symbols/consumption appliances/refrigerator.svg': {
    textFields: [
      { key: 'marker', legacyKeys: ['desc:*'], label: 'Marker', defaultValue: '*', x: 4.625, y: 16.4912, fontSize: 16, fontFamily: 'Times New Roman' }
    ]
  },
  'symbols/consumption appliances/freezer.svg': {
    textFields: [
      { key: 'marker', legacyKeys: ['desc:***'], label: 'Marker', defaultValue: '***', x: 1.125, y: 13.5717, fontSize: 10, fontFamily: 'Times New Roman' }
    ]
  },
  'symbols/consumption appliances/kwh meter.svg': {
    textFields: [
      { key: 'meter-label', legacyKeys: ['desc:Kwh'], label: 'Meter label', defaultValue: 'kWh', x: 3.18, y: 13.4675, fontSize: 6, fontFamily: 'Calibri' }
    ]
  },
  'symbols/consumption appliances/motor.svg': {
    textFields: [
      { key: 'device-label', legacyKeys: ['desc:M'], label: 'Device label', defaultValue: 'M', x: 2.235, y: 8.195, fontSize: 8, fontFamily: 'Times New Roman' }
    ]
  },
  'symbols/photovoltaic devices (≠arei)/inverter.svg': {
    textFields: [
      { key: 'dc-label', legacyKeys: ['desc:DC'], label: 'DC label', defaultValue: 'DC', x: 1.7923, y: 6.1733, fontSize: 6, fontFamily: 'Calibri' },
      { key: 'ac-label', legacyKeys: ['desc:AC'], label: 'AC label', defaultValue: 'AC', x: 8.945, y: 14.8674, fontSize: 6, fontFamily: 'Calibri' }
    ]
  },
  'symbols/photovoltaic devices (≠arei)/solar panel.svg': {
    textFields: [
      { key: 'panel-count', legacyKeys: ['desc:x16'], label: 'Panel count', defaultValue: 'x16', x: 5.1499, y: 10.0221, fontSize: 6, fontFamily: 'Calibri' }
    ]
  },
  'symbols/general/single phase alternating current.svg': {
    textFields: [
      { key: 'phase-count', legacyKeys: ['desc:1'], label: 'Phase count', defaultValue: '1', x: 1.17, y: 5.9087, fontSize: 5 }
    ]
  },
  'symbols/general/three phase alternating current.svg': {
    textFields: [
      { key: 'phase-count', legacyKeys: ['desc:3'], label: 'Phase count', defaultValue: '3', x: 1.17, y: 5.9087, fontSize: 5 }
    ]
  },
  'symbols/general/existing electrical installation.svg': {
    textFields: [
      { key: 'line-1', legacyKeys: ['desc:EXISTING ELECTRICAL'], label: 'Line 1', defaultValue: 'EXISTING ELECTRICAL', x: 6.955, y: 14.9877, fontSize: 5, fontFamily: 'Calibri' },
      { key: 'line-2', legacyKeys: ['desc:INSTALLATION'], label: 'Line 2', defaultValue: 'INSTALLATION', x: 13.995, y: 22.7855, fontSize: 5, fontFamily: 'Calibri' }
    ]
  },
  'symbols/switches/timer.svg': {
    textFields: [
      { key: 'timer-label', legacyKeys: ['desc:t'], label: 'Timer label', defaultValue: 't', x: 9.0322, y: 6.1685, fontSize: 6, fontFamily: 'Calibri' }
    ]
  },
  'symbols/switches/single pole delayed switch.svg': {
    textFields: [
      { key: 'timer-label', legacyKeys: ['desc:t'], label: 'Timer label', defaultValue: 't', x: 6.3958, y: 5.0899, fontSize: 4, fontFamily: 'Calibri' }
    ]
  },
  'symbols/wires/amount of cables.svg': {
    textFields: [
      { key: 'count', legacyKeys: ['desc:n'], label: 'Cable count', defaultValue: 'n', x: 5.3993, y: 23.6161, fontSize: 6, rotation: -90 }
    ]
  },
  'symbols/wires/amount of wires in a cable.svg': {
    textFields: [
      { key: 'count', legacyKeys: ['desc:n'], label: 'Wire count', defaultValue: 'n', x: 5.3993, y: 23.6161, fontSize: 6, rotation: -90 }
    ]
  },
  'symbols/protection devices/automaat.svg': {
    textFields: [
      { key: 'description', label: 'Benaming', defaultValue: '', x: 0, y: 0, fontSize: 0 },
      { key: 'poles', legacyKeys: ['desc:nP'], label: 'Poles', defaultValue: 'nP', x: 1.87, y: 16.3635, fontSize: 5 },
      { key: 'phase', legacyKeys: ['desc:n'], label: 'Phase', defaultValue: 'n', x: 8.8267, y: 27.01, fontSize: 6 },
      { key: 'rated-current', legacyKeys: ['desc:20A'], label: 'Rated current', defaultValue: '20A', x: 17.0135, y: 16.3801, fontSize: 6 }
    ]
  },
  'symbols/protection devices/residual-current circuit breaker.svg': {
    textFields: [
      { key: 'description', label: 'Benaming', defaultValue: '', x: 0, y: 0, fontSize: 0 },
      { key: 'poles', legacyKeys: ['desc:nP'], label: 'Poles', defaultValue: 'nP', x: 1.87, y: 17.4235, fontSize: 5 },
      { key: 'phase', legacyKeys: ['desc:n'], label: 'Phase', defaultValue: 'n', x: 8.8267, y: 28.07, fontSize: 6 },
      { key: 'rated-current', legacyKeys: ['desc:40A'], label: 'Rated current', defaultValue: '40A', x: 16.9427, y: 23.818, fontSize: 6 },
      { key: 'residual-current', legacyKeys: ['desc:300mA'], label: 'Residual current', defaultValue: '300mA', x: 16.9427, y: 16.8731, fontSize: 6 },
      { key: 'rcd-type', label: 'RCD type', defaultValue: rcdTypeLabel(), x: 16.9427, y: 31.2, fontSize: 5 },
      { key: 'device-type', legacyKeys: ['desc:I'], label: 'Device type', defaultValue: 'ΔI', x: 21.6198, y: 9.7762, fontSize: 12, fontFamily: 'Times New Roman' }
    ]
  },
  'symbols/protection devices/fuse.svg': {
    textFields: [
      { key: 'rated-current', legacyKeys: ['desc:20A'], label: 'Rated current', defaultValue: '20A', x: 0.69, y: 16.1016, fontSize: 6 }
    ]
  }
}

export const symbolMetadataFor = (path: string): SymbolMetadataDefinition | undefined =>
  SYMBOL_METADATA[normalizePath(path)]

export const registeredSymbolMetadataPaths = (): string[] => Object.keys(SYMBOL_METADATA)

export const symbolTextFieldsFor = (path: string): SymbolTextFieldDefinition[] =>
  symbolMetadataFor(path)?.textFields ?? []

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

export const symbolTextLayer = (path: string, overrides?: Record<string, string>): string =>
  symbolTextFieldsFor(path)
    .map((field) => {
      if (field.key === 'description') return ''
      const legacyValue = field.legacyKeys?.map((key) => overrides?.[key]).find((value) => typeof value === 'string')
      const value = overrides?.[field.key] ?? legacyValue ?? field.defaultValue
      if (!value) return ''
      const family = field.fontFamily ? `font-family:${escapeXml(field.fontFamily)};` : 'font-family:Arial;'
      const transform = field.rotation ? ` transform="rotate(${field.rotation} ${field.x} ${field.y})"` : ''
      return `<text x="${field.x}" y="${field.y}"${transform} style="fill:var(--symbol-fill,#000);${family}font-size:${field.fontSize}px">${escapeXml(value)}</text>`
    })
    .join('')

// All protection symbols share paper-sized annotations, independent of whether
// they were placed manually or generated. Blank overrides let circuit bundles
// supply their linked text shapes at the same shared positions.
export const symbolTextPresentation = (shape: SymbolShape): { inner: string; annotations: string } => {
  const protection = /protection devices\/(?:automaat|residual-current circuit breaker)\.svg$/i.test(shape.path)
  const layout = protection ? protectionAnnotationLayout(shape) : null
  const description = shape.symbolTextOverrides?.description
  const descriptionLayout = description ? layout?.description : null
  const descriptionText = description && descriptionLayout
    ? `<text class="onewire-device-description" x="${descriptionLayout.x}" y="${descriptionLayout.y}" font-family="${PROTECTION_FONT_FAMILY}" font-size="${PROTECTION_TEXT_SIZE}" font-weight="600" fill="#000000" stroke="none">${paperTextContentMarkup({ id: shape.id, kind: 'text', position: descriptionLayout,
      text: descriptionLayout.lines.join('\n'), scale: PROTECTION_TEXT_SIZE / 18 })}</text>` : ''
  if (!protection) {
    return { inner: symbolTextLayer(shape.path, shape.symbolTextOverrides), annotations: descriptionText }
  }
  if (!layout) {
    return { inner: symbolTextLayer(shape.path, shape.symbolTextOverrides), annotations: '' }
  }
  const residual = /residual-current circuit breaker\.svg$/i.test(shape.path)
  const keys = ['poles', 'phase', 'rated-current', 'residual-current', 'rcd-type', 'device-type']
  const values = new Map(symbolTextFieldsFor(shape.path).map((field) => [
    field.key,
    shape.symbolTextOverrides?.[field.key] ?? field.legacyKeys?.map((key) => shape.symbolTextOverrides?.[key])
      .find((value) => typeof value === 'string') ?? field.defaultValue
  ]))
  const inner = symbolTextLayer(shape.path, { ...shape.symbolTextOverrides, ...Object.fromEntries(keys.map((key) => [key, ''])) })
  const label = (key: string, point: { x: number; y: number }, anchor = 'start') => {
    const value = values.get(key)
    return value ? `<text class="onewire-technical-annotation" x="${point.x}" y="${point.y}" text-anchor="${anchor}" font-family="${PROTECTION_FONT_FAMILY}" font-size="${PROTECTION_TEXT_SIZE}" font-weight="${PROTECTION_TEXT_WEIGHT}" fill="#000000" stroke="none">${escapeXml(value)}</text>` : ''
  }
  // Spans flow using actual font metrics: long ratings and RCD types keep
  // their spacing without guessing a fixed width for either value.
  const row = (keys: string[], point: { x: number; y: number }) => {
    const fields = keys.filter((key) => values.get(key))
    if (!fields.length) return ''
    const spans = fields.map((key, index) => {
      const markerStyle = key === 'device-type' ? ` font-family="Times New Roman,serif" font-size="${PROTECTION_TEXT_SIZE * 1.2}"` : ''
      return `<tspan data-field="${key}"${index ? ' dx="8"' : ''}${markerStyle}>${escapeXml(values.get(key)!)}</tspan>`
    }).join('')
    return `<text class="onewire-technical-annotation" x="${point.x}" y="${point.y}" text-anchor="start" font-family="${PROTECTION_FONT_FAMILY}" font-size="${PROTECTION_TEXT_SIZE}" font-weight="${PROTECTION_TEXT_WEIGHT}" fill="#000000" stroke="none">${spans}</text>`
  }
  return {
    inner,
    annotations: [
      label('poles', layout.poles, 'end'),
      residual ? row(['device-type', 'residual-current'], layout.residual) : '',
      residual ? row(['rated-current', 'rcd-type'], layout.current) : label('rated-current', layout.current),
      label('phase', layout.phase),
      descriptionText
    ].join('')
  }
}
