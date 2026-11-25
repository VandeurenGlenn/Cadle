import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { CadleApp } from '../../src/editor/cadle-app.ts'
import type { Project } from '../../src/types.ts'

test.use({ serviceWorkers: 'block' })

test('draws and edits a curved driveway and preserves it after reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/#!/projects')
  const pageKey = randomUUID()
  const project: Project = {
    uuid: randomUUID(), creationTime: 1, name: 'Oprit test',
    customer: { name: '', lastname: '' }, installer: { name: '', lastname: '' }, company: '',
    address: { street: '', number: '', postalCode: '', city: '' },
    pages: { [pageKey]: {
      creationTime: 1, name: 'Situatieplan', pageType: 'groundplan',
      schema: { version: 'native-svg-1', objects: [{ kind: 'cadle-native-svg-document', payload: {
        version: 2, paperLayoutVersion: 1, selectedId: null, drawingScale: 100,
        paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680, shapes: [{
          id: 'driveway-light', kind: 'symbol', name: 'Lighting',
          path: 'symbols/Consumption appliances/Lighting.svg',
          position: { x: 560, y: 400 }, scale: 1.5, bindingId: 'A1'
        }]
      } }] }
    } }
  }
  await page.evaluate(async (value) => {
    const root = await navigator.storage.getDirectory()
    for (const [directory, content] of [['projects', value.name], ['project-data', JSON.stringify(value)]]) {
      const store = await root.getDirectoryHandle(directory, { create: true })
      const file = await store.getFileHandle(value.uuid, { create: true })
      const writer = await file.createWritable()
      await writer.write(content)
      await writer.close()
    }
  }, project)
  await page.reload()
  await page.locator(`projects-field custom-list-item[data-name="${project.name}"]`).click()
  const app = page.locator('cadle-app:not([read-only])')
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  await app.evaluate((element) => (element as CadleApp).exportA4PNG())
  const label = app.locator('.binding-label[data-shape-id="driveway-light"] text')
  await expect(label).toHaveText('A1')
  const labelPosition = await label.evaluate((node) => ({ x: node.getAttribute('x'), y: node.getAttribute('y') }))
  const click = async (x: number, y: number) => {
    const p = await app.locator('.world').evaluate((world: SVGGElement, value) => {
      const result = new DOMPoint(value.x, value.y).matrixTransform(world.getScreenCTM()!)
      return { x: result.x, y: result.y }
    }, { x, y })
    await page.mouse.click(p.x, p.y)
  }
  await page.getByRole('button', { name: 'More drawing tools', exact: true }).click()
  await page.getByRole('button', { name: 'Oprit tekenen', exact: true }).click()
  await page.getByRole('button', { name: 'Oprit bewaren', exact: true }).click()
  await expect(app.getByRole('status').filter({ hasText: 'Teken minstens' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Verharding oprit' }).selectOption('gravel')
  await click(320, 400)
  await click(800, 400)
  await click(800, 920)
  await page.keyboard.press('Enter')

  const driveway = app.locator('g.shape-driveway:not(.draft)')
  const surface = driveway.locator('.driveway-surface')
  await expect(driveway).toHaveCount(1)
  await expect(surface).toHaveAttribute('stroke', 'url(#driveway-gravel)')
  await expect(surface).toHaveAttribute('stroke-width', '240')
  await expect(surface).toHaveAttribute('d', / Q /)
  await expect(label).toHaveText('A1')
  expect(await label.evaluate((node) => ({ x: node.getAttribute('x'), y: node.getAttribute('y') }))).toEqual(labelPosition)
  await page.screenshot({ path: testInfo.outputPath('driveway.png') })
  const material = page.locator('object-pane [data-driveway-material]')
  await material.selectOption('pavers')
  await expect(surface).toHaveAttribute('stroke', 'url(#driveway-pavers)')
  await expect(label).toHaveText('A1')
  await material.selectOption('cobbles')
  await expect(surface).toHaveAttribute('stroke', 'url(#driveway-cobbles)')
  await expect(label).toHaveText('A1')
  await page.locator('object-pane [data-driveway-curved]').selectOption('angular')
  await expect(surface).not.toHaveAttribute('d', / Q /)
  await app.evaluate((element) => (element as CadleApp).undo())
  await expect(surface).toHaveAttribute('d', / Q /)
  const exported = await app.evaluate((element) => (element as CadleApp).toSVG())
  expect(exported).toContain('stroke="url(#driveway-cobbles)"')
  expect(exported).toMatch(/class="binding-label" data-shape-id="driveway-light"/)
  expect(exported).toContain('>A1</text>')
  await app.evaluate((element) => (element as CadleApp).flushPendingSave())
  await page.reload()
  await page.locator('custom-button[label="Open"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  await expect(surface).toHaveAttribute('stroke', 'url(#driveway-cobbles)')
  await expect(surface).toHaveAttribute('d', / Q /)
  await expect(label).toHaveText('A1')

  await page.getByRole('button', { name: 'More drawing tools', exact: true }).click()
  await page.getByRole('button', { name: 'Oprit tekenen', exact: true }).click()
  await page.getByRole('combobox', { name: 'Vorm oprit', exact: true }).selectOption('area')
  await page.getByRole('combobox', { name: 'Verharding oprit', exact: true }).selectOption('cobbles')
  await expect(page.getByRole('spinbutton', { name: 'Opritbreedte (cm)' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Oprit bewaren', exact: true }).click()
  await expect(app.getByRole('status').filter({ hasText: 'minstens drie hoeken' })).toBeVisible()
  await click(1080, 400)
  await click(1720, 400)
  await click(1720, 1040)
  await click(1080, 1040)
  await click(1080, 400)
  const filled = app.locator('g.shape-driveway:not(.draft) .driveway-surface[fill="url(#driveway-cobbles)"]')
  await expect(filled).toHaveCount(1)
  await expect(filled).toHaveAttribute('d', 'M 1080 400 L 1720 400 L 1720 1040 L 1080 1040 Z')
  await expect(page.locator('object-pane [data-driveway-curved]')).toHaveCount(0)
  const filledId = (await filled.locator('..').getAttribute('data-shape-id'))!
  const pixels = await filled.evaluate(async (path: SVGPathElement) => {
    const pattern = path.ownerSVGElement!.querySelector('#driveway-cobbles')!
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="2376" height="1680"><defs>${pattern.outerHTML}</defs>${path.outerHTML}</svg>`
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }))
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = 2376; canvas.height = 1680
      const context = canvas.getContext('2d')!
      context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0)
      return { center: [...context.getImageData(1400, 720, 1, 1).data], outside: [...context.getImageData(1000, 720, 1, 1).data] }
    } finally { URL.revokeObjectURL(url) }
  })
  expect(pixels.center).not.toEqual([255, 255, 255, 255])
  expect(pixels.outside).toEqual([255, 255, 255, 255])
  await app.evaluate((element) => (element as CadleApp).undo())
  await expect(filled).toHaveCount(0)
  await app.evaluate((element) => (element as CadleApp).redo())
  await expect(filled).toHaveCount(1)
  const inspector = page.locator('app-shell #object-inspector')
  if (await inspector.getAttribute('data-open') === 'true') await inspector.getByRole('button', { name: 'Close properties' }).click()
  await click(2000, 1200)
  await click(1400, 720)
  await expect(app.locator(`g.shape-driveway[data-shape-id="${filledId}"]`)).toHaveAttribute('data-selected', 'true')
  await page.locator('object-pane [data-driveway-material]').selectOption('gravel')
  await expect(app.locator(`g.shape-driveway[data-shape-id="${filledId}"] .driveway-surface`)).toHaveAttribute('fill', 'url(#driveway-gravel)')
  expect(await app.evaluate((element) => (element as CadleApp).toSVG())).toContain('fill="url(#driveway-gravel)"')
  await page.screenshot({ path: testInfo.outputPath('filled-driveway.png') })
  await app.evaluate((element) => (element as CadleApp).flushPendingSave())
  await page.reload()
  await page.locator('custom-button[label="Open"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  await expect(app.locator(`g.shape-driveway[data-shape-id="${filledId}"] .driveway-surface`)).toHaveAttribute('fill', 'url(#driveway-gravel)')
  await expect(label).toHaveText('A1')

  const sampleJoin = (exported = false) => app.evaluate(async (element, exported) => {
    const root = exported
      ? new DOMParser().parseFromString((element as CadleApp).toSVG(), 'image/svg+xml')
      : element.shadowRoot!
    const definitions = [...root.querySelectorAll('pattern[id^="driveway-"]')].map((node) => node.outerHTML).join('')
    const outlines = root.querySelector('.driveway-outlines')!.outerHTML
    const surfaces = [...root.querySelectorAll('g.shape-driveway:not(.draft)')].map((node) => node.outerHTML).join('')
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="2376" height="1680"><defs>${definitions}</defs>${outlines}${surfaces}</svg>`
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }))
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = 2376; canvas.height = 1680
      const context = canvas.getContext('2d')!
      context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0)
      return [479, 480, 640, 641].map((x) => [...context.getImageData(x, 360, 1, 1).data])
    } finally { URL.revokeObjectURL(url) }
  }, exported)
  const beforeJoin = await sampleJoin()
  await page.getByRole('button', { name: 'More drawing tools', exact: true }).click()
  await page.getByRole('button', { name: 'Oprit tekenen', exact: true }).click()
  await page.getByRole('combobox', { name: 'Vorm oprit', exact: true }).selectOption('route')
  await page.getByRole('combobox', { name: 'Verharding oprit', exact: true }).selectOption('cobbles')
  await page.getByRole('spinbutton', { name: 'Opritbreedte (cm)' }).fill('200')
  await click(560, 200)
  await click(560, 400)
  await page.keyboard.press('Enter')
  await expect(app.locator('g.shape-driveway:not(.draft)')).toHaveCount(3)
  expect(await sampleJoin()).toEqual(beforeJoin)
  expect(await sampleJoin(true)).toEqual(beforeJoin)
  await expect(label).toHaveText('A1')
  await page.screenshot({ path: testInfo.outputPath('joined-driveways.png') })
  await app.evaluate((element) => (element as CadleApp).flushPendingSave())
  await page.reload()
  await page.locator('custom-button[label="Open"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  expect(await sampleJoin()).toEqual(beforeJoin)
})
