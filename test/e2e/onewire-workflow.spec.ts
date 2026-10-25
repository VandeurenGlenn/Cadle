import { expect, test } from '@playwright/test'

test('create, draw, bind, validate, generate, reload, and export one-wire project', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 })
  await page.goto('/#!/create-project')
  const values: Record<string, string> = {
    'Project name': 'E2E AREI project',
    'Page name': 'Ground plan',
    'Customer name': 'Ada',
    'Customer last name': 'Tester',
    Name: 'E2E',
    'Last name': 'Installer',
    Company: 'Cadle Test',
    Street: 'Teststraat',
    'House number': '1',
    'Postal code': '1000',
    City: 'Brussel'
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
  await expect
    .poll(() =>
      page.locator('app-shell').evaluate((element: any) => element.project?.pages?.[element.loadedPage]?.pageType)
    )
    .toBe('onewire')
  const generated = await page.locator('cadle-app').evaluate((element: any) => element.generateAutoOneWire())
  expect(generated.generated, generated.message).toBe(true)
  const generatedSvg = await page.locator('cadle-app').evaluate((element: any) => element.toSVG())
  expect((generatedSvg.match(/data-shape-id=/g) ?? []).length).toBeGreaterThan(3)
  expect(generatedSvg).toContain('C20')
  expect(generatedSvg).toContain('2.5 mm²')
  expect(generatedSvg).toContain('C16')
  expect(generatedSvg).toContain('1.5 mm²')
  const generatedLabels = page.locator('cadle-app text.onewire-generated-label')
  await expect(generatedLabels.first()).toHaveCSS('stroke', 'none')
  const cableOffsets = await generatedLabels.evaluateAll((labels) =>
    labels
      .filter((label) => label.textContent?.includes('mm²'))
      .map((label) => {
        const feeder = label.closest('g.shape-group')?.querySelector('line')
        return feeder ? Number(feeder.getAttribute('x1')) - Number(label.getAttribute('x')) : null
      })
  )
  expect(cableOffsets.length).toBeGreaterThan(0)
  for (const offset of cableOffsets) expect(offset).toBeLessThan(-10)

  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await stage.evaluate((element) => {
    const breaker = [...element.querySelectorAll<SVGGElement>('g.shape-symbol')].find((group) =>
      /automaat/i.test(group.querySelector('title')?.textContent ?? '')
    )
    if (!breaker) throw new Error('Missing generated breaker symbol.')
    breaker.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        composed: true,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0
      })
    )
  })
  const supplyOptions = page.getByRole('radiogroup', { name: 'Supply phase' })
  await expect(supplyOptions.getByRole('radio')).toHaveCount(5)
  await expect(supplyOptions.getByRole('radio', { name: '3F + N' })).toHaveAttribute('aria-checked', 'true')
  const supplyLayout = await supplyOptions.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }))
  expect(supplyLayout.scrollWidth).toBeLessThanOrEqual(supplyLayout.clientWidth)

  await supplyOptions.getByRole('radio', { name: 'L2 + N' }).click()
  await expect(supplyOptions.getByRole('radio', { name: 'L2 + N' })).toHaveAttribute('aria-checked', 'true')
  const neutralOptions = page.getByRole('radiogroup', { name: 'Neutral position' })
  await neutralOptions.getByRole('radio', { name: 'N left' }).click()
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('N-L2')
  await neutralOptions.getByRole('radio', { name: 'N right' }).click()
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('L2-N')
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('2P')

  const showPhaseLabel = page.getByRole('checkbox', { name: 'Show phase label' })
  await showPhaseLabel.uncheck()
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).not.toContain('L2-N')
  await showPhaseLabel.check()
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('L2-N')

  await supplyOptions.getByRole('radio', { name: '3F', exact: true }).click()
  await expect(supplyOptions.getByRole('radio', { name: '3F', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('3P')
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('L1-L2-L3')
  await supplyOptions.getByRole('radio', { name: '3F + N' }).click()
  await expect(supplyOptions.getByRole('radio', { name: '3F + N' })).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('4P')
  await supplyOptions.getByRole('radio', { name: 'L2 + N' }).click()

  const objectPane = page.locator('object-pane')
  await objectPane.locator('[data-electrical-field="breakerCurrentA"]').fill('25')
  await objectPane.locator('[data-electrical-field="breakerCurve"]').selectOption('D')
  await objectPane.locator('[data-electrical-field="cableSectionMm2"]').fill('4')
  await objectPane.locator('[data-electrical-field="cableConductors"]').fill('4')
  await expect(objectPane.locator('[data-electrical-field="hasProtectiveConductor"]')).toHaveValue('false')
  await objectPane.locator('[data-electrical-field="hasProtectiveConductor"]').selectOption('true')
  await objectPane.locator('[data-electrical-field="cableType"]').selectOption('XVB-Cca')
  await objectPane.locator('[data-electrical-field="cableInstallation"]').selectOption('underground')
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('D25A')
  await expect
    .poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG()))
    .toContain('4G4 mm² XVB Cca')
  await page.locator('cadle-app').evaluate(async (element: any) => element.flushPendingCircuitUpdates())
  await page.getByRole('button', { name: 'Close properties' }).click()

  const oneWireGeometry = async () =>
    stage.evaluate((element) => {
      const labels = [...element.querySelectorAll<SVGTextElement>('text.onewire-generated-label')]
      const labelX = (label: string) => {
        const element = labels.find((candidate) => candidate.textContent?.trim() === label)
        return element ? Number(element.getAttribute('x')) : null
      }
      const rails = [...element.querySelectorAll<SVGLineElement>('line.shape-line')]
        .map((line) => ({
          x1: Number(line.getAttribute('x1')),
          x2: Number(line.getAttribute('x2')),
          y1: Number(line.getAttribute('y1')),
          y2: Number(line.getAttribute('y2')),
          strokeWidth: Number.parseFloat(getComputedStyle(line).strokeWidth)
        }))
        .filter((line) => line.y1 === line.y2 && line.strokeWidth >= 4)
        .sort((a, b) => Math.abs(b.x2 - b.x1) - Math.abs(a.x2 - a.x1))
      return { a: labelX('A'), b: labelX('B'), c: labelX('C'), d: labelX('D'), rail: rails[0] ?? null, rails }
    })

  const addBreaker = page.getByRole('button', { name: 'Add breaker' }).last()
  await expect(addBreaker).toBeVisible()
  await addBreaker.click()
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('D25A')
  const railClick = await stage.evaluate((element) => {
    const rail = [...element.querySelectorAll<SVGLineElement>('line.shape-line')]
      .filter((line) => Number.parseFloat(getComputedStyle(line).strokeWidth) >= 4)
      .sort(
        (a, b) =>
          Math.abs(Number(b.getAttribute('x2')) - Number(b.getAttribute('x1'))) -
          Math.abs(Number(a.getAttribute('x2')) - Number(a.getAttribute('x1')))
      )[0]
    if (!rail) throw new Error('Missing generated one-wire rail.')
    const point = element.createSVGPoint()
    point.x = Number(rail.getAttribute('x2')) - 2
    point.y = Number(rail.getAttribute('y2'))
    const screen = point.matrixTransform(rail.getScreenCTM() ?? new DOMMatrix())
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(railClick.x, railClick.y)
  await page.getByRole('textbox', { name: 'Circuit family' }).fill('C')
  await page.getByRole('button', { name: 'Add breaker', exact: true }).first().click()
  await expect.poll(async () => (await oneWireGeometry()).c).not.toBeNull()
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('D25A')

  const addedGeometry = await oneWireGeometry()
  expect(addedGeometry.b).not.toBeNull()
  expect(addedGeometry.c).not.toBeNull()
  expect(addedGeometry.rail).not.toBeNull()
  const previousRightmostFamily = Math.max(addedGeometry.a ?? 0, addedGeometry.b ?? 0)
  expect((addedGeometry.c ?? 0) - previousRightmostFamily).toBeGreaterThan(0)
  expect((addedGeometry.c ?? 0) - previousRightmostFamily).toBeLessThan(180)
  expect(
    Math.max(addedGeometry.rail?.x1 ?? 0, addedGeometry.rail?.x2 ?? 0) - (addedGeometry.c ?? 0)
  ).toBeLessThanOrEqual(30)

  const addKamrail = page.getByRole('button', { name: 'Add kamrail' }).last()
  await addKamrail.click()
  const secondRailPoint = await stage.evaluate((element) => {
    const rail = [...element.querySelectorAll<SVGLineElement>('line.shape-line')].find(
      (line) => Number.parseFloat(getComputedStyle(line).strokeWidth) >= 4
    )
    if (!rail) throw new Error('Missing generated one-wire rail.')
    const point = element.createSVGPoint()
    point.x = (Number(rail.getAttribute('x1')) + Number(rail.getAttribute('x2'))) / 2
    point.y = Number(rail.getAttribute('y1')) + 160
    const screen = point.matrixTransform(rail.getScreenCTM() ?? new DOMMatrix())
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(secondRailPoint.x, secondRailPoint.y)
  await expect.poll(async () => (await oneWireGeometry()).rails.length).toBe(2)
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('D25A')

  await addBreaker.click()
  const secondRailClick = await stage.evaluate((element) => {
    const rails = [...element.querySelectorAll<SVGLineElement>('line.shape-line')]
      .filter((line) => Number.parseFloat(getComputedStyle(line).strokeWidth) >= 4)
      .sort((a, b) => Number(a.getAttribute('y1')) - Number(b.getAttribute('y1')))
    const rail = rails.at(-1)
    if (!rail) throw new Error('Missing second one-wire rail.')
    const point = element.createSVGPoint()
    point.x = Number(rail.getAttribute('x1')) + 20
    point.y = Number(rail.getAttribute('y1'))
    const screen = point.matrixTransform(rail.getScreenCTM() ?? new DOMMatrix())
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(secondRailClick.x, secondRailClick.y)
  await page.getByRole('textbox', { name: 'Circuit family' }).fill('D')
  await page.getByRole('button', { name: 'Add breaker', exact: true }).first().click()
  await expect.poll(async () => (await oneWireGeometry()).d).not.toBeNull()
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('D25A')
  const multiRailGeometry = await oneWireGeometry()
  expect(multiRailGeometry.rails).toHaveLength(2)
  expect(multiRailGeometry.rails.find((rail) => rail.y1 === addedGeometry.rail?.y1)).toEqual(addedGeometry.rail)

  await page.locator('cadle-app').evaluate(async (element: any) => {
    await element.flushPendingCircuitUpdates()
    await element.flushPendingSave()
  })
  const editedCircuit = await page
    .locator('app-shell')
    .evaluate((element: any) => element.project?.circuitSpecifications?.A)
  expect(editedCircuit).toMatchObject({
    breakerCurrentA: 25,
    breakerCurve: 'D',
    cableSectionMm2: 4,
    cableConductors: 4,
    hasProtectiveConductor: true,
    cableType: 'XVB-Cca',
    cableInstallation: 'underground',
    phaseConfiguration: 'L2+N',
    neutralPosition: 'right',
    poles: 2,
    showPhaseLabel: true
  })
  const savedSvg = await page.locator('cadle-app').evaluate((element: any) => element.toSVG())
  expect(savedSvg).toContain('D25A')
  expect(savedSvg).toContain('4G4 mm² XVB Cca')
  expect(savedSvg).toContain('L2-N')
  expect(savedSvg).toContain('2P')
  await page.reload()
  await expect(page.locator('projects-field .welcome-bubble')).toHaveCount(0)
  const reopenProject = page.locator('projects-field custom-button[label="Open"]')
  await expect
    .poll(
      async () =>
        (await reopenProject.isVisible()) ||
        (await page.evaluate(() => typeof customElements.get('cadle-app')?.prototype?.toSVG === 'function'))
    )
    .toBe(true)
  if (await reopenProject.isVisible()) await reopenProject.click()
  await expect(page).toHaveURL(/#!\/editor\/model/)
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => typeof element.toSVG)).toBe('function')
  const restoredCircuit = await page
    .locator('app-shell')
    .evaluate((element: any) => element.project?.circuitSpecifications?.A)
  expect(restoredCircuit).toMatchObject(editedCircuit)
  const exportedSvg = await page.locator('cadle-app').evaluate((element: any) => element.toSVG())
  expect(exportedSvg).toContain('<svg')
  expect(exportedSvg.length).toBeGreaterThan(1000)
  expect(exportedSvg).toContain('D25A')
  expect(exportedSvg).toContain('4G4 mm² XVB Cca')
  expect(exportedSvg).toContain('L2-N')
  expect(exportedSvg).toContain('2P')
  await expect(page.locator('cadle-app text.onewire-generated-label').first()).toHaveCSS('stroke', 'none')
  const restoredGeometry = await oneWireGeometry()
  expect(restoredGeometry.c).not.toBeNull()
  expect(restoredGeometry.d).not.toBeNull()
  expect(restoredGeometry.rails).toEqual(multiRailGeometry.rails)
})

test('inserts a breaker before the selected component without shrinking the rail', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000104"]').click()

  await page.locator('project-actions').getByRole('button', { name: 'More' }).click()
  await page.locator('project-actions custom-list-item[data-action="describe-one-wire"]').click()
  const topologyDialog = page.locator('onewire-prompt-dialog')
  await expect(topologyDialog.locator('textarea:not(.json-editor)')).toHaveValue('')
  await expect(topologyDialog.locator('textarea:not(.json-editor)')).not.toHaveAttribute('placeholder', '')
  await expect(topologyDialog.locator('.json-editor')).toHaveValue('')
  await expect(topologyDialog.locator('custom-button[label="Structuur toepassen"]')).toHaveAttribute('disabled')
  await topologyDialog.locator('custom-button[label="Sluiten"]').click()

  const stage = page.locator('cadle-app svg.stage')
  const existingRailIds = await stage
    .locator('line.shape-line')
    .evaluateAll((lines) =>
      lines
        .filter((line) => Number.parseFloat(getComputedStyle(line).strokeWidth) >= 4)
        .map((line) => line.getAttribute('data-shape-id'))
    )
  await page.getByRole('button', { name: 'Add kamrail' }).click()
  const stageBounds = await stage.boundingBox()
  if (!stageBounds) throw new Error('One-wire stage is not visible.')
  await page.mouse.click(stageBounds.x + stageBounds.width * 0.72, stageBounds.y + stageBounds.height * 0.3)
  const railId = await stage.locator('line.shape-line').evaluateAll((lines, previousIds) => {
    const previous = new Set(previousIds)
    return lines
      .filter(
        (line) =>
          Number.parseFloat(getComputedStyle(line).strokeWidth) >= 4 &&
          !previous.has(line.getAttribute('data-shape-id'))
      )
      .map((line) => line.getAttribute('data-shape-id'))
      .at(-1)
  }, existingRailIds)
  if (!railId) throw new Error('The new kamrail was not created.')

  const addSwitch = page.getByRole('button', { name: 'Add switch' })
  await addSwitch.click()
  await expect(addSwitch).toHaveAttribute('aria-pressed', 'true')
  expect((await addSwitch.boundingBox())?.height).toBe(44)

  const rail = stage.locator(`line[data-shape-id="${railId}"]`)
  const beforeShapeIds = await stage
    .locator('[data-shape-id]')
    .evaluateAll((items) => [...new Set(items.map((item) => item.getAttribute('data-shape-id')).filter(Boolean))])
  const railBefore = await rail.evaluate((line) => ({
    x1: Number(line.getAttribute('x1')),
    x2: Number(line.getAttribute('x2')),
    y: Number(line.getAttribute('y1')),
    strokeWidth: Number.parseFloat(getComputedStyle(line).strokeWidth)
  }))
  const clickPoint = await rail.evaluate((element) => {
    const line = element as SVGLineElement
    const point = line.ownerSVGElement?.createSVGPoint()
    if (!point) throw new Error('Missing SVG point factory.')
    point.x =
      Number(line.getAttribute('x1')) + (Number(line.getAttribute('x2')) - Number(line.getAttribute('x1'))) * 0.84
    point.y = Number(line.getAttribute('y1'))
    const screen = point.matrixTransform(line.getScreenCTM() ?? new DOMMatrix())
    return { x: screen.x, y: screen.y }
  })

  await page.mouse.click(clickPoint.x, clickPoint.y)
  await expect(page.getByRole('heading', { name: 'Add breaker first' })).toBeVisible()
  expect(
    await stage
      .locator('[data-shape-id]')
      .evaluateAll((items) => new Set(items.map((item) => item.getAttribute('data-shape-id'))).size)
  ).toBe(beforeShapeIds.length)
  await page.getByRole('textbox', { name: 'Circuit family' }).fill('C')
  await page.locator('input-form-dialog').getByRole('button', { name: 'Add breaker' }).click()
  await expect
    .poll(() =>
      stage
        .locator('[data-shape-id]')
        .evaluateAll((items) => new Set(items.map((item) => item.getAttribute('data-shape-id'))).size)
    )
    .toBeGreaterThan(beforeShapeIds.length + 3)
  await expect(page.getByRole('textbox', { name: 'Circuit family' })).toHaveCount(0)
  await expect(addSwitch).toHaveAttribute('aria-pressed', 'true')

  const addedLines = await stage.locator('line[data-shape-id]').evaluateAll((lines, previousIds) => {
    const previous = new Set(previousIds)
    return lines
      .filter((line) => !previous.has(line.getAttribute('data-shape-id') ?? ''))
      .map((line) => ({
        x1: Number(line.getAttribute('x1')),
        x2: Number(line.getAttribute('x2')),
        y1: Number(line.getAttribute('y1')),
        y2: Number(line.getAttribute('y2'))
      }))
  }, beforeShapeIds)
  const verticalLines = addedLines.filter((line) => line.x1 === line.x2)
  expect(verticalLines).toHaveLength(2)
  expect(verticalLines.some((line) => line.y1 === railBefore.y || line.y2 === railBefore.y)).toBe(true)
  expect(verticalLines[0]?.x1).toBeCloseTo(verticalLines[1]?.x1 ?? Number.NaN)

  const railAfter = await rail.evaluate((line) => ({
    x1: Number(line.getAttribute('x1')),
    x2: Number(line.getAttribute('x2'))
  }))
  expect(railAfter.x2 - railAfter.x1).toBeGreaterThanOrEqual(railBefore.x2 - railBefore.x1)

  const existingSwitch = stage.locator('g[data-selected="true"]')
  const switchBounds = await existingSwitch.boundingBox()
  if (!switchBounds) throw new Error('The newly connected switch is not visible.')
  const beforeExtensionCount = await stage
    .locator('[data-shape-id]')
    .evaluateAll((items) => new Set(items.map((item) => item.getAttribute('data-shape-id'))).size)
  await page.getByRole('button', { name: 'Add load' }).click()
  await page.mouse.click(switchBounds.x + switchBounds.width / 2, switchBounds.y + switchBounds.height / 2)
  await expect
    .poll(() =>
      stage
        .locator('[data-shape-id]')
        .evaluateAll((items) => new Set(items.map((item) => item.getAttribute('data-shape-id'))).size)
    )
    .toBe(beforeExtensionCount + 2)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const extension = await stage.locator('line[data-selected="true"]').evaluate((line) => ({
    y1: Number(line.getAttribute('y1')),
    y2: Number(line.getAttribute('y2'))
  }))
  expect(extension.y1).toBeCloseTo(extension.y2)

  await page.getByRole('button', { name: 'Add breaker' }).first().click()
  const secondBreakerPoint = await rail.evaluate((line) => {
    const point = line.ownerSVGElement?.createSVGPoint()
    if (!point) throw new Error('Missing SVG point factory.')
    point.x =
      Number(line.getAttribute('x1')) + (Number(line.getAttribute('x2')) - Number(line.getAttribute('x1'))) * 0.3
    point.y = Number(line.getAttribute('y1'))
    const screen = point.matrixTransform(line.getScreenCTM() ?? new DOMMatrix())
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(secondBreakerPoint.x, secondBreakerPoint.y)
  await page.getByRole('textbox', { name: 'Circuit family' }).fill('D')
  await page.locator('input-form-dialog').getByRole('button', { name: 'Add breaker' }).click()
  const existingBreaker = stage.getByRole('img', { name: 'Automaat' }).last()
  await page.getByRole('button', { name: 'Fit page', exact: true }).click()
  const beforeSwitchCount = await stage
    .locator('[data-shape-id]')
    .evaluateAll((items) => new Set(items.map((item) => item.getAttribute('data-shape-id'))).size)
  await addSwitch.click()
  await existingBreaker.click()
  await expect
    .poll(() =>
      stage
        .locator('[data-shape-id]')
        .evaluateAll((items) => new Set(items.map((item) => item.getAttribute('data-shape-id'))).size)
    )
    .toBe(beforeSwitchCount + 2)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const switchConnection = await stage.locator('line[data-selected="true"]').evaluate((line) => ({
    x1: Number(line.getAttribute('x1')),
    x2: Number(line.getAttribute('x2'))
  }))
  expect(switchConnection.x1).toBeCloseTo(switchConnection.x2)

  const breakerId = await existingBreaker.evaluate((element) =>
    element.closest('[data-shape-id]')?.getAttribute('data-shape-id')
  )
  if (!breakerId) throw new Error('The existing breaker has no shape identity.')
  const railIdsBeforeSecondRail = await stage
    .locator('line.shape-line')
    .evaluateAll((lines) => lines.map((line) => line.getAttribute('data-shape-id')).filter(Boolean))
  await page.getByRole('button', { name: 'Add kamrail' }).click()
  await page.mouse.click(stageBounds.x + stageBounds.width * 0.32, stageBounds.y + stageBounds.height * 0.62)
  const secondRailId = await stage.locator('line.shape-line').evaluateAll((lines, previousIds) => {
    const previous = new Set(previousIds)
    return lines.map((line) => line.getAttribute('data-shape-id')).find((id) => id && !previous.has(id))
  }, railIdsBeforeSecondRail)
  if (!secondRailId) throw new Error('The second rail has no shape identity.')
  const secondRail = stage.locator(`line[data-shape-id="${secondRailId}"]`)
  await page.getByRole('button', { name: 'Add breaker' }).first().click()
  await secondRail.evaluate((line) => {
    const init = { bubbles: true, composed: true, pointerId: 1, pointerType: 'mouse', button: 0 }
    line.dispatchEvent(new PointerEvent('pointerdown', init))
    line.dispatchEvent(new PointerEvent('pointerup', init))
  })
  await page.getByRole('textbox', { name: 'Circuit family' }).fill('E')
  await page.locator('input-form-dialog').getByRole('button', { name: 'Add breaker' }).click()
  const secondRailBeforeDelete = await secondRail.evaluate((line) => ({
    x1: Number(line.getAttribute('x1')),
    x2: Number(line.getAttribute('x2')),
    y1: Number(line.getAttribute('y1')),
    y2: Number(line.getAttribute('y2'))
  }))
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await stage.locator(`[data-shape-id="${breakerId}"]`).click()
  await page.keyboard.press('Delete')
  await expect(secondRail).toHaveAttribute('x1', `${secondRailBeforeDelete.x1}`)
  await expect(secondRail).toHaveAttribute('x2', `${secondRailBeforeDelete.x2}`)
  await expect(secondRail).toHaveAttribute('y1', `${secondRailBeforeDelete.y1}`)
  await expect(secondRail).toHaveAttribute('y2', `${secondRailBeforeDelete.y2}`)
})
