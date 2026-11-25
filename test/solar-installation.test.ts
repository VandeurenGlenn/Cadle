import assert from 'node:assert/strict'
import test from 'node:test'
import { distributeSolarPanels, normalizeSolarDatasheetHeaderContrast, parseInverterDatasheet, parseSolarDatasheet, solarDatasheetRows, sanitizeSolarInstallation, validateSolarInstallation,
  type SolarInstallation } from '../src/editor/solar-installation.ts'
import { buildSolarInstallation, preserveSolarBreakerSettings, solarInstallationPlacement, updateSolarInstallationCable } from '../src/editor/layout/solar-installation-layout.ts'
import { expandSelectionWithGroup } from '../src/editor/interaction/pointer-select.ts'
import { bindingLabelsMarkup } from '../src/editor/svg-templates.ts'
import { oneWireLayoutBounds, oneWireSymbolConnectionAnchors } from '../src/editor/layout/onewire-connections.ts'
import { sanitizeShapes, cloneShapes } from '../src/editor/model/model.ts'
import type { LineShape, SymbolShape } from '../src/editor/model/types.ts'
import { shouldOcrSolarDatasheetPage } from '../src/editor/solar-datasheet-import.ts'

const datasheet = `SPECIFICATION (STC)
MODEL TYPE ODA450-24V-MHDBRz ODA455-24V-MHDBRz ODA460-24V-MHDBRz ODA465-24V-MHDBRz ODA470-24V-MHDBRz
Rated Peak Power-Pmax(Wp)* 450.00 455.00 460.00 465.00 470.00
Maximum Power Voltage-Vmp(V) 29.38 29.43 29.47 29.51 29.55
Maximum Power Current-Imp(A) 15.31 15.46 15.60 15.76 15.91
Open Circuit Voltage-Voc(V)* 34.57 34.62 34.67 34.72 34.77
Short Circuit Current-Isc(A)* 16.27 16.43 16.58 16.74 16.90
ELECTRICAL DATA(BNPI)
Rated Peak Power-Pmax(Wp)* 499.00 504.00 510.00 515.00 521.00
Maximum Power Voltage-Vmp(V) 29.47 29.52 29.56 29.60 29.64`

test('reads all five STC variants, keeps their columns aligned and ignores BNPI power', () => {
  const result = parseSolarDatasheet(datasheet)
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.panels.map((panel) => panel.powerWp), [450, 455, 460, 465, 470])
  assert.deepEqual(result.panels[4], {
    model: 'ODA470-24V-MHDBRz', powerWp: 470, vmpV: 29.55, impA: 15.91, vocV: 34.77, iscA: 16.9
  })
  const incomplete = parseSolarDatasheet(datasheet.replace('29.47 ', ''))
  assert.ok(incomplete.panels.every((panel) => panel.vmpV === undefined))
  assert.ok(incomplete.warnings.some((warning) => warning.includes('Vmp')))
})

test('reconstructs OCR columns spatially and accepts decimal commas without inventing unknown values', () => {
  const rows = solarDatasheetRows([
    { text: '470,00', x: 400, y: 80, fontSize: 12 },
    { text: 'MODEL TYPE ODA450-24V ODA470-24V', x: 0, y: 40, fontSize: 12 },
    { text: 'Rated Peak Power-Pmax(Wp)', x: 0, y: 81, fontSize: 12 },
    { text: '450,00', x: 300, y: 79, fontSize: 12 }
  ])
  const result = parseSolarDatasheet(rows)
  assert.deepEqual(result.panels.map((panel) => panel.powerWp), [450, 470])
  assert.equal(result.panels[0].vocV, undefined)
  assert.ok(result.warnings.some((warning) => warning.includes('Voc')))
  assert.equal(parseSolarDatasheet('unreadable image').panels.length, 0)
})

