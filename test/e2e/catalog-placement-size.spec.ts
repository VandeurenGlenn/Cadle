import { expect, test } from '@playwright/test'
import { oneWireSymbolBounds, oneWireSymbolScaleFor } from '../../src/editor/layout/onewire-symbol-nodes.ts'
import { ONE_WIRE_LAYOUT_VERSION } from '../../src/editor/layout/onewire-layout-plan.ts'
import { buildKamrailCircuitBundle } from '../../src/editor/layout/onewire-helpers.ts'
import type { LineShape } from '../../src/editor/model/types.ts'

test('previews and places catalog symbols at the page-specific size without resizing existing objects', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const app = page.locator('cadle-app:not([read-only])')
  await expect.poll(() => app.evaluate((element: any) =>
    element.waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
  const items = [
    { name: 'Switch general symbol', path: 'symbols/Switches/Switch general symbol.svg', ground: 1.3 * 1.05 },
    { name: 'Lighting', path: 'symbols/Consumption appliances/Lighting.svg', ground: 1.5 * 1.15 },
    { name: 'Spot', path: 'symbols/Consumption appliances/Spot.svg', ground: 1.15 },
    { name: 'Wall outlet with grounding for floorplan', path: 'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg', ground: 1.05 },
    { name: 'Heat pump', path: 'symbols/Consumption appliances/Heat pump.svg', ground: 2.5 },
    { name: 'Heat pump indoor unit air-air', path: 'symbols/Consumption appliances/Heat pump indoor unit air-air.svg', ground: 3 },
    { name: 'Heat pump indoor unit air-water', path: 'symbols/Consumption appliances/Heat pump indoor unit air-water.svg', ground: 2.5 },
    { name: 'Heat pump water-water', path: 'symbols/Consumption appliances/Heat pump water-water.svg', ground: 2.5 },
    { name: 'Jacuzzi', path: 'symbols/Consumption appliances/Jacuzzi.svg', ground: 2.5 },
    { name: 'Videofoon touchscreen', path: 'symbols/Consumption appliances/Videofoon touchscreen.svg', ground: 1.15 },
    { name: 'Alarm klavier', path: 'symbols/Consumption appliances/Alarm klavier.svg', ground: 1.15 }
  ]
  for (const [key, context] of [
    ['00000000-0000-4000-8000-000000000102', 'groundplan'],
    ['00000000-0000-4000-8000-000000000104', 'onewire']
  ] as const) {
    await page.locator('app-shell').evaluate(async (element: any, key) => { await element.loadPage(key) }, key)
    await app.evaluate(async (element: any) => { await element.exportA4PNG() })
    const existing = await app.locator('g.shape-symbol:not(.symbol-preview)').evaluateAll((nodes) =>
      nodes.map((node) => ({ id: node.getAttribute('data-shape-id'), width: node.querySelector('svg')?.getAttribute('width') })))
    await page.getByRole('tab', { name: 'Symbols catalog' }).click()
    for (const [index, item] of items.entries()) {
      const search = page.locator('catalog-element search-element input')
      await search.fill(item.name)
      await expect(page.locator('catalog-element .search-status')).toContainText(item.name)
      await page.locator('catalog-element').getByRole('button', { name: new RegExp(`^Place ${item.name}$`, 'i') }).first().click()
      const point = await app.locator('.world').evaluate((world: SVGGElement, index) => {
        const point = new DOMPoint(1000 + (index % 4) * 150, 280 + Math.floor(index / 4) * 200)
          .matrixTransform(world.getScreenCTM()!)
        return { x: point.x, y: point.y }
      }, index)
      await page.mouse.move(point.x, point.y)
      const expectedWidth = 24 * (context === 'onewire' ? oneWireSymbolScaleFor(item.path)! : item.ground)
      const preview = app.locator('g.symbol-preview > svg')
      await expect(preview).toBeVisible()
      await expect.poll(async () => Number(await preview.getAttribute('width'))).toBeCloseTo(expectedWidth, 5)
      await page.mouse.down()
      await page.mouse.up()
      const placed = app.locator('g.shape-symbol[data-selected="true"]:not(.symbol-preview) > svg')
      await expect(placed).toBeVisible()
      expect(Number(await placed.getAttribute('width'))).toBeCloseTo(expectedWidth, 5)
    }
    for (const shape of existing) {
      await expect(app.locator(`g.shape-symbol[data-shape-id="${shape.id}"] > svg`)).toHaveAttribute('width', shape.width!)
    }
    await page.screenshot({ path: `/private/tmp/cadle-catalog-placement-${context}.png` })
  }
})

test('repairs equipment feeds at their SVG outlines, rings or filled dots and preserves them on reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const app = page.locator('cadle-app:not([read-only])')
  const shell = page.locator('app-shell')
  await expect.poll(() => app.evaluate((element: any) =>
    element.waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
  const root = '00000000-0000-4000-8000-000000000104'
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, root)
  let sequence = 0
  const rail: LineShape = { id: 'equipment-rail', kind: 'line', start: { x: 80, y: 1200 }, end: { x: 2200, y: 1200 },
    groupId: 'onewire-kamrail-equipment', strokeWidth: 4 }
  const names = ['Heat pump', 'Heat pump indoor unit air-air', 'Heat pump indoor unit air-water',
    'Heat pump water-water', 'Jacuzzi', 'Washing machine', 'Dryer', 'Electric oven']
  const deviceGroups = [names, ['Heat pump'], ['Jacuzzi'], ['Washing machine'], ['Dryer'], ['Electric oven'],
    ['Dishwasher', 'Refrigerator', 'Videofoon touchscreen', 'Alarm klavier'],
    ['Dishwasher'], ['Refrigerator'], ['Videofoon touchscreen'], ['Alarm klavier']]
  const shapes = [rail, ...deviceGroups
    .flatMap((devices, index) => {
    const family = String.fromCharCode(65 + index)
    return buildKamrailCircuitBundle({
      rail, anchorX: 400 + index * 180, options: { family, amps: 20, autoIncludeFamily: true },
      familyComponents: devices.map((name, row) => ({ bindingId: `${family}${row + 1}`, kind: 'load',
        sourcePath: `symbols/Consumption appliances/${name}.svg`, sourceName: name, sourceShapeId: `${family}-${row}` })),
      nextShapeId: () => `equipment-${++sequence}`,
      oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
      oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!,
      symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!, branchStroke: '#000000'
    })!.shapes.map((shape) => ({ ...shape, oneWireRailId: rail.id }))
  })]
  const contacts = shapes.flatMap((shape) => {
    if (shape.kind !== 'symbol' || shape.sourceLink?.kind !== 'device') return []
    const bottom = deviceGroups[shape.bindingId!.charCodeAt(0) - 65].length === 1
    const feed = shapes.find((candidate) => candidate.kind === 'line' && (bottom
      ? candidate.sourceLink?.role === 'trunk' && candidate.bindingId === shape.bindingId?.replace(/\d+$/, '')
      : candidate.sourceLink?.role === 'row-wire' && candidate.bindingId === shape.bindingId))
    if (!feed) throw new Error(`Missing equipment feed for ${shape.name}`)
    return [{
      device: shape.id, feed: feed.id, bottom,
      mark: shape.name === 'Dishwasher' ? 'ring' : /^(?:Washing machine|Dryer|Electric oven)$/.test(shape.name) ? 'dot' : 'rect',
      width: /^(?:Heat pump|Jacuzzi|Videofoon touchscreen|Alarm klavier)/.test(shape.name) ? 72 : 48
    }]
  })
  const legacy = shapes.map((shape) => shape.kind === 'symbol' && shape.sourceLink?.kind === 'device'
    ? { ...shape, scale: 2, position: { x: shape.position.x + 10, y: shape.position.y + 10 } } : shape)
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'equipment-old-connections.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION - 1,
      shapes: legacy, selectedId: null, paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680 }))
  })
  const inspectContacts = () => app.evaluate((element: any, contacts) => {
    const exported = new DOMParser().parseFromString(element.toSVG(), 'image/svg+xml')
    const exportRoot = document.importNode(exported.documentElement, true)
    if (!(exportRoot instanceof SVGSVGElement)) throw new Error('Export did not contain an SVG root')
    exportRoot.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none'
    document.body.appendChild(exportRoot)
    const measureGap = (svg: SVGSVGElement, wire: SVGLineElement, bottom: boolean, type: string) => {
      const wireContact = new DOMPoint(wire.x2.baseVal.value, wire.y2.baseVal.value).matrixTransform(wire.getScreenCTM()!)
      if (type === 'ring') {
        const ring = svg.querySelector<SVGPathElement>('path[d*="A2.83465"]')!
        const matrix = ring.getScreenCTM()!
        const length = ring.getTotalLength()
        const distance = (offset: number) => {
          const point = ring.getPointAtLength(offset).matrixTransform(matrix)
          return Math.hypot(point.x - wireContact.x, point.y - wireContact.y)
        }
        let closest = 0
        for (let index = 1; index <= 256; index++) {
          if (distance(length * index / 256) < distance(length * closest / 256)) closest = index
        }
        let start = length * Math.max(0, closest - 1) / 256
        let end = length * Math.min(256, closest + 1) / 256
        for (let iteration = 0; iteration < 40; iteration++) {
          const third = (end - start) / 3
          if (distance(start + third) < distance(end - third)) end -= third
          else start += third
        }
        return distance((start + end) / 2)
      }
      const dot = type === 'dot'
      const mark = svg.querySelector<SVGGraphicsElement>(dot ? 'ellipse[style*="--symbol-fill"]' : 'rect')!
      const bodyContact = new DOMPoint(
        Number(mark.getAttribute(dot ? 'cx' : 'x')) + (!dot && bottom ? Number(mark.getAttribute('width')) / 2 : 0),
        Number(mark.getAttribute(dot ? 'cy' : 'y')) + (dot ? 0 : Number(mark.getAttribute('height')) * (bottom ? 1 : 0.5))
      ).matrixTransform(mark.getScreenCTM()!)
      return Math.hypot(bodyContact.x - wireContact.x, bodyContact.y - wireContact.y)
    }
    try {
      return contacts.map(({ device, feed, bottom, mark }) => {
        const svg = element.shadowRoot.querySelector(`g.shape-symbol[data-shape-id="${device}"] > svg`) as SVGSVGElement
        const wire = element.shadowRoot.querySelector(`line[data-shape-id="${feed}"]`) as SVGLineElement
        const exportedSvg = exportRoot.querySelector<SVGSVGElement>(`g[data-shape-id="${device}"] svg`)!
        const exportedWire = exportRoot.querySelector<SVGLineElement>(`line[data-shape-id="${feed}"]`)!
        return {
          gap: measureGap(svg, wire, bottom, mark),
          width: Number(svg.getAttribute('width')),
          exportWidth: Number(exportedSvg.getAttribute('width')),
          exportGap: measureGap(exportedSvg, exportedWire, bottom, mark)
        }
      })
    } finally {
      exportRoot.remove()
    }
  }, contacts)
  const expected = contacts.map(({ width }) => ({ gap: 0, width, exportWidth: width, exportGap: 0 }))
  await expect.poll(async () => (await inspectContacts()).map((contact) =>
    ({ ...contact, gap: Math.round(contact.gap * 1000) / 1000, exportGap: Math.round(contact.exportGap * 1000) / 1000 })))
    .toEqual(expected)
  await expect(app.locator('.onewire-connection-issues')).toHaveAttribute('data-issue-count', '0')
  await page.screenshot({ path: '/private/tmp/cadle-equipment-connections.png' })
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await shell.evaluate(async (element: any) => { await element.loadPage('00000000-0000-4000-8000-000000000102') })
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, root)
  await expect.poll(async () => (await inspectContacts()).map((contact) =>
    ({ ...contact, gap: Math.round(contact.gap * 1000) / 1000, exportGap: Math.round(contact.exportGap * 1000) / 1000 })))
    .toEqual(expected)
  await expect(app.locator('.onewire-connection-issues')).toHaveAttribute('data-issue-count', '0')
})

