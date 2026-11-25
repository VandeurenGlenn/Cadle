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
        paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680, shapes: []
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
  await page.screenshot({ path: testInfo.outputPath('driveway.png') })
  const material = page.locator('object-pane [data-driveway-material]')
  await material.selectOption('pavers')
  await expect(surface).toHaveAttribute('stroke', 'url(#driveway-pavers)')
  await material.selectOption('cobbles')
  await expect(surface).toHaveAttribute('stroke', 'url(#driveway-cobbles)')
  await page.locator('object-pane [data-driveway-curved]').selectOption('angular')
  await expect(surface).not.toHaveAttribute('d', / Q /)
  await app.evaluate((element) => (element as CadleApp).undo())
  await expect(surface).toHaveAttribute('d', / Q /)
  const exported = await app.evaluate((element) => (element as CadleApp).toSVG())
  expect(exported).toContain('stroke="url(#driveway-cobbles)"')
  await app.evaluate((element) => (element as CadleApp).flushPendingSave())
  await page.reload()
  await page.locator('custom-button[label="Open"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  await expect(surface).toHaveAttribute('stroke', 'url(#driveway-cobbles)')
  await expect(surface).toHaveAttribute('d', / Q /)
})