test('does not create panel variants from unrelated STC values and groups slightly misaligned PDF text', () => {
  const unrelated = parseSolarDatasheet(`SPECIFICATION (STC)
Maximum Power Voltage-Vmp(V) 29.38 29.43 29.47 29.51 29.55
Maximum Power Current-Imp(A) 15.31 15.46 15.60 15.76 15.91`)
  assert.equal(unrelated.panels.length, 0)

  const rows = solarDatasheetRows([
    { text: 'MODEL TYPE TEST450', x: 0, y: 40, fontSize: 12 },
    { text: 'Rated Peak Power-Pmax(Wp)', x: 0, y: 80, fontSize: 12 },
    { text: '450.00', x: 300, y: 86, fontSize: 12 }
  ])
  assert.deepEqual(parseSolarDatasheet(rows).panels.map(({ model, powerWp }) => ({ model, powerWp })),
    [{ model: 'TEST450', powerWp: 450 }])
})

test('limits blind PDF OCR on long documents and OCRs pages whose extracted text contains solar fields', () => {
  const irrelevant = 'This is a product brochure page with selectable text and no electrical specification.'
  assert.equal(shouldOcrSolarDatasheetPage(irrelevant, 100), false)
  assert.equal(shouldOcrSolarDatasheetPage('Rated Peak Power-Pmax(Wp)', 100), true)
  assert.equal(shouldOcrSolarDatasheetPage('1', 10), true)
  assert.equal(shouldOcrSolarDatasheetPage('1', 11), false)
})

test('makes light-on-grey header text readable without changing white margins or ordinary body text', () => {
  const header = [255, 170, 170, 255, 170, 170, 255]
  const darkHeader = [255, 170, 170, 0, 170, 170, 255]
  const body = [255, 255, 0, 255, 255, 0, 255]
  const data = new Uint8ClampedArray([...header, ...darkHeader, ...body].flatMap((value) => [value, value, value, 255]))
  normalizeSolarDatasheetHeaderContrast({ width: header.length, height: 3, data })
  assert.deepEqual(Array.from(data), [255, 255, 255, 0, 255, 255, 255, 255, 255, 255, 0, 255, 255, 255, ...body]
    .flatMap((value) => [value, value, value, 255]))
})

test('flags missing OCR decimal points and an outlier model instead of accepting corrupted specifications', () => {
  const result = parseSolarDatasheet(datasheet.replace('29.38', '2938').replace('34.62', '3462')
    .replace('ODA470-24V', 'ODAA70-24V'))
  assert.equal(result.panels[0].vmpV, undefined)
  assert.equal(result.panels[1].vocV, undefined)
  assert.equal(result.panels[4].model, '')
  assert.equal(result.panels[4].vmpV, 29.55)
  assert.equal(result.panels[4].powerWp, 470)
  assert.ok(result.warnings.some((warning) => warning.includes('decimaalteken')))
  assert.ok(result.warnings.some((warning) => warning.includes('typenummer')))
})

const installation: SolarInstallation = {
  panel: { manufacturer: 'OSDA', model: 'ODA470-24V-MHDBRz', powerWp: 470,
    vmpV: 29.55, impA: 15.91, vocV: 34.77, iscA: 16.9 },
  panelCount: 12, stringCount: 2, inverterManufacturer: 'Test', inverterModel: 'INV-5000',
  inverterPowerW: 5000, phases: 1, breakerCurrentA: 25
}

const inverterSheet = `SUN2000-12/15/17/20/25K-MB0
Technical Specification SUN2000-12K- SUN2000-15K- SUN2000-17K- SUN2000-20K- SUN2000-25K-
MB0 MB0 MB0 MB0 MB0
Efficiency
Max. efficiency 98.4% 98.4% 98.4% 98.4% 98.4%
DC Input
Recommended max. PV power 18,000 Wp 22,500 Wp 25,500 Wp 30,000 Wp 37,500 Wp
Max. input voltage 1,100 V
Number of MPPT trackers 2
Output
Rated output power 12,000 W 15,000 W 17,000 W 20,000 W 25,000 W
Max. apparent power 13,200 VA 16,500 VA 18,700 VA 22,000 VA 27,500 VA
Rated output voltage 220 V AC/380 V AC, 230 V AC/400 V AC, 240 V AC/415 V AC; 3 W/N + PE`

