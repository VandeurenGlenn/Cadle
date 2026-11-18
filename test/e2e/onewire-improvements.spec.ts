import { expect, test } from '@playwright/test'
import { ONE_WIRE_LAYOUT_VERSION } from '../../src/editor/layout/onewire-layout-plan.ts'
import { buildKamrailCircuitBundle } from '../../src/editor/layout/onewire-helpers.ts'
import { oneWireSymbolBounds, oneWireSymbolScaleFor } from '../../src/editor/layout/onewire-symbol-nodes.ts'
import type { LineShape } from '../../src/editor/model/types.ts'

test('keeps wires attached while moving and undoing, and makes room for long saved names', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const topology = page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000103"]')
  await topology.click()
  const app = page.locator('cadle-app:not([read-only])')
  await expect.poll(() => app.evaluate((element: any) =>
    element.waitForPageReady('00000000-0000-4000-8000-000000000103'))).toBe(true)
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  const breaker = app.locator('g.shape-symbol').filter({ has: page.locator('svg[viewBox="0 0 28.783 28.8265"]') })
  const id = (await breaker.getAttribute('data-shape-id'))!
  const snapshot = () => app.evaluate((element: HTMLElement, id) => {
    const root = element.shadowRoot!
    const group = root.querySelector(`g.shape-symbol[data-shape-id="${id}"]`)!
    const svg = group.querySelector('svg')!
    const world = root.querySelector<SVGGElement>('.world')!
    const matrix = svg.getScreenCTM()!, inverse = world.getScreenCTM()!.inverse()
    const port = (y: number) => {
      const point = new DOMPoint(15.3836, y).matrixTransform(matrix).matrixTransform(inverse)
      return { x: point.x, y: point.y }
    }
    const wires = [...root.querySelectorAll<SVGGeometryElement>('.connection-conductor')]
      .map((node) => {
        const start = node.getPointAtLength(0), end = node.getPointAtLength(node.getTotalLength())
        return { id: node.getAttribute('data-shape-id'), start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } }
      })

    return { top: port(0.12), bottom: port(28.47), wires }
  }, id)
  const initial = await snapshot()
  const attached = initial.wires.flatMap((wire) => (['start', 'end'] as const).flatMap((endpoint) =>
    (['top', 'bottom'] as const).filter((port) => Math.hypot(wire[endpoint].x - initial[port].x, wire[endpoint].y - initial[port].y) < 0.01)
      .map((port) => ({ id: wire.id, endpoint, port }))))
  expect(attached).toHaveLength(2)
  const connected = async () => {
    const current = await snapshot()
    for (const attachment of attached) {
      const wire = current.wires.find((wire) => wire.id === attachment.id)!
      expect(wire[attachment.endpoint].x).toBeCloseTo(current[attachment.port].x, 3)
      expect(wire[attachment.endpoint].y).toBeCloseTo(current[attachment.port].y, 3)
      const other = attachment.endpoint === 'start' ? 'end' : 'start'
      const original = initial.wires.find((wire) => wire.id === attachment.id)!
      expect(wire[other].x).toBeCloseTo(original[other].x, 3)
      expect(wire[other].y).toBeCloseTo(original[other].y, 3)
    }
    return current
  }
  const point = await breaker.locator('path').first().evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(2).matrixTransform(path.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 45, point.y + 25, { steps: 4 })
  await page.mouse.up()
  const moved = await connected()
  await expect(app.locator('path.connection-conductor')).not.toHaveCount(0)
  expect(moved.top.x).not.toBeCloseTo(initial.top.x)
  await page.keyboard.press('ArrowRight')
  const nudged = await connected()
  expect(nudged.top.x).toBeGreaterThan(moved.top.x)
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  const restored = await connected()
  expect(restored.top.x).toBeCloseTo(initial.top.x, 3)
  expect(restored.top.y).toBeCloseTo(initial.top.y, 3)

  const rcd = app.locator('g.shape-symbol').filter({ hasText: 'Hoofddiff.' })
  const rcdPoint = await rcd.locator('path').first().evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(2).matrixTransform(path.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(rcdPoint.x, rcdPoint.y)
  const name = 'Algemene differentieel voor de woning en de garage'
  await page.locator('object-pane').getByRole('textbox', { name: 'Benaming', exact: true }).fill(name)
  const description = app.locator('.onewire-device-description').filter({ hasText: name })
  await expect(description.locator('tspan')).toHaveCount(3)
  const cable = app.locator('g.shape-connection[data-connection-kind="cable"] .connection-conductor')
  const cablePoint = await cable.evaluate((line: SVGLineElement) => {
    const point = new DOMPoint(Number(line.getAttribute('x1')), (Number(line.getAttribute('y1')) + Number(line.getAttribute('y2'))) / 2)
      .matrixTransform(line.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(cablePoint.x, cablePoint.y)
  const caption = 'Voedingskabel van de meter naar het hoofdverdeelbord'
  await page.locator('object-pane').getByLabel('Benaming verbinding').fill(caption)
  const text = app.locator('text.shape-text').filter({ hasText: caption })
  await expect(text.locator('tspan')).toHaveCount(3)
  const gap = await app.evaluate((element: HTMLElement) => {
    const root = element.shadowRoot!
    const caption = [...root.querySelectorAll('text.shape-text')].find((node) => node.textContent?.includes('Voedingskabel'))!
    const meter = root.querySelector('g.shape-symbol svg[viewBox="0 0 17.5861 17.2479"]')!
    return meter.getBoundingClientRect().top - caption.getBoundingClientRect().bottom
  })
  expect(gap).toBeGreaterThan(5)
  const same = await app.evaluate((element: any) => {
    const exported = new DOMParser().parseFromString(element.toSVG(), 'image/svg+xml')
    return [...element.shadowRoot.querySelectorAll('.onewire-device-description, text.shape-text')]
      .filter((node: Element) => node.querySelector('tspan'))
      .every((node: Element) => {
        const id = node.closest('[data-shape-id]')!.getAttribute('data-shape-id')!
        const shape = exported.querySelector(`[data-shape-id="${id}"]`)!
        const target = node.classList.contains('onewire-device-description') ? shape.querySelector('.onewire-device-description')! : shape
        return [...node.querySelectorAll('tspan')].map((span) => span.textContent).join('|') ===
          [...target.querySelectorAll('tspan')].map((span) => span.textContent).join('|')
      })
  })
  expect(same).toBe(true)
  await page.screenshot({ path: '/private/tmp/cadle-improvements-long-labels.png' })
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000104"]').click()
  await topology.click()
  await expect(description).toHaveText(name)
  await expect(text).toHaveText(caption)
})

test('includes schematic-only circuits in the overview and saves explicit open-plan room assignments', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell')
  const app = page.locator('cadle-app:not([read-only])')
  const ground = '00000000-0000-4000-8000-000000000102'
  const schematic = '00000000-0000-4000-8000-000000000104'
  await expect.poll(() => app.evaluate((element: any, key) => element.waitForPageReady(key), ground)).toBe(true)
  const importShapes = async (shapes: object[]) => app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'open-plan-circuits.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION,
      shapes, selectedId: null, paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680 }))
  })

  await importShapes(['kitchen', 'living'].map((name, index) => ({
    id: `open-${name}`, kind: 'symbol', position: { x: 800 + index * 250, y: 600 }, scale: 1.5,
    name: 'Lighting', path: 'symbols/Consumption appliances/Lighting.svg', bindingId: `E${index + 1}`,
    ...(index ? { roomName: 'Woonkamer' } : {}),
    electrical: { role: 'load', oneWireEligible: true, circuitType: 'lighting' }
  })))
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  const kitchen = app.locator('g.shape-symbol[data-shape-id="open-kitchen"]')
  const bounds = await kitchen.boundingBox()
  if (!bounds) throw new Error('The open-plan kitchen device is not visible.')
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  const roomName = page.locator('object-pane').getByRole('textbox', { name: 'Room name', exact: true })
  await expect(roomName).toBeVisible()
  await roomName.fill('Keuken')
  const roomAssignments = () => app.evaluate((element: any) =>
    element.analyzeBindings().groups.flatMap((group: any) => group.components)
      .filter((component: any) => component.shapeId.startsWith('open-'))
      .map((component: any) => ({ id: component.shapeId, room: component.roomName })))
  await expect.poll(roomAssignments).toEqual([
    { id: 'open-kitchen', room: 'Keuken' }, { id: 'open-living', room: 'Woonkamer' }
  ])
  await page.locator('app-shell #object-inspector').getByRole('button', { name: 'Close properties' }).click()
  await app.locator('g.shape-symbol[data-shape-id="open-living"]').click({ modifiers: ['ControlOrMeta'] })
  await expect.poll(() => shell.evaluate((element: any) => element.selectedObjectCount)).toBe(2)
  await roomName.fill('Leefruimte')
  await expect.poll(roomAssignments).toEqual([
    { id: 'open-kitchen', room: 'Leefruimte' }, { id: 'open-living', room: 'Leefruimte' }
  ])
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, schematic)
  await expect.poll(() => app.evaluate((element: any, key) => element.waitForPageReady(key), schematic)).toBe(true)
  await importShapes(['A', 'B', 'C', 'D', 'E'].map((family, index) => ({
    id: `schematic-${family}`, kind: 'symbol', position: { x: 600 + index * 200, y: 900 }, scale: 3,
    name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg', bindingId: family,
    generationKey: `board:${family}:breaker`, groupId: `onewire-${family}`,
    sourceLink: { kind: 'board', id: family, role: 'breaker' },
    electrical: { role: 'protection', oneWireEligible: true, breakerCurrentA: 32, poles: 4 }
  })))
  await expect.poll(() => app.evaluate((element: any) => element.getCircuitScheduleEditorItems()
    .filter((item: any) => /^[A-E]$/.test(item.id)).map((item: any) => item.id))).toEqual(['A', 'B', 'C', 'D', 'E'])
  expect(await app.evaluate((element: any) => element.analyzeBindings().families)).toEqual(['E'])
  await shell.evaluate(async (element: any) => { await element.openCircuitScheduleDialog() })
  const overview = page.locator('circuit-schedule-field')
  await expect(overview).toBeVisible()
  for (const family of ['A', 'B', 'C', 'D', 'E']) {
    await expect(overview.locator('.circuit-id').filter({ hasText: new RegExp(`^${family}$`) })).toHaveCount(1)
  }
  await page.screenshot({ path: '/private/tmp/cadle-circuit-schedule-zones.png' })
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, ground)
  await expect.poll(() => app.evaluate((element: any, key) => element.waitForPageReady(key), ground)).toBe(true)
  await expect.poll(roomAssignments).toEqual([
    { id: 'open-kitchen', room: 'Leefruimte' }, { id: 'open-living', room: 'Leefruimte' }
  ])
  await expect.poll(() => app.evaluate((element: any) => element.getCircuitScheduleEditorItems()
    .filter((item: any) => /^[A-E]$/.test(item.id)).map((item: any) => item.id))).toEqual(['A', 'B', 'C', 'D', 'E'])
})

