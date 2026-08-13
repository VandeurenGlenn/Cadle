import { expect, test } from '@playwright/test'

test('create, draw, bind, validate, generate, reload, and export one-wire project', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 })
  await page.goto('/#!/create-project')
  const values: Record<string, string> = {
    'Project name': 'E2E AREI project', 'Page name': 'Ground plan', 'Customer name': 'Ada',
    'Customer last name': 'Tester', Name: 'E2E', 'Last name': 'Installer', Company: 'Cadle Test',
    Street: 'Teststraat', 'House number': '1', 'Postal code': '1000', City: 'Brussel'
  }
  for (const [label, value] of Object.entries(values)) {
    await page.locator(`create-project-field input[data-field="${label}"]`).fill(value)
  }
  await page.locator('create-project-field .actions custom-button').click()
  await expect(page).toHaveURL(/#!\/editor\/model/)

  const drawer = page.locator('app-shell .left-rail')
  const drawerToggle = page.getByRole('button', { name: 'Open project menu' })
  await expect(drawerToggle).toBeVisible()
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(drawer).toHaveAttribute('data-mobile-open', 'false')
  await expect(drawer).toBeHidden()
  await drawerToggle.click()
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(drawer).toBeVisible()
  await page.getByRole('button', { name: 'Close project menu' }).click({ position: { x: 550, y: 400 } })
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(drawer).toBeHidden()

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('tab', { name: 'Symbols catalog' }).click()
  const stage = page.locator('cadle-app svg.stage')
  await expect(stage).toBeVisible()
  const placeAndBind = async (query: string, x: number, bindingId: string) => {
    const search = page.locator('catalog-element search-element input')
    await search.fill(query)
    await expect(page.locator('catalog-element .search-status')).toContainText(query)
    const item = page.locator('catalog-element catalog-item').filter({ hasText: query }).first()
    await expect(item).toBeVisible()
    await item.click()
    await stage.evaluate((element, localX) => {
      const bounds = element.getBoundingClientRect()
      const init = {
        bubbles: true,
        composed: true,
        clientX: bounds.left + localX,
        clientY: bounds.top + 220,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0
      }
      element.dispatchEvent(new PointerEvent('pointerdown', init))
      element.dispatchEvent(new PointerEvent('pointerup', init))
      element.dispatchEvent(new MouseEvent('click', init))
    }, x)
    const binding = page.locator('object-pane input.native-binding-input')
    await expect(binding).toBeVisible()
    await binding.fill(bindingId)
    await binding.press('Tab')
    await page.waitForTimeout(450)
  }

  // The SVG spans underneath the fixed 240 px catalog rail, so keep placement
  // clicks inside the unobscured drawing column.
  await placeAndBind('Switch general symbol', 360, 'A1')
  await placeAndBind('Wall outlet with grounding for floorplan', 420, 'A1')

  await placeAndBind('Switch general symbol', 500, 'B1')
  await placeAndBind('Lighting', 580, 'B1')

  const validation = await page.locator('cadle-app').evaluate((element: any) => element.analyzeBindings())
  expect(validation.valid, JSON.stringify(validation)).toBe(true)
  expect(validation.groups[0].bindingId).toBe('A1')
  expect(validation.groups[0].specification.breakerCurrentA).toBe(20)
  expect(validation.groups[0].specification.cableSectionMm2).toBe(2.5)
  expect(validation.groups[0].specification.breakerCurve).toBe('C')

  await page.locator('app-shell').evaluate((element: any) => element.generateAutoOneWireSchema())
  await expect.poll(() => page.locator('app-shell').evaluate((element: any) => element.project?.pages?.[element.loadedPage]?.pageType)).toBe('onewire')
  const generated = await page.locator('cadle-app').evaluate((element: any) => element.generateAutoOneWire())
  expect(generated.generated, generated.message).toBe(true)
  const generatedSvg = await page.locator('cadle-app').evaluate((element: any) => element.toSVG())
  expect((generatedSvg.match(/data-shape-id=/g) ?? []).length).toBeGreaterThan(3)
  expect(generatedSvg).toContain('C20')
  expect(generatedSvg).toContain('2.5 mm²')
  expect(generatedSvg).toContain('C16')
  expect(generatedSvg).toContain('1.5 mm²')

  await page.reload()
  await expect(page.locator('projects-field .welcome-bubble')).toHaveCount(0)
  const reopenProject = page.locator('projects-field custom-button[label="Open"]')
  await expect.poll(async () =>
    (await reopenProject.isVisible()) ||
    (await page.evaluate(() => typeof customElements.get('cadle-app')?.prototype?.toSVG === 'function'))
  ).toBe(true)
  if (await reopenProject.isVisible()) await reopenProject.click()
  await expect(page).toHaveURL(/#!\/editor\/model/)
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => typeof element.toSVG)).toBe('function')
  const exportedSvg = await page.locator('cadle-app').evaluate((element: any) => element.toSVG())
  expect(exportedSvg).toContain('<svg')
  expect(exportedSvg.length).toBeGreaterThan(1000)
})
