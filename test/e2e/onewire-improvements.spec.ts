import { expect, test } from '@playwright/test'

test('keeps wires attached while moving and undoing, and makes room for long saved names', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const topology = page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000103"]')
  await topology.click()
  const app = page.locator('cadle-app:not([read-only])')
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  const breaker = app.locator('g.shape-symbol').filter({ has: page.locator('svg[viewBox="0 0 28.783 28.8265"]') })
  const id = (await breaker.getAttribute('data-shape-id'))!
  const snapshot = () => app.evaluate((element: HTMLElement, id) => {
    const root = element.shadowRoot!
    const group = root.querySelector(`g.shape-symbol[data-shape-id="${id}"]`)!
    const svg = group.querySelector('svg')!
    const world = root.querySelector<SVGGElement>('.world')!
    const matrix = svg.getScreenCTM()!, inverse = world.getScreenCTM()!.inverse()
    const port = (y: number) => {
      const point = new DOMPoint(15.3836, y).matrixTransform(matrix).matrixTransform(inverse)
      return { x: point.x, y: point.y }
    }
    const wires = [...root.querySelectorAll<SVGGeometryElement>('.connection-conductor')]
      .map((node) => {
        const start = node.getPointAtLength(0), end = node.getPointAtLength(node.getTotalLength())
        return { id: node.getAttribute('data-shape-id'), start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } }
      })
    return { top: port(0.12), bottom: port(28.47), wires }
  }, id)
  const initial = await snapshot()
  const attached = initial.wires.flatMap((wire) => (['start', 'end'] as const).flatMap((endpoint) =>
    (['top', 'bottom'] as const).filter((port) => Math.hypot(wire[endpoint].x - initial[port].x, wire[endpoint].y - initial[port].y) < 0.01)
      .map((port) => ({ id: wire.id, endpoint, port }))))
  expect(attached).toHaveLength(2)
  const connected = async () => {
    const current = await snapshot()
    for (const attachment of attached) {
      const wire = current.wires.find((wire) => wire.id === attachment.id)!
      expect(wire[attachment.endpoint].x).toBeCloseTo(current[attachment.port].x, 3)
      expect(wire[attachment.endpoint].y).toBeCloseTo(current[attachment.port].y, 3)
      const other = attachment.endpoint === 'start' ? 'end' : 'start'
      const original = initial.wires.find((wire) => wire.id === attachment.id)!
      expect(wire[other].x).toBeCloseTo(original[other].x, 3)
      expect(wire[other].y).toBeCloseTo(original[other].y, 3)
    }
    return current
  }
  const point = await breaker.locator('path').first().evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(2).matrixTransform(path.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 45, point.y + 25, { steps: 4 })
  await page.mouse.up()
  const moved = await connected()
  await expect(app.locator('path.connection-conductor')).not.toHaveCount(0)
  expect(moved.top.x).not.toBeCloseTo(initial.top.x)
  await page.keyboard.press('ArrowRight')
  const nudged = await connected()
  expect(nudged.top.x).toBeGreaterThan(moved.top.x)
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  const restored = await connected()
  expect(restored.top.x).toBeCloseTo(initial.top.x, 3)
  expect(restored.top.y).toBeCloseTo(initial.top.y, 3)

  const rcd = app.locator('g.shape-symbol').filter({ hasText: 'Hoofddiff.' })
  const rcdPoint = await rcd.locator('path').first().evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(2).matrixTransform(path.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(rcdPoint.x, rcdPoint.y)
  const name = 'Algemene differentieel voor de woning en de garage'
  await page.locator('object-pane').getByRole('textbox', { name: 'Benaming', exact: true }).fill(name)
  const description = app.locator('.onewire-device-description').filter({ hasText: name })
  await expect(description.locator('tspan')).toHaveCount(3)
  const cable = app.locator('g.shape-connection[data-connection-kind="cable"] .connection-conductor')
  const cablePoint = await cable.evaluate((line: SVGLineElement) => {
    const point = new DOMPoint(Number(line.getAttribute('x1')), (Number(line.getAttribute('y1')) + Number(line.getAttribute('y2'))) / 2)
      .matrixTransform(line.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(cablePoint.x, cablePoint.y)
  const caption = 'Voedingskabel van de meter naar het hoofdverdeelbord'
  await page.locator('object-pane').getByLabel('Benaming verbinding').fill(caption)
  const text = app.locator('text.shape-text').filter({ hasText: caption })
  await expect(text.locator('tspan')).toHaveCount(3)
  const gap = await app.evaluate((element: HTMLElement) => {
    const root = element.shadowRoot!
    const caption = [...root.querySelectorAll('text.shape-text')].find((node) => node.textContent?.includes('Voedingskabel'))!
    const meter = root.querySelector('g.shape-symbol svg[viewBox="0 0 17.5861 17.2479"]')!
    return meter.getBoundingClientRect().top - caption.getBoundingClientRect().bottom
  })
  expect(gap).toBeGreaterThan(5)
  const same = await app.evaluate((element: any) => {
    const exported = new DOMParser().parseFromString(element.toSVG(), 'image/svg+xml')
    return [...element.shadowRoot.querySelectorAll('.onewire-device-description, text.shape-text')]
      .filter((node: Element) => node.querySelector('tspan'))
      .every((node: Element) => {
        const id = node.closest('[data-shape-id]')!.getAttribute('data-shape-id')!
        const shape = exported.querySelector(`[data-shape-id="${id}"]`)!
        const target = node.classList.contains('onewire-device-description') ? shape.querySelector('.onewire-device-description')! : shape
        return [...node.querySelectorAll('tspan')].map((span) => span.textContent).join('|') ===
          [...target.querySelectorAll('tspan')].map((span) => span.textContent).join('|')
      })
  })
  expect(same).toBe(true)
  await page.screenshot({ path: '/private/tmp/cadle-improvements-long-labels.png' })
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000104"]').click()
  await topology.click()
  await expect(description).toHaveText(name)
  await expect(text).toHaveText(caption)
})