test('renders separated, connected multiple sockets in the one-wire diagram and export', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000104"]').click()
  const app = page.locator('cadle-app:not([read-only])')
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  const socket = {
    id: 'multiple-socket', kind: 'symbol', name: 'Wall outlet with grounding for floorplan',
    path: 'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg', scale: 1.05,
    position: { x: 600, y: 500 }, rotation: -90, groupId: 'onewire-test',
    electrical: { role: 'load', oneWireEligible: true, circuitType: 'sockets', socketCount: 3 }
  }
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'sockets.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION,
      shapes: [socket], selectedId: null, paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680 }))
  })
  const group = app.locator('g.shape-symbol[data-shape-id="multiple-socket"]')
  await expect(group.locator(':scope > svg')).toHaveCount(3)
  await expect(group.locator(':scope > line')).toHaveCount(1)
  const boxes = await group.locator(':scope > svg > g').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom }
    }).sort((a, b) => a.top - b.top))
  expect(boxes).toHaveLength(3)
  expect(boxes[0].bottom).toBeLessThan(boxes[1].top)
  expect(boxes[1].bottom).toBeLessThan(boxes[2].top)
  const exported = await app.evaluate((element: any) => element.toSVG())
  const exportShape = await page.evaluate((markup) => {
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
    const group = doc.querySelector('g[data-shape-id="multiple-socket"]')
    return { copies: group?.querySelectorAll('svg').length, connectors: group?.querySelectorAll('line').length }
  }, exported)
  expect(exportShape).toEqual({ copies: 3, connectors: 1 })
})

