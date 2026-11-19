import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSolarDatasheet, solarDatasheetRows, sanitizeSolarInstallation, validateSolarInstallation,
  type SolarInstallation } from '../src/editor/solar-installation.ts'
import { buildSolarInstallation, solarInstallationPlacement } from '../src/editor/layout/solar-installation-layout.ts'
import { oneWireLayoutBounds, oneWireSymbolConnectionAnchors } from '../src/editor/layout/onewire-connections.ts'
import { sanitizeShapes, cloneShapes } from '../src/editor/model/model.ts'
import type { LineShape, SymbolShape } from '../src/editor/model/types.ts'

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

test('rejects invalid quantities, unequal strings and implausible STC electrical values', () => {
  assert.equal(validateSolarInstallation(installation), null)
  for (const change of [{ panelCount: 0 }, { stringCount: 5 }, { panelCount: 1.5 }, { inverterPowerW: NaN }]) {
    assert.ok(validateSolarInstallation({ ...installation, ...change }))
  }
  assert.ok(validateSolarInstallation({ ...installation, panel: { ...installation.panel, vocV: 20 } }))
  assert.equal(sanitizeSolarInstallation({ ...installation, phases: 2 }), undefined)
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
  assert.deepEqual(sanitizeShapes(cloneShapes(shapes)).filter((shape): shape is SymbolShape =>
    shape.kind === 'symbol').map((symbol) => symbol.electrical?.solar), symbols.map(() => installation))
  const rail: LineShape = { id: 'rail', kind: 'line', start: { x: 200, y: 1000 }, end: { x: 800, y: 1000 } }
  const area = { x: 0, y: 0, width: 2400, height: 1600 }
  assert.equal(solarInstallationPlacement(shapes, [rail], rail, area), 0)
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
