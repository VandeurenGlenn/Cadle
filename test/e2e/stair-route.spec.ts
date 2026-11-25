import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { CadleApp } from '../../src/editor/cadle-app.ts'
import type { Project } from '../../src/types.ts'

test.use({ serviceWorkers: 'block' })

test('draws a stair route, hides all flights after the first wall and retains the complete route after reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/#!/projects')
  await expect(page.locator('projects-field')).toBeVisible()
  const pageKey = randomUUID()
  const project: Project = {
    uuid: randomUUID(), creationTime: 1, name: 'Traptraject gelijkvloers',
    customer: { name: '', lastname: '' }, installer: { name: '', lastname: '' }, company: '',
    address: { street: '', number: '', postalCode: '', city: '' },
    pages: { [pageKey]: {
      creationTime: 1, name: 'Gelijkvloers', pageType: 'groundplan',
      schema: { version: 'native-svg-1', objects: [{ kind: 'cadle-native-svg-document', payload: {
        version: 2, paperLayoutVersion: 1, selectedId: null, drawingScale: 100,
        paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680,
        shapes: [
          { id: 'wall', kind: 'wall', start: { x: 400, y: 704 }, end: { x: 960, y: 704 }, strokeWidth: 8 },
          { id: 'light', kind: 'symbol', path: 'symbols/Consumption appliances/Lighting.svg', name: 'Lighting',
            position: { x: 480, y: 880 }, scale: 1, bindingId: 'A1', bindingLabelOffset: { x: 0, y: 60 } }
        ]
      } }] }
    } }
  }
  await page.evaluate(async (project) => {
    const root = await navigator.storage.getDirectory()
    for (const [directory, value] of [['projects', project.name], ['project-data', JSON.stringify(project)]]) {
      const store = await root.getDirectoryHandle(directory, { create: true })
      const file = await store.getFileHandle(project.uuid, { create: true })
      const writer = await file.createWritable()
      await writer.write(value)
      await writer.close()
    }
  }, project)
  await page.reload()
  await page.locator(`projects-field custom-list-item[data-name="${project.name}"]`).click()
  const app = page.locator('cadle-app:not([read-only])')
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  const point = (x: number, y: number) => app.locator('.world').evaluate((world: SVGGElement, value) => {
    const p = new DOMPoint(value.x, value.y).matrixTransform(world.getScreenCTM()!)
    return { x: p.x, y: p.y }
  }, { x, y })
  const click = async (x: number, y: number) => {
    const p = await point(x, y)
    await page.mouse.click(p.x, p.y)
  }
  const chooseTool = async () => {
    await page.getByRole('button', { name: 'More drawing tools', exact: true }).click()
    await page.getByRole('button', { name: 'Traptraject tekenen', exact: true }).click()
  }
  const stairs = app.locator('g.shape-stairs[data-stair-variant="stairs-route"]:not(.draft)')
  const footprint = () => stairs.locator('.stairs-outline').evaluate((path: SVGPathElement) => {
    const b = path.getBBox()
    return { x: b.x, y: b.y, width: b.width, height: b.height }
  })

  await chooseTool()
  await page.getByRole('button', { name: 'Trap bewaren', exact: true }).click()
  await expect(app.getByRole('status').filter({ hasText: 'Teken minstens' })).toBeVisible()
  await page.getByRole('spinbutton', { name: 'Trapbreedte (cm)', exact: true }).fill('100')
  await page.getByRole('spinbutton', { name: 'Trapbreedte (cm)', exact: true }).press('Tab')
  await click(480, 960)
  const hover = await point(480, 400)
  await page.mouse.move(hover.x, hover.y)
  await expect(app.locator('g.shape-stairs.draft .stairs-break')).toHaveCount(1)
  await click(480, 400)
  await click(880, 400)
  await click(880, 640)
  await page.keyboard.press('Backspace')
  await click(880, 960)
  await page.keyboard.press('Enter')
  await expect(stairs).toHaveCount(1)
  await expect(stairs.locator('.stairs-break')).toHaveCount(1)
  await expect(app.locator('[data-stair-route-preview]')).toHaveCount(0)
  await expect.poll(footprint).toEqual({ x: 440, y: 708, width: 80, height: 252 })
  const mask = app.locator('#stair-readability-mask')
  await expect(mask.locator('rect[fill="black"]')).toHaveCount(2)
  const pixels = await app.evaluate(async (element) => {
    const root = element.shadowRoot!
    const mask = root.querySelector('#stair-readability-mask')!.outerHTML
    const stair = root.querySelector('g.shape-stairs:not(.draft)')!.outerHTML
    const image = new Image()
    const url = URL.createObjectURL(new Blob([
      `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1100"><defs>${mask}</defs><g mask="url(#stair-readability-mask)">${stair}</g></svg>`
    ], { type: 'image/svg+xml' }))
    try {
      image.src = url
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = 1000
      canvas.height = 1100
      const context = canvas.getContext('2d')!
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, 1000, 1100)
      context.drawImage(image, 0, 0)
      return [840, 880, 940].map((y) => Array.from(context.getImageData(480, y, 1, 1).data))
    } finally { URL.revokeObjectURL(url) }
  })
  expect(pixels[0][0]).toBeLessThan(160)
  expect(pixels[1]).toEqual([255, 255, 255, 255])
  expect(pixels[2]).toEqual([255, 255, 255, 255])
  const outline = await stairs.locator('.stairs-outline').getAttribute('d')
  const exported = await app.evaluate((element) => (element as CadleApp).toSVG())
  expect(exported).toContain(`d="${outline}"`)

  const visibility = page.locator('object-pane [data-stair-visibility]')
  await visibility.selectOption('full')
  await expect(stairs.locator('.stairs-break')).toHaveCount(0)
  await expect.poll(footprint).toEqual({ x: 440, y: 360, width: 480, height: 600 })
  await app.evaluate((element) => (element as CadleApp).undo())
  await expect(stairs.locator('.stairs-break')).toHaveCount(1)
  await app.evaluate((element) => (element as CadleApp).redo())
  await expect(stairs.locator('.stairs-break')).toHaveCount(0)
  await visibility.selectOption('floor')
  await app.evaluate(async (element) => { await (element as CadleApp).flushPendingSave() })
  await page.reload()
  await page.locator('custom-button[label="Open"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  await expect(stairs.locator('.stairs-break')).toHaveCount(1)
  await expect.poll(footprint).toEqual({ x: 440, y: 708, width: 80, height: 252 })
  await click(480, 832)
  await visibility.selectOption('full')
  await expect.poll(footprint).toEqual({ x: 440, y: 360, width: 480, height: 600 })

  await chooseTool()
  await click(1200, 960)
  await click(1200, 400)
  await page.keyboard.press('Escape')
  await expect(stairs).toHaveCount(1)
  await expect(app.locator('[data-stair-route-preview]')).toHaveCount(0)

  await chooseTool()
  await click(1200, 960)
  const end = await point(1200, 400)
  await page.mouse.dblclick(end.x, end.y)
  await expect(stairs).toHaveCount(2)
  await expect(app.locator('[data-stair-route-preview]')).toHaveCount(0)
})