test('reads separate inverter variants from AC output, joins wrapped model codes and ignores PV and apparent power', () => {
  const parsed = parseInverterDatasheet(inverterSheet)
  assert.deepEqual(parsed.warnings, [])
  assert.deepEqual(parsed.inverters.map((inverter) => inverter.inverterModel),
    ['SUN2000-12K-MB0', 'SUN2000-15K-MB0', 'SUN2000-17K-MB0', 'SUN2000-20K-MB0', 'SUN2000-25K-MB0'])
  assert.deepEqual(parsed.inverters.map((inverter) => inverter.inverterPowerW), [12000, 15000, 17000, 20000, 25000])
  assert.ok(parsed.inverters.every((inverter) => inverter.maxDcVoltageV === 1100 && inverter.mpptCount === 2 && inverter.phases === 3))
  const incomplete = parseInverterDatasheet(inverterSheet.replace('17,000 W ', ''))
  assert.ok(incomplete.inverters.every((inverter) => inverter.inverterPowerW === undefined))
  assert.ok(incomplete.warnings.some((warning) => warning.includes('AC-uitgangsvermogen')))
  const decimal = parseInverterDatasheet('Manufacturer: Other-Brand\nModel INV-5000\nRated output power (kW) 5,000')
  assert.equal(decimal.inverters[0].inverterPowerW, 5000)
  assert.equal(decimal.inverters[0].inverterManufacturer, 'Other-Brand')
  assert.equal(parseInverterDatasheet('Model SG8.0RS\nRated output power 8000 W').inverters[0].inverterModel, 'SG8.0RS')
  assert.equal(parseInverterDatasheet('Unreadable image').inverters.length, 0)
})

test('keeps real OCR header columns aligned and flags ambiguous model characters without guessing replacements', () => {
  const result = parseInverterDatasheet(`SUN2000-12/15/17/20/25K-MBO
Technical Specification
SUN2000-12K- SUN2000-15K- SUN2000-17K- SUN2000-20K- SUN2000-25K
Technical Specification
MBO MBO MBO MBO MBO
DC Input
Max input voltage 1,100 V
Number of MPP trackers 2
Output
Rated output power 12.000 W | 15,000 W 17,000 W | 20,000 w | 25000 W
Rated output voltage 230 V AC/400 V AC, 3 W/N + PE`)
  assert.deepEqual(result.inverters.map((inverter) => inverter.inverterModel),
    ['SUN2000-12K-MBO', 'SUN2000-15K-MBO', 'SUN2000-17K-MBO', 'SUN2000-20K-MBO', 'SUN2000-25K-MBO'])
  assert.deepEqual(result.inverters.map((inverter) => inverter.inverterPowerW), [12000, 15000, 17000, 20000, 25000])
  assert.ok(result.inverters.every((inverter) => inverter.maxDcVoltageV === 1100 && inverter.mpptCount === 2 && inverter.phases === 3))
  assert.equal(result.warnings.filter((warning) => warning.includes('letter O versus cijfer 0')).length, 5)
})

test('validates and serializes independent equipment without requiring or fabricating its counterpart', () => {
  const panels: SolarInstallation = { kind: 'panels', panel: installation.panel, panelCount: 12, stringCount: 2 }
  const inverter: SolarInstallation = { kind: 'inverter', inverterManufacturer: 'Other brand', inverterModel: 'INV-5000',
    inverterPowerW: 5000, phases: 1, breakerCurrentA: 25, maxDcVoltageV: 600, mpptCount: 2 }
  for (const value of [panels, inverter]) {
    assert.equal(validateSolarInstallation(value), null)
    assert.deepEqual(sanitizeSolarInstallation(value), value)
    let id = 0
    const shapes = buildSolarInstallation(value, value.kind === 'panels' ? undefined : 'rail', { x: 300, y: 800 }, () => `part-${++id}`)
    const symbols = shapes.filter((shape) => shape.kind === 'symbol')
    assert.equal(symbols.length, value.kind === 'panels' ? 1 : 2)
    assert.deepEqual(sanitizeShapes(cloneShapes(shapes)).filter((shape) => shape.kind === 'symbol')
      .map((shape) => shape.electrical?.solar), symbols.map(() => value))
    if (value.kind === 'panels') {
      assert.ok(shapes.every((shape) => shape.kind !== 'line' && !shape.oneWireRailId))
      assert.equal(solarInstallationPlacement(shapes, [], undefined, { x: 0, y: 0, width: 2400, height: 1600 }), 0)
    } else assert.ok(symbols.every((shape) => shape.name !== 'Zonnepanelen'))
  }
  assert.equal(sanitizeSolarInstallation({ ...inverter, mpptCount: 1.5 }), undefined)
  assert.equal(sanitizeSolarInstallation({ ...panels, stringCount: 5 }), undefined)
  assert.equal(sanitizeSolarInstallation({ kind: 'unknown' }), undefined)
})

