import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('draws and edits electrical connections as single objects and preserves them in export and on reopening', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const ground = page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000104"]')
  await ground.click()
  const app = page.locator('cadle-app:not([read-only])')
  const panel = page.locator('#object-inspector')
  const ids: string[] = []
  for (const [index, [kind, name]] of [['cable', 'kabel'], ['wire', 'draad'], ['branch', 'aftakking'], ['bridge', 'brugverbinding']].entries()) {
    if (await panel.getAttribute('data-open') === 'true') {
      await panel.getByRole('button', { name: 'Close properties' }).click()
      await expect(panel).toBeHidden()
    }
    await page.getByLabel('Elektrische verbindingen', { exact: true }).click()
    await page.getByRole('button', { name: `Teken ${name}`, exact: true }).click()
    const points = await app.locator('.world').evaluate((world: SVGGElement, index) => {
      const matrix = world.getScreenCTM()!
      const start = new DOMPoint(index === 2 ? 650 : 500 + index * 400, index === 2 ? 154 : 150).matrixTransform(matrix)
      const end = new DOMPoint(index === 2 ? 650 : 800 + index * 400, index === 2 ? 300 : 150).matrixTransform(matrix)
      return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } }
    }, index)
    await page.mouse.move(points.start.x, points.start.y)
    await page.mouse.down()
    await page.mouse.move(points.end.x, points.end.y)
    const preview = app.locator(`.shape-connection.draft[data-connection-kind="${kind}"]`)
    await expect(preview).toBeVisible()
    const id = (await preview.getAttribute('data-shape-id'))!
    ids.push(id)
    await page.mouse.up()
    const connection = app.locator(`g[data-shape-id="${id}"]`)
    await expect(connection).toHaveAttribute('data-connection-kind', kind)
    await expect(panel).toBeVisible()
    await expect(panel.getByLabel('Verbindingstype')).toHaveValue(kind)
    if (kind === 'cable') {
      await panel.getByLabel('Doorsnede (mm²)').fill('6')
      await panel.getByLabel('Doorsnede (mm²)').press('Tab')
      await expect(connection.locator('.connection-label')).toHaveText('3G6 mm² XVB')
    }
    if (kind === 'branch') {
      await expect(connection.locator('.connection-junction')).toHaveCount(1)
      await expect(connection.locator('.connection-junction')).toHaveAttribute('cy', '150')
      await expect(connection.locator('.connection-junction')).toHaveAttribute('cx', '650')
    }
    if (kind === 'bridge') {
      const before = await connection.locator('.connection-conductor').getAttribute('d')
      await panel.getByLabel('Brughoogte (mm)').fill('6')
      await panel.getByLabel('Brughoogte (mm)').press('Tab')
      await expect(connection.locator('.connection-conductor')).not.toHaveAttribute('d', before!)
    }
    const same = await app.evaluate((element: any, id) => {
      const editor = element.shadowRoot.querySelector(`g[data-shape-id="${id}"]`)
      const exported = new DOMParser().parseFromString(element.toSVG(), 'image/svg+xml').querySelector(`g[data-shape-id="${id}"]`)
      const snapshot = (root: Element) => [root, ...root.querySelectorAll('*')].map((node) => ({
        tag: node.localName,
        attributes: [...node.attributes].filter(({ name }) => name !== 'data-selected' && name !== 'xmlns')
          .map(({ name, value }) => [name, value]).sort(),
        text: node.localName === 'text' || node.localName === 'title' ? node.textContent : ''
      }))
      return { editor: snapshot(editor), exported: snapshot(exported!) }
    }, id)
    expect(same.exported).toEqual(same.editor)
  }
  await panel.getByRole('button', { name: 'Close properties' }).click()
  await expect(panel).toBeHidden()
  await page.keyboard.press('l')
  const plainPoints = await app.locator('.world').evaluate((world: SVGGElement) => {
    const matrix = world.getScreenCTM()!
    const a = new DOMPoint(1000, 300).matrixTransform(matrix)
    const b = new DOMPoint(1300, 300).matrixTransform(matrix)
    return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }
  })
  await page.mouse.move(plainPoints.a.x, plainPoints.a.y)
  await page.mouse.down()
  await page.mouse.move(plainPoints.b.x, plainPoints.b.y)
  const plainId = (await app.locator('line.shape-line.draft').getAttribute('data-shape-id'))!
  await page.mouse.up()
  await expect(panel.getByLabel('Verbindingstype')).toHaveValue('')
  await panel.getByLabel('Verbindingstype').selectOption('cable')
  await expect(app.locator(`g[data-shape-id="${plainId}"] .connection-label`)).toHaveText('3G2.5 mm² XVB')
  ids.push(plainId)
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000103"]').click()
  await ground.click()
  for (const id of ids) await expect(app.locator(`g[data-shape-id="${id}"]`)).toBeVisible()
  await expect(app.locator(`g[data-shape-id="${ids[0]}"] .connection-label`)).toHaveText('3G6 mm² XVB')
  await page.screenshot({ path: '/private/tmp/cadle-electrical-connections.png' })
})

test('generated cable properties update their circuit caption and survive regeneration', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const circuits = page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000104"]')
  await circuits.click()
  const app = page.locator('cadle-app:not([read-only])')
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  const cable = app.locator('g.shape-connection[data-connection-kind="cable"]').first()
  const point = await cable.locator('.connection-conductor').evaluate((line: SVGGeometryElement) => {
    const point = line.getPointAtLength(line.getTotalLength() * 0.6)
    const screen = new DOMPoint(point.x, point.y).matrixTransform(line.getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(point.x, point.y)
  const panel = page.locator('#object-inspector')
  await expect(panel.getByLabel('Verbindingstype')).toHaveValue('cable')
  await expect(panel.getByLabel('Toon aanduiding')).toBeChecked()
  await panel.getByLabel('Doorsnede (mm²)').fill('6')
  await panel.getByLabel('Doorsnede (mm²)').press('Tab')
  await expect(app.locator('text.onewire-generated-label').filter({ hasText: /^3G6 mm² VOB$/ })).toHaveCount(1)
  await panel.getByLabel('Benaming verbinding').fill('Voeding keuken')
  const label = app.locator('text.onewire-generated-label').filter({ hasText: /^Voeding keuken$/ })
  await expect(label).toHaveCount(1)
  await panel.getByLabel('Toon aanduiding').uncheck()
  await expect(label).toHaveCount(0)
  await panel.getByLabel('Toon aanduiding').check()
  await expect(label).toHaveCount(1)
  await app.evaluate((element: any) => element.generateAutoOneWire(1))
  const download = page.waitForEvent('download')
  await page.evaluate(() => (globalThis as any).pubsub.publish('editor.controls.command', { action: 'export-json' }))
  const exported = await download
  const state = JSON.parse(await readFile((await exported.path())!, 'utf8'))
  const cables = state.shapes.filter((shape: any) => shape.connection?.kind === 'cable').map((shape: any) => ({
    key: shape.generationKey, source: shape.sourceLink, rail: shape.oneWireRailId, connection: shape.connection
  }))
  await expect(label, JSON.stringify(cables)).toHaveCount(1)
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000103"]').click()
  await circuits.click()
  await expect(label).toHaveCount(1)
  await expect.poll(() => app.evaluate((element: any) => element.toSVG())).toContain('Voeding keuken')
})
