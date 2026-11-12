import { expect, test } from '@playwright/test'

test('edits protection pole counts independently and retains them after reopening', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const topologyPage = page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000103"]')
  await topologyPage.click()
  const app = page.locator('cadle-app:not([read-only])')
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  const poles = page.locator('object-pane').getByRole('combobox', { name: 'Poles (nP)', exact: true })
  const devices = [
    { viewBox: '0 0 28.783 28.8265', value: '1' },
    { viewBox: '0 0 38.5625 29.8893', value: '4' }
  ]
  const selectDevice = async (viewBox: string) => {
    await app.locator(`g.shape-symbol svg[viewBox="${viewBox}"] path`).nth(1).click()
  }
  for (const device of devices) {
    await selectDevice(device.viewBox)
    await poles.selectOption(device.value)
    const symbol = app.locator('g.shape-symbol').filter({ has: page.locator(`svg[viewBox="${device.viewBox}"]`) })
    await expect(symbol.locator('text').filter({ hasText: new RegExp(`^${device.value}P$`) })).toHaveCount(1)
  }
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000104"]').click()
  await topologyPage.click()
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  for (const device of devices) {
    await selectDevice(device.viewBox)
    await expect(poles).toHaveValue(device.value)
  }
})

test('defaults RCDs to A and retains an explicit type through reopening and regeneration', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const topologyPage = page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000103"]')
  await topologyPage.click()
  const app = page.locator('cadle-app:not([read-only])')
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  const mainSwitch = app.locator('g.shape-symbol').filter({ has: page.locator('svg[viewBox="0 0 28.783 28.8265"]') })
  await expect(mainSwitch.locator('text').filter({ hasText: /^N-L1$/ })).toHaveCount(0)
  expect(await app.evaluate((element: any) => element.toSVG())).not.toContain('>N-L1</text>')
  const selectRcd = async () => {
    const point = await app.locator('g.shape-symbol svg[viewBox="0 0 38.5625 29.8893"] path').first().evaluate((path: SVGPathElement) => {
      const point = path.getPointAtLength(2)
      const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!)
      return { x: screen.x, y: screen.y }
    })
    await page.mouse.click(point.x, point.y)
  }
  await selectRcd()
  const description = page.locator('object-pane').getByRole('textbox', { name: 'Benaming', exact: true })
  await expect(description).toHaveValue('Hoofddiff.')
  await description.fill('Algemene differentieel')
  await expect(app.locator('.onewire-device-description').filter({ hasText: /^Algemene differentieel$/ })).toHaveCount(1)
  const type = page.locator('object-pane').getByRole('combobox', { name: 'RCD type', exact: true })
  await expect(type).toHaveValue('A')
  await type.selectOption('F')
  await expect.poll(() => app.evaluate((element: any) => element.toSVG())).toContain('Type F')
  const rows = await app.locator('g.shape-symbol').filter({ hasText: 'Algemene differentieel' }).evaluate((symbol) => {
    const marker = symbol.querySelector<SVGTSpanElement>('[data-field="device-type"]')!
    const sensitivity = symbol.querySelector<SVGTSpanElement>('[data-field="residual-current"]')!
    const current = symbol.querySelector<SVGTSpanElement>('[data-field="rated-current"]')!
    const type = symbol.querySelector<SVGTSpanElement>('[data-field="rcd-type"]')!
    const name = symbol.querySelector<SVGTextElement>('.onewire-device-description')!
    const box = (node: SVGGraphicsElement) => {
      const { x, y, width, height } = node.getBBox()
      return { x, y, width, height }
    }
    return { marker: box(marker), sensitivity: box(sensitivity), current: box(current), type: box(type), name: box(name),
      sharedSensitivityRow: marker.parentElement === sensitivity.parentElement,
      sharedTypeRow: current.parentElement === type.parentElement }
  })
  expect(rows.sharedSensitivityRow).toBe(true)
  expect(rows.sharedTypeRow).toBe(true)
  expect(rows.marker.x + rows.marker.width).toBeLessThan(rows.sensitivity.x)
  expect(rows.current.x + rows.current.width).toBeLessThan(rows.type.x)
  expect(rows.current.y + rows.current.height).toBeLessThan(rows.name.y)
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000104"]').click()
  await topologyPage.click()
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  await selectRcd()
  await expect(type).toHaveValue('F')
  await expect(description).toHaveValue('Algemene differentieel')
  await expect(mainSwitch.locator('text').filter({ hasText: /^N-L1$/ })).toHaveCount(0)
  const regenerated = await app.evaluate((element: any) => element.generateAutoOneWire())
  expect(regenerated.generated).toBe(true)
  await expect.poll(() => app.evaluate((element: any) => element.toSVG())).toContain('Type F')
  await expect(app.locator('.onewire-device-description').filter({ hasText: 'Algemene differentieel' })).toHaveCount(1)
  await expect(mainSwitch.locator('text').filter({ hasText: /^N-L1$/ })).toHaveCount(0)
  expect(await app.evaluate((element: any) => element.toSVG())).not.toContain('>N-L1</text>')
  const switchPoint = await mainSwitch.locator('path').first().evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(2)
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(switchPoint.x, switchPoint.y)
  await expect(description).toHaveValue('Hoofdautomaat')
  await description.fill('')
  await expect(app.locator('.onewire-device-description').filter({ hasText: /^Hoofdautomaat$/ })).toHaveCount(0)
  await app.evaluate((element: any) => element.generateAutoOneWire())
  await expect.poll(() => app.evaluate((element: any) => element.toSVG())).not.toContain('>Hoofdautomaat<')
})