test('rejects invalid quantities, missing string distributions and implausible STC electrical values', () => {
  assert.equal(validateSolarInstallation(installation), null)
  for (const change of [{ panelCount: 0 }, { stringCount: 5 }, { panelCount: 1.5 }, { inverterPowerW: NaN }]) {
    assert.ok(validateSolarInstallation({ ...installation, ...change }))
  }
  assert.ok(validateSolarInstallation({ ...installation, panel: { ...installation.panel, vocV: 20 } }))
  assert.equal(sanitizeSolarInstallation({ ...installation, phases: 2 }), undefined)
})

test('supports 23 panels in strings of 11 and 12 through schema sanitization and schematic labels', () => {
  const value = { ...installation, panelCount: 23, panelsPerString: [11, 12] }
  assert.deepEqual(distributeSolarPanels(23, 2), [11, 12])
  assert.equal(validateSolarInstallation(value), null)
  const sanitized = sanitizeSolarInstallation(value)
  assert.deepEqual(sanitized, value)
  assert.notEqual(sanitized?.kind !== 'inverter' && sanitized?.panelsPerString, value.panelsPerString)
  let id = 0
  const shapes = buildSolarInstallation(value, 'rail', { x: 300, y: 1200 }, () => `unequal-${++id}`)
  const restored = sanitizeShapes(cloneShapes(shapes))
  assert.ok(restored.filter((shape) => shape.kind === 'symbol').every((shape) =>
    shape.electrical?.solar?.kind !== 'inverter' && shape.electrical?.solar?.panelsPerString?.join(',') === '11,12'))
  const labels = restored.filter((shape) => shape.kind === 'text').map((shape) => shape.text).join('\n')
  assert.match(labels, /String 1: 11 panelen\nString 2: 12 panelen/)
  assert.match(labels, /23 x 470 Wp = 10.81 kWp/)
  assert.doesNotMatch(labels, /11\.5 panelen/)
})

test('rejects missing, mismatched and malformed per-string panel quantities without replacing them with defaults', () => {
  for (const counts of [[], [23], [11, 11], [0, 23], [-1, 24], [11.5, 11.5], [NaN, 12], ['11', 12], null]) {
    assert.equal(sanitizeSolarInstallation({ ...installation, panelCount: 23, panelsPerString: counts }), undefined)
  }
  assert.equal(sanitizeSolarInstallation({ ...installation, panelCount: 23 }), undefined)
  assert.deepEqual(distributeSolarPanels(12, 3), [4, 4, 4])
  assert.deepEqual(distributeSolarPanels(2, 3), [])
  assert.deepEqual(distributeSolarPanels(10001, 2), [])
})