test('keeps all 55 circuits reachable and editable in the overview', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell')
  const app = page.locator('cadle-app:not([read-only])')
  const schematic = '00000000-0000-4000-8000-000000000104'
  await expect.poll(() => app.evaluate((element: any) =>
    element.waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, schematic)
  await expect.poll(() => app.evaluate((element: any, key) => element.waitForPageReady(key), schematic)).toBe(true)
  const families = Array.from({ length: 55 }, (_, index) =>
    index < 26 ? String.fromCharCode(65 + index) : `${String.fromCharCode(64 + Math.floor(index / 26))}${String.fromCharCode(65 + index % 26)}`)
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: '55-circuits.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION,
      shapes: families.map((family) => ({ id: `overview-${family}`, kind: 'symbol', position: { x: 700, y: 900 },
        scale: 3, name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg', bindingId: family,
        electrical: { role: 'protection', oneWireEligible: true } })),
      selectedId: null, paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680 }))
  })
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await shell.evaluate(async (element: any) => { await element.openCircuitScheduleDialog() })
  const overview = page.locator('circuit-schedule-field')
  await expect(overview.locator('.device[data-kind="circuit"] .circuit-id').filter({ hasText: /^[A-Z]{1,2}$/ })).toHaveCount(55)
  const last = overview.getByLabel('Vrije modules voor BC', { exact: true })
  await overview.locator('main').evaluate((element) => { element.scrollTop = element.scrollHeight })
  await expect(last).toBeInViewport()
  await last.fill('3')
  await last.press('Tab')
  await expect.poll(() => shell.evaluate((element: any) =>
    element.project.circuitScheduleLayout.items.find((item: any) => item.id === 'BC')?.gapBefore)).toBe(3)
})