test('keeps projector arrowheads the same size when the editor thickens the beam strokes', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000104"]').click()
  const app = page.locator('cadle-app:not([read-only])')
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  const shapes = ['Projector with divergent beam', 'Projector with little divergent beam'].flatMap((name, index) =>
    [false, true].map((grouped) => ({
      id: `projector-${index}-${grouped}`, kind: 'symbol', name,
      path: `symbols/Consumption appliances/${name}.svg`, scale: 2,
      position: { x: 600 + index * 200, y: grouped ? 700 : 500 },
      ...(grouped ? { groupId: 'onewire-test' } : {})
    })))
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'projectors.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION,
      shapes, selectedId: null, paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680 }))
  })
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })

  for (const shape of shapes) {
    const symbol = app.locator(`g.shape-symbol[data-shape-id="${shape.id}"] > svg`)
    await expect(symbol.locator('marker')).toHaveAttribute('markerUnits', 'userSpaceOnUse')
    const inkCounts = await symbol.evaluate(async (svg) => {
      const counts: number[] = []
      for (const strokeWidth of [0.24, 2]) {
        const clone = svg.cloneNode(true) as SVGSVGElement
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        clone.setAttribute('width', '192')
        clone.setAttribute('height', '192')
        clone.removeAttribute('x')
        clone.removeAttribute('y')
        clone.querySelectorAll('ellipse, path:not([marker-end])').forEach((node) => {
          if (!node.closest('defs')) node.remove()
        })
        clone.querySelectorAll<SVGPathElement>('path[marker-end]').forEach((beam) => {
          beam.style.stroke = 'transparent'
          beam.style.strokeWidth = String(strokeWidth)
        })
        const image = new Image()
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 192
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        const pixels = context.getImageData(0, 0, 192, 192).data
        let ink = 0
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] > 127) ink += 1
        }
        counts.push(ink)
      }
      return counts
    })
    expect(inkCounts[0]).toBeGreaterThan(0)
    expect(inkCounts[1]).toBe(inkCounts[0])
  }

  const exported = await app.evaluate((element: any) => element.toSVG())
  const markerUnits = await page.evaluate((markup) => {
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
    return [...doc.querySelectorAll('g[data-shape-id^="projector-"] marker')].map((marker) => marker.getAttribute('markerUnits'))
  }, exported)
  expect(markerUnits).toEqual(shapes.map(() => 'userSpaceOnUse'))
})