test('connects actual PV terminals, annotates STC quantities and preserves equipment through serialization', () => {
  let id = 0
  const shapes = buildSolarInstallation(installation, 'rail', { x: 300, y: 1000 }, () => `pv-${++id}`)
  const symbols = shapes.filter((shape): shape is SymbolShape => shape.kind === 'symbol')
  assert.equal(symbols.length, 3)
  const lines = shapes.filter((shape): shape is LineShape => shape.kind === 'line')
  for (const symbol of symbols) {
    const incoming = oneWireSymbolConnectionAnchors(symbol).find((anchor) => anchor.side === 'bottom')!.point
    assert.ok(lines.some((line) => Math.hypot(line.end.x - incoming.x, line.end.y - incoming.y) < 1e-8))
  }
  const labels = shapes.filter((shape) => shape.kind === 'text').map((shape) => shape.text).join('\n')
  assert.match(labels, /12 x 470 Wp = 5.64 kWp/)
  assert.match(labels, /2 string\(s\) van 6 panelen/)
  assert.match(labels, /Voc 34.77 V/)
  assert.match(labels, /INV-5000/)
  assert.match(labels, /nog op te geven/)
  assert.doesNotMatch(labels, /PV-kabel AC:|^PV$/m)
  const breaker = shapes.find((shape): shape is SymbolShape => shape.kind === 'symbol' && shape.name === 'PV automaat')!
  const configured = updateSolarInstallationCable(shapes, {
    ...breaker,
    electrical: { ...breaker.electrical!, cableSectionMm2: 6, cableConductors: 3, cableType: 'XVB' }
  })
  const cable = configured.find((shape) => shape.sourceLink?.role === 'solar-ac-cable')
  const cableLabel = configured.find((shape) => shape.sourceLink?.role === 'solar-ac-cable-label')
  assert.equal(cable?.kind === 'line' ? cable.connection?.sectionMm2 : undefined, 6)
  assert.equal(cableLabel?.kind === 'text' ? cableLabel.text : undefined, '3G6 mm² XVB')
  const restored = sanitizeShapes(cloneShapes(configured))
  const restoredCable = restored.find((shape) => shape.sourceLink?.role === 'solar-ac-cable')
  assert.equal(restoredCable?.kind === 'line' ? restoredCable.connection?.labelOwner : undefined, 'solar-installation')
  assert.deepEqual(sanitizeShapes(cloneShapes(shapes)).filter((shape): shape is SymbolShape =>
    shape.kind === 'symbol').map((symbol) => symbol.electrical?.solar), symbols.map(() => installation))
  const rail: LineShape = { id: 'rail', kind: 'line', start: { x: 200, y: 1000 }, end: { x: 800, y: 1000 } }
  const area = { x: 0, y: 0, width: 2400, height: 1600 }
  assert.equal(solarInstallationPlacement(shapes, [rail], rail, area), 0)
  assert.equal(solarInstallationPlacement(shapes, [rail], rail, area, 1000), 700)
  const before = structuredClone(shapes)
  const dx = solarInstallationPlacement(shapes, [rail, ...shapes], rail, area)
  assert.ok(dx !== undefined && dx > 0)
  assert.deepEqual(shapes, before)
  assert.equal(solarInstallationPlacement(shapes, [], rail, { ...area, height: 350 }), undefined)
  assert.ok(shapes.every((shape) => {
    const box = oneWireLayoutBounds(shape)
    return box.x >= 0 && box.y + box.height < 1600
  }))
})

test('defaults a 32 A PV breaker to 3G4 and lets its cable settings override that default', () => {
  let id = 0
  const shapes = buildSolarInstallation({ ...installation, breakerCurrentA: 32 }, 'rail',
    { x: 300, y: 800 }, () => `pv32-${++id}`)
  const breaker = shapes.find((shape): shape is SymbolShape => shape.kind === 'symbol' && shape.name === 'PV automaat')!
  const cableLabel = shapes.find((shape) => shape.sourceLink?.role === 'solar-ac-cable-label')
  assert.equal(breaker.electrical?.cableSectionMm2, 4)
  assert.equal(breaker.electrical?.cableConductors, 3)
  assert.equal(cableLabel?.kind === 'text' ? cableLabel.text : undefined, '3G4 mm²')

  const adjusted = updateSolarInstallationCable(shapes, {
    ...breaker,
    electrical: { ...breaker.electrical!, cableSectionMm2: 6, cableConductors: 3 }
  })
  const adjustedLabel = adjusted.find((shape) => shape.sourceLink?.role === 'solar-ac-cable-label')
  assert.equal(adjustedLabel?.kind === 'text' ? adjustedLabel.text : undefined, '3G6 mm²')
})

