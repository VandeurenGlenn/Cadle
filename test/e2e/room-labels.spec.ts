import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

test('labels rooms by clicking, persists IDs and updates generated circuit names without rerouting', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1500, height: 1050 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell'), app = page.locator('cadle-app:not([read-only])')
  const sourceKey = '00000000-0000-4000-8000-000000000102'
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, sourceKey)
  const shapes = [400, 720].flatMap((x, room) => {
    const corners = [{ x, y: 400 }, { x: x + 320, y: 400 }, { x: x + 320, y: 720 }, { x, y: 720 }]
    return corners.map((start, i) => ({ id: `wall-${room}-${i}`, kind: 'wall', start, end: corners[(i + 1) % 4] }))
  })
  const state = { version: 2, paperLayoutVersion: 1, drawingScale: 100, paperPreset: 'a4-landscape',
    worldWidth: 2376, worldHeight: 1680, printMargin: 10, selectedId: null, shapes }
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'rooms.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state))
  })
  await expect(app.locator('[data-shape-id="wall-0-0"]')).toBeAttached()
  const click = async (x: number, y: number) => {
    const point = await app.locator('.world').evaluate((world: SVGGElement, p) => {
      const q = new DOMPoint(p.x, p.y).matrixTransform(world.getScreenCTM()!)
      return { x: q.x, y: q.y }
    }, { x, y })
    await page.mouse.click(point.x, point.y)
  }
  const drawing = async () => {
    await app.evaluate(async (element: any) => { await element.flushPendingSave() })
    return await shell.evaluate((element: any) => element.project.pages[element.loadedPage].schema.objects[0].payload.shapes)
  }
  const dialog = page.locator('input-form-dialog')
  await page.getByRole('button', { name: 'Ruimte-ID en naam', exact: true }).click()
  await click(200, 200)
  await expect(app.locator('.room-label-status')).toContainText('gesloten ruimte')
  await click(500, 500)
  await expect(dialog.getByLabel('Ruimte-ID', { exact: true })).toHaveValue('R01')
  await dialog.getByLabel('Ruimtenaam', { exact: true }).fill('Leefruimte')
  await dialog.getByRole('button', { name: 'Ruimte bewaren', exact: true }).click()
  await expect(page.locator('#object-inspector [data-property-section="room-label"]')).toContainText('R01')
  await click(850, 500)
  await expect(dialog.getByLabel('Ruimte-ID', { exact: true })).toHaveValue('R02')
  await dialog.getByLabel('Ruimte-ID', { exact: true }).fill('r01')
  await dialog.getByLabel('Ruimtenaam', { exact: true }).fill('Keuken')
  await dialog.getByRole('button', { name: 'Ruimte bewaren', exact: true }).click()
  await expect(dialog).toContainText('al in gebruik')
  await dialog.getByLabel('Ruimte-ID', { exact: true }).fill('R02')
  await dialog.getByRole('button', { name: 'Ruimte bewaren', exact: true }).click()
  expect((await drawing()).filter((shape: any) => shape.roomLabel)).toHaveLength(2)
  await app.evaluate((element: any) => element.undo())
  expect((await drawing()).filter((shape: any) => shape.roomLabel)).toHaveLength(1)
  await app.evaluate((element: any) => element.redo())
  await click(520, 520)
  await expect(dialog.getByLabel('Ruimtenaam', { exact: true })).toHaveValue('Leefruimte')
  await dialog.getByLabel('Ruimtenaam', { exact: true }).fill('Zitruimte')
  await dialog.getByRole('button', { name: 'Ruimte bewaren', exact: true }).click()
  expect((await drawing()).filter((shape: any) => shape.roomLabel)).toHaveLength(2)
  await shell.evaluate(async (element: any) => { await element.loadPage('00000000-0000-4000-8000-000000000101') })
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, sourceKey)
  expect((await drawing()).filter((shape: any) => shape.roomLabel).map((shape: any) => shape.roomLabel)).toEqual([
    { id: 'R01', name: 'Zitruimte' }, { id: 'R02', name: 'Keuken' }
  ])
  await page.getByRole('button', { name: 'Legplan automatisch maken', exact: true }).click()
  await dialog.getByLabel('Legafstand h.o.h. (mm)').fill('200')
  await dialog.getByRole('button', { name: 'Verdeler plaatsen', exact: true }).click()
  await expect(app.locator('.heating-planner-status')).toContainText('Klik het startpunt')
  await click(180, 280)
  await expect(app.locator('.heating-manifold')).toHaveCount(1, { timeout: 30000 })
  const overview = page.locator('#object-inspector [data-property-section="heating-circuits"]')
  await expect(overview).toContainText('R01 – Zitruimte')
  await expect(overview).toContainText('R02 – Keuken')
  const paths = await app.locator('.heating-pipe .heating-circuit').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('d')))
  await page.getByRole('button', { name: 'Ruimte-ID en naam', exact: true }).click()
  await click(520, 520)
  await dialog.getByLabel('Ruimtenaam', { exact: true }).fill('Salon')
  await dialog.getByRole('button', { name: 'Ruimte bewaren', exact: true }).click()
  await app.locator('.heating-quality-status').click()
  await expect(overview).toContainText('R01 – Salon')
  await expect(overview).not.toContainText('R01 – Zitruimte')
  expect(await app.locator('.heating-pipe .heating-circuit').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('d')))).toEqual(paths)
  expect(await app.evaluate((element: any) => element.toSVG())).toContain('Salon')
})
