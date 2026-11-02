import { expect, test } from '@playwright/test'
import { buildKamrailCircuitBundle } from '../../src/editor/layout/onewire-helpers.ts'
import { oneWireSymbolBounds, oneWireSymbolScaleFor } from '../../src/editor/layout/onewire-symbol-nodes.ts'
import { ONE_WIRE_LAYOUT_VERSION } from '../../src/editor/layout/onewire-layout-plan.ts'
import type { LineShape } from '../../src/editor/model/types.ts'

const state = (shapes: unknown[]) => ({ version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION,
  shapes, selectedId: null, paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680 })

test('creates continuation sheets without shrinking, and undo restores the whole redistribution', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const root = '00000000-0000-4000-8000-000000000104'
  await page.locator(`project-element custom-drawer-item[data-project="${root}"]`).click()
  const app = page.locator('cadle-app:not([read-only])')
  const shell = page.locator('app-shell')
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  let sequence = 0
  const nextId = () => `pagination-${++sequence}`
  const rail: LineShape = { id: 'pagination-rail', kind: 'line', start: { x: 80, y: 1200 }, end: { x: 12000, y: 1200 },
    groupId: 'onewire-kamrail-test', strokeWidth: 4 }
  const shapes = [rail, ...Array.from({ length: 24 }, (_, index) => {
    const family = String.fromCharCode(65 + index)
    return buildKamrailCircuitBundle({ rail, anchorX: 400 + index * 600, options: { family, amps: 16, autoIncludeFamily: true },
      familyComponents: [1, 2, 3].map((number) => ({ bindingId: `${family}${number}`, kind: 'load' as const,
        sourcePath: 'symbols/Consumption appliances/Lighting.svg', sourceShapeId: `${family}-light-${number}` })),
      nextShapeId: nextId, oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
      oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!, symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!,
      branchStroke: '#000000' })!.shapes.map((shape) => ({ ...shape, oneWireRailId: rail.id }))
  }).flat()]
  const deviceIds = shapes.filter((shape) => shape.sourceLink?.kind === 'device').map((shape) => shape.id).sort()
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({ name: 'overflow.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state(shapes))) })
  const children = () => shell.evaluate((element: any, root) => Object.entries(element.project.pages)
    .filter(([, page]: any) => page.oneWireOverflowOf === root).map(([key]) => key), root)
  await expect.poll(async () => (await children()).length).toBeGreaterThan(0)
  const keys = await children()
  const collected = () => shell.evaluate((element: any, root) => Object.entries(element.project.pages)
    .filter(([key, page]: any) => key === root || page.oneWireOverflowOf === root)
    .flatMap(([, page]: any) => page.schema.objects[0].payload.shapes)
    .filter((shape: any) => shape.sourceLink?.kind === 'device').map((shape: any) => shape.id).sort(), root)
  expect(await collected()).toEqual(deviceIds)
  await app.evaluate((element: any) => element.undo())
  await expect.poll(async () => (await children()).length).toBe(0)
  await app.evaluate((element: any) => element.redo())
  await expect.poll(async () => (await children()).length).toBe(keys.length)
  expect(await collected()).toEqual(deviceIds)
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, keys[0])
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  expect(await app.evaluate((element: any) => element.toSVG())).toContain('VAN BLAD')
  await page.screenshot({ path: '/private/tmp/cadle-continuation-sheet.png' })
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, root)
  expect(await collected()).toEqual(deviceIds)
})

test('marks missed contacts in the editor without exporting the guidance', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000104"]').click()
  const app = page.locator('cadle-app:not([read-only])')
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({ name: 'contact.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state([
      { id: 'lamp', kind: 'symbol', name: 'Lamp', path: 'symbols/Consumption appliances/Lighting.svg', scale: 1.5, position: { x: 600, y: 500 } },
      { id: 'missed-wire', kind: 'line', start: { x: 600, y: 508 }, end: { x: 600, y: 700 }, connection: { kind: 'wire', showLabel: false },
        sourceLink: { kind: 'board', id: 'main', role: 'grid-incoming' } }
    ]))) })
  await expect(app.locator('.onewire-connection-issues')).toHaveAttribute('data-issue-count', '1')
  await expect(app.locator('[data-wire-id="missed-wire"] circle')).toHaveAttribute('stroke', '#d97706')
  const exported = await app.evaluate((element: any) => element.toSVG())
  expect(exported).not.toContain('onewire-connection-issues')
  expect(exported).not.toContain('Aansluiting net gemist')
  await page.screenshot({ path: '/private/tmp/cadle-missed-contact.png' })
})