test('refreshes linked devices, inserts Q alphabetically and edits selected breakers together without losing mixed values', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell')
  const app = page.locator('cadle-app:not([read-only])')
  const ground = '00000000-0000-4000-8000-000000000102'
  const schematic = '00000000-0000-4000-8000-000000000104'
  const load = async (key: string) => {
    await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, key)
    await expect.poll(() => app.evaluate((element: any, key) => element.waitForPageReady(key), key)).toBe(true)
    await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  }
  const importShapes = async (shapes: object[]) => {
    await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
      name: 'linked-circuits.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION,
        shapes, selectedId: null, paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680 }))
    })
    await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  }
  const stored = () => shell.evaluate((element: any, key) =>
    element.project.pages[key].schema.objects.find((object: any) => object.kind === 'cadle-native-svg-document').payload.shapes, schematic)
  await expect.poll(() => app.evaluate((element: any, key) => element.waitForPageReady(key), ground)).toBe(true)
  const lamp = (id: string, bindingId: string, x: number) => ({
    id, bindingId, kind: 'symbol', name: 'Lighting', path: 'symbols/Consumption appliances/Lighting.svg',
    position: { x, y: 600 }, scale: 1.5, electrical: { role: 'load', oneWireEligible: true, circuitType: 'lighting' }
  })
  const lamp1 = lamp('linked-lamp-1', 'P1', 700)
  await importShapes([lamp1, lamp('linked-lamp-2', 'P2', 950)])
  await load(schematic)
  const rail: LineShape = { id: 'linked-rail', kind: 'line', start: { x: 400, y: 1200 }, end: { x: 1700, y: 1200 },
    strokeWidth: 4, groupId: 'onewire-kamrail-linked' }
  let sequence = 0
  await importShapes([rail, ...['P', 'R', 'T'].flatMap((family, index) => buildKamrailCircuitBundle({
    rail, anchorX: 650 + index * 400, options: { family, amps: 16 + index * 4, poles: 2, autoIncludeFamily: true },
    familyComponents: family === 'P'
      ? [1, 2].map((number) => ({ bindingId: `P${number}`, kind: 'load' as const,
        sourceShapeId: `linked-lamp-${number}`, sourcePath: 'symbols/Consumption appliances/Lighting.svg' }))
      : [{ bindingId: `${family}1`, kind: 'load' as const,
        sourceShapeId: `${family}-manual`, sourcePath: 'symbols/Consumption appliances/Jacuzzi.svg' }],
    nextShapeId: () => `linked-${++sequence}`,
    oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
    oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!,
    symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!, branchStroke: '#000000'
  })!.shapes.map((shape) => ({ ...shape, oneWireRailId: rail.id }))),
  { id: 'linked-rail-attachment-legacy', kind: 'line', start: { x: 650, y: 1200 }, end: { x: 700, y: 1200 },
    oneWireRailId: rail.id, connection: { kind: 'wire', showLabel: false } },
  { id: 'manual-note', kind: 'text', position: { x: 1700, y: 800 }, text: 'Bewaren', scale: 1 }])
  const originalLampId = (await stored()).find((shape: any) => shape.sourceLink?.id === lamp1.id).id
  await load(ground)
  await importShapes([lamp1, lamp('linked-lamp-3', 'P1', 950), {
    ...lamp('linked-heat-pump', 'P3', 1200), name: 'Heat pump', path: 'symbols/Consumption appliances/Heat pump.svg'
  }])
  await load(schematic)
  let shapes = await stored()
  expect(shapes.find((shape: any) => shape.sourceLink?.id === lamp1.id).id).toBe(originalLampId)
  expect(shapes.some((shape: any) => shape.sourceLink?.id === 'linked-lamp-2')).toBe(false)
  expect(shapes.some((shape: any) => shape.sourceLink?.id === 'linked-heat-pump')).toBe(true)
  expect(shapes.some((shape: any) => shape.sourceLink?.role === 'count-label' && shape.text === 'x2')).toBe(true)
  expect(shapes.some((shape: any) => shape.id === 'linked-rail-attachment-legacy')).toBe(false)
  expect(shapes.find((shape: any) => shape.id === 'manual-note').text).toBe('Bewaren')
  expect(shapes.filter((shape: any) => /^[RT]$/.test(shape.sourceLink?.id) && shape.sourceLink.role === 'breaker')).toHaveLength(2)

  await page.getByRole('button', { name: 'Add breaker', exact: true }).last().click()
  const railPoint = await app.locator('line[data-shape-id="linked-rail"]').evaluate((line: SVGLineElement) => {
    const point = new DOMPoint(Number(line.getAttribute('x2')) - 2, Number(line.getAttribute('y2')))
      .matrixTransform(line.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(railPoint.x, railPoint.y)
  await page.getByRole('textbox', { name: 'Circuit family' }).fill('Q')
  await page.locator('input-form-dialog').getByRole('button', { name: 'Add breaker' }).click()
  await page.keyboard.press('Escape')
  const order = () => app.evaluate((element: any) => {
    const svg = new DOMParser().parseFromString(element.toSVG(), 'image/svg+xml')
    return [...svg.querySelectorAll('text')].filter((text) => /^[PQRT]$/.test(text.textContent?.trim() ?? ''))
      .sort((a, b) => Number(a.getAttribute('x')) - Number(b.getAttribute('x'))).map((text) => text.textContent?.trim())
  })
  await expect.poll(order).toEqual(['P', 'Q', 'R', 'T'])
  const panel = page.locator('app-shell #object-inspector')
  const closeProperties = async () => {
    if (await panel.getAttribute('data-open') === 'true') await panel.getByRole('button', { name: 'Close properties' }).click()
  }
  await closeProperties()
  shapes = await stored()
  const breakers = shapes.filter((shape: any) => shape.sourceLink?.role === 'breaker')
  const clickBreaker = async (family: string, multiple = false) => {
    const id = breakers.find((shape: any) => shape.sourceLink.id === family).id
    const point = await app.locator(`g.shape-symbol[data-shape-id="${id}"] path`).first().evaluate((path: SVGPathElement) => {
      const point = path.getPointAtLength(2).matrixTransform(path.getScreenCTM()!)
      return { x: point.x, y: point.y }
    })
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    if (multiple) await page.keyboard.down(modifier)
    await page.mouse.click(point.x, point.y)
    if (multiple) await page.keyboard.up(modifier)
  }
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await clickBreaker('P')
  await closeProperties()
  await clickBreaker('R', true)
  await expect.poll(() => shell.evaluate((element: any) => element.selectedObjectCount)).toBe(2)
  const properties = page.locator('object-pane')
  await expect(properties.locator('[data-electrical-field="breakerCurrentA"]')).toHaveValue('')
  await expect(properties.locator('[data-electrical-field="poles"]')).toHaveValue('2')
  await properties.locator('[data-electrical-field="poles"]').selectOption('4')
  await app.evaluate(async (element: any) => { await element.flushPendingCircuitUpdates(); await element.flushPendingSave() })
  const poles = async () => (await stored()).filter((shape: any) =>
    shape.sourceLink?.role === 'breaker' && /^[PR]$/.test(shape.sourceLink.id)).map((shape: any) => shape.electrical.poles)
  await expect.poll(poles).toEqual([4, 4])
  expect((await stored()).filter((shape: any) => shape.sourceLink?.role === 'breaker' && /^[PRT]$/.test(shape.sourceLink.id))
    .map((shape: any) => shape.electrical.breakerCurrentA)).toEqual([16, 20, 24])
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(poles).toEqual([2, 2])
  expect(await shell.evaluate((element: any) =>
    ['P', 'R'].map((family) => element.project.circuitSpecifications?.[family]?.poles))).toEqual([undefined, undefined])
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await load(ground)
  await load(schematic)
  await expect.poll(poles).toEqual([4, 4])
  await expect.poll(order).toEqual(['P', 'Q', 'R', 'T'])
  await load(ground)
  await importShapes([lamp1, lamp('linked-lamp-3', 'P1', 950)])
  await expect.poll(() => app.evaluate((element: any) =>
    element.analyzeBindings().groups.map((group: any) => group.bindingId))).toEqual(['P1'])
  const download = page.waitForEvent('download')
  await app.evaluate(async (element: any) => { await element.exportProjectPdf('linked-check.pdf') })
  expect((await download).suggestedFilename()).toBe('linked-check.pdf')
  expect((await stored()).some((shape: any) => shape.sourceLink?.id === 'linked-heat-pump')).toBe(false)
  expect(await app.evaluate((element: any, key) => element.waitForPageReady(key), ground)).toBe(true)
})
