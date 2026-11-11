import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })
test('one manually drawn heating zone joins its three fields around an obstacle into one tube', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell'), app = page.locator('cadle-app:not([read-only])')
  await shell.evaluate(async (element: any) => { await element.loadPage('00000000-0000-4000-8000-000000000102') })
  const shapes = [
    { id: 'island', kind: 'rect', locked: true, start: { x: 745, y: 260 }, end: { x: 841, y: 404 } },
    { id: 'manual-zone', kind: 'rect', start: { x: 688, y: 260 }, end: { x: 1200, y: 528 }, heating: {
      kind: 'zone', drawingScale: 100, diameterMm: 16, spacingMm: 100, edgeMm: 100, circuits: 1, name: 'Living', direction: 'horizontal', design: { maxCircuitLengthM: 200 }
    } },
    { id: 'narrow-zone', kind: 'rect', start: { x: 400, y: 700 }, end: { x: 576, y: 728.8 }, heating: {
      kind: 'zone', drawingScale: 100, diameterMm: 16, spacingMm: 100, edgeMm: 100, circuits: 1, name: 'Smalle strook', direction: 'horizontal'
    } }
  ]
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({ name: 'manual-spiral.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    version: 2, paperLayoutVersion: 1, drawingScale: 100, paperPreset: 'a4-landscape', worldWidth: 2376, worldHeight: 1680, printMargin: 10, shapes
  })) })
  const zone = app.locator('.heating-zone[data-shape-id="manual-zone"]')
  await expect(zone.locator('.heating-circuit')).toHaveCount(1)
  await expect(zone.locator('circle')).toHaveCount(2)
  const geometry = await zone.locator('.heating-circuit').evaluate((element: SVGPathElement) => {
    const length = element.getTotalLength(); let closest = Infinity
    for (let at = 0; at <= length; at += .5) {
      const p = element.getPointAtLength(at)
      closest = Math.min(closest, Math.hypot(Math.max(745 - p.x, p.x - 841, 0), Math.max(260 - p.y, p.y - 404, 0)))
    }
    return { length, closest, moves: (element.getAttribute('d')!.match(/M /g) ?? []).length }
  })
  expect(geometry.moves).toBe(1)
  expect(geometry.length / 80).toBeGreaterThan(150)
  expect(geometry.length / 80).toBeLessThan(160)
  expect(geometry.closest).toBeGreaterThanOrEqual(8)
  const narrow = app.locator('.heating-zone[data-shape-id="narrow-zone"]')
  await expect(narrow.locator('.heating-circuit')).toHaveCount(1)
  await expect(narrow.locator('circle')).toHaveCount(2)
  await expect(narrow).toContainText('Meander')
  const inside = await narrow.locator('.heating-circuit').evaluate((element: SVGPathElement) => {
    for (let at = 0; at <= element.getTotalLength(); at += .25) {
      const p = element.getPointAtLength(at)
      if (p.x < 407.99 || p.x > 568.01 || p.y < 707.99 || p.y > 720.81) return false
    }
    return true
  })
  expect(inside).toBe(true)
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  const stored = await shell.evaluate((element: any) => element.project.pages[element.loadedPage].schema.objects[0].payload.shapes.find((s: any) => s.id === 'manual-zone').heating)
  expect(stored.circuits).toBe(1)
  await page.screenshot({ path: '/private/tmp/cadle-manual-single-circuit.png' })
})
