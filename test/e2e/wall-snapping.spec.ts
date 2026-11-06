import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

test('joins off-grid walls and T-junctions at the same coordinates in preview, commit and export', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1050 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell'), app = page.locator('cadle-app:not([read-only])')
  const key = '00000000-0000-4000-8000-000000000102'
  await shell.evaluate(async (element: any, id) => { await element.loadPage(id) }, key)
  const shapes = [
    { id: 'top', kind: 'wall', start: { x: 403, y: 407 }, end: { x: 707, y: 407 }, strokeWidth: 8 },
    { id: 'right', kind: 'wall', start: { x: 707, y: 407 }, end: { x: 707, y: 807 }, strokeWidth: 8 }
  ]
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({ name: 'walls.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 2, paperLayoutVersion: 1, drawingScale: 100,
      paperPreset: 'a4-landscape', worldWidth: 2376, worldHeight: 1680, printMargin: 10, shapes })) })
  await expect(app.locator('[data-shape-id="top"]')).toBeAttached()
  await expect(app.locator('.wall-junction')).toHaveCount(1)
  await expect(app.locator('line[data-shape-id="top"]')).toHaveCSS('stroke-linecap', 'butt')
  const screen = async (x: number, y: number) => await app.locator('.world').evaluate((world: SVGGElement, point) => {
    const p = new DOMPoint(point.x, point.y).matrixTransform(world.getScreenCTM()!)
    return { x: p.x, y: p.y }
  }, { x, y })
  const click = async (x: number, y: number) => { const p = await screen(x, y); await page.mouse.click(p.x, p.y) }
  await page.getByRole('button', { name: 'Draw wall', exact: true }).click()
  await click(405, 410)
  const down = await screen(405, 600)
  await page.mouse.move(down.x, down.y)
  const preview = app.locator('line.shape-wall.draft')
  await expect(preview).toHaveAttribute('x1', '403')
  await expect(preview).toHaveAttribute('y1', '407')
  await expect(preview).toHaveAttribute('x2', '403')
  await expect(preview).toHaveAttribute('y2', '600')
  await click(405, 600)
  const junction = await screen(705, 603)
  await page.mouse.move(junction.x, junction.y)
  await expect(preview).toHaveAttribute('x2', '707')
  await expect(preview).toHaveAttribute('y2', '600')
  await click(705, 603)
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await expect(app.locator('line.shape-wall:not(.draft)')).toHaveCount(4)
  const walls = await app.locator('line.shape-wall:not(.draft)').evaluateAll((nodes) => nodes.map((node) => ({
    start: { x: Number(node.getAttribute('x1')), y: Number(node.getAttribute('y1')) },
    end: { x: Number(node.getAttribute('x2')), y: Number(node.getAttribute('y2')) }
  })))
  expect(walls).toContainEqual({ start: { x: 403, y: 407 }, end: { x: 403, y: 600 } })
  expect(walls).toContainEqual({ start: { x: 403, y: 600 }, end: { x: 707, y: 600 } })
  const svg = await app.evaluate((element: any) => element.toSVG())
  expect(svg).toContain('class="wall-junction"')
  expect(svg).toContain('stroke-linecap: butt')
  expect(svg).toContain('x2="707"')
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await shell.evaluate(async (element: any) => { await element.loadPage('00000000-0000-4000-8000-000000000101') })
  await shell.evaluate(async (element: any, id) => { await element.loadPage(id) }, key)
  await expect(app.locator('line.shape-wall')).toHaveCount(4)
  await page.screenshot({ path: '/private/tmp/cadle-wall-snapping.png' })
})