test('selects the PV breaker independently and preserves its circuit and cable settings after editing', () => {
  let id = 0
  const shapes = buildSolarInstallation({ ...installation, breakerCurrentA: 32 }, 'rail',
    { x: 300, y: 1200 }, () => `old-${++id}`)
  const breaker = shapes.find((shape): shape is SymbolShape => shape.kind === 'symbol' && shape.name === 'PV automaat')!
  const panel = shapes.find((shape): shape is SymbolShape => shape.kind === 'symbol' && shape.name === 'Zonnepanelen')!
  assert.deepEqual([...expandSelectionWithGroup(shapes, breaker.id)], [breaker.id])
  assert.equal(panel.scale, 2.4)
  assert.ok(shapes.filter((shape) => shape.kind === 'text').every((shape) => shape.fontWeight === 400))
  const previous = { ...breaker, bindingId: 'A', electrical: { ...breaker.electrical!, cableSectionMm2: 6,
    cableConductors: 5, cableType: 'XVB' as const, breakerCurve: 'B' as const } }
  const refreshed = preserveSolarBreakerSettings(buildSolarInstallation(
    { ...installation, breakerCurrentA: 32 }, 'rail', { x: 300, y: 1200 }, () => `new-${++id}`), previous)
  const restored = refreshed.find((shape): shape is SymbolShape => shape.kind === 'symbol' && shape.name === 'PV automaat')!
  const label = refreshed.find((shape) => shape.kind === 'text' && shape.sourceLink?.role === 'solar-ac-cable-label')
  assert.equal(restored.bindingId, 'A')
  assert.equal(restored.electrical?.cableSectionMm2, 6)
  assert.equal(restored.symbolTextOverrides?.['rated-current'], 'B32A')
  assert.equal(label?.kind === 'text' ? label.text : undefined, '5G6 mm² XVB')
  assert.equal(label?.kind === 'text' ? label.rotation : undefined, -90)
})

test('places the PV circuit label at the rail tap like other breaker labels', () => {
  const rail: LineShape = { id: 'rail', kind: 'line', start: { x: 100, y: 800 }, end: { x: 700, y: 800 },
    strokeWidth: 4, groupId: 'onewire-kamrail-test' }
  for (const direction of ['top', 'bottom'] as const) {
    let id = 0
    const shapes = buildSolarInstallation(installation, rail.id, { x: 300, y: 800 }, () => `pv-${++id}`, direction)
    const breaker = shapes.find((shape): shape is SymbolShape => shape.kind === 'symbol' && shape.name === 'PV automaat')!
    const bound = shapes.map((shape) => shape.id === breaker.id ? { ...breaker, bindingId: 'A' } : shape)
    const heading: TextShape = { id: 'other-heading', kind: 'text', position: { x: 500, y: 824 }, text: 'A',
      bindingId: 'A', sourceLink: { kind: 'circuit', id: 'A', role: 'label' } }
    const markup = bindingLabelsMarkup([rail, heading, ...bound])
    assert.match(markup, new RegExp(`data-shape-id="${breaker.id}"`))
    assert.match(markup, new RegExp(`x="300" y="${direction === 'top' ? 824 : 788}"`))
    assert.match(markup, /font-size:22px;font-weight:500/)
    assert.doesNotMatch(bindingLabelsMarkup([rail, ...shapes]), /data-shape-id=/)
    assert.match(bindingLabelsMarkup(bound), />A<\/text>/)
  }
})

test('keeps readable annotations clear of every device above and below a kamrail', () => {
  for (const direction of ['top', 'bottom'] as const) {
    let id = 0
    const shapes = buildSolarInstallation(installation, 'rail', { x: 300, y: 800 }, () => `pv-${++id}`, direction)
    const symbols = shapes.filter((shape): shape is SymbolShape => shape.kind === 'symbol')
    const lines = shapes.filter((shape): shape is LineShape => shape.kind === 'line')
    for (const symbol of symbols) {
      const incoming = oneWireSymbolConnectionAnchors(symbol).find((anchor) => anchor.side === (direction === 'top' ? 'bottom' : 'top'))!.point
      assert.ok(lines.some((line) => Math.hypot(line.end.x - incoming.x, line.end.y - incoming.y) < 1e-8))
    }
    for (const label of shapes.filter((shape) => shape.kind === 'text')) {
      const box = oneWireLayoutBounds(label)
      assert.ok(symbols.every((symbol) => {
        const body = oneWireLayoutBounds(symbol)
        return box.x + box.width <= body.x || box.x >= body.x + body.width ||
          box.y + box.height <= body.y || box.y >= body.y + body.height
      }), label.text)
    }
  }
})
