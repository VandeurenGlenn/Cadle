import { expect, test } from '@playwright/test'

test('shows drawing dimensions immediately and refreshes thickness after an edit', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000104"]').click()
  const app = page.locator('cadle-app:not([read-only])')
  await expect.poll(() => app.evaluate((element: any) => element.waitForPageReady('00000000-0000-4000-8000-000000000104'))).toBe(true)
  const state = { version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: 999, paperPreset: 'a4-landscape', printMargin: 10,
    worldWidth: 2376, worldHeight: 1680, selectedId: null, shapes: [
      { id: 'measured-wire', kind: 'line', start: { x: 800, y: 400 }, end: { x: 880, y: 480 }, strokeWidth: 2,
        connection: { kind: 'wire', routing: 'orthogonal', showLabel: false } }
    ] }
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({ name: 'dimensions.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state)) })
  const conductor = app.locator('[data-shape-id="measured-wire"] .connection-conductor')
  await expect(conductor).toBeVisible()
  const point = await conductor.evaluate((node: SVGGeometryElement) => {
    const point = node.getPointAtLength(20).matrixTransform(node.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(point.x, point.y)
  const inspector = page.locator('#object-inspector')
  await expect(inspector.locator('[data-dimension="length"]')).toHaveText('20 mm')
  await expect(inspector.locator('[data-dimension="strokeWidth"]')).toHaveText('2 px')
  await expect(inspector.locator('[data-dimension="length"]')).toBeInViewport()
  const appearance = inspector.locator('[data-property-section="appearance"]')
  await appearance.locator('summary').click()
  await appearance.getByRole('spinbutton').fill('3')
  await appearance.getByRole('spinbutton').press('Tab')
  await expect(inspector.locator('[data-dimension="strokeWidth"]')).toHaveText('3 px')
  await expect(inspector.locator('[data-dimension="length"]')).toHaveText('20 mm')
  await appearance.locator('summary').click()
  await inspector.locator('object-pane section').evaluate((element) => { element.scrollTop = 0 })
  await page.screenshot({ path: '/private/tmp/cadle-object-dimensions.png' })
})
