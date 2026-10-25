import { expect, test } from '@playwright/test'

test('editor, SVG and A4 PNG share the sheet geometry and details strip', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()

  for (const [key, name, title] of [
    ['00000000-0000-4000-8000-000000000102', 'ground', 'SITUATION PLAN'],
    ['00000000-0000-4000-8000-000000000103', 'topology', 'ONE-WIRE DISTRIBUTION'],
    ['00000000-0000-4000-8000-000000000104', 'circuits', 'ONE-WIRE CIRCUITS']
  ]) {
    await page.locator(`project-element custom-drawer-item[data-project="${key}"]`).click()
    const app = page.locator('cadle-app')
    await expect(app.locator('svg.stage .project-title-block')).toBeVisible()
    await expect(app.locator('svg.stage .project-title-block')).toContainText(title)
    const result = await app.evaluate(async (element: any) => {
      // Wait for the same asset preload used by every export path.
      const exported = await element.exportA4PNG()
      const svg = element.toSVG()
      const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
      const editorBlock = element.shadowRoot.querySelector('.project-title-block')
      const exportedBlock = parsed.querySelector('.project-title-block')
      const details = (block: Element) => [...block.querySelectorAll('*')].map((node) => ({
        tag: node.localName,
        attributes: [...node.attributes].map(({ name, value }) => [name, value]).sort(),
        text: node.localName === 'text' ? node.textContent : ''
      }))
      const image = new Image(3508, 2480)
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = 3508
      canvas.height = 2480
      const context = canvas.getContext('2d')!
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      return {
        viewBox: parsed.documentElement.getAttribute('viewBox'),
        width: parsed.documentElement.getAttribute('width'),
        height: parsed.documentElement.getAttribute('height'),
        editorDetails: details(editorBlock),
        exportedDetails: details(exportedBlock!),
        samePixels: canvas.toDataURL('image/png') === exported.dataUrl,
        selectionExported: Boolean(parsed.querySelector('.selected-outline')),
        detailsY: Number(exportedBlock.querySelector('rect').getAttribute('y')),
        contentBottom: (() => {
          const area = element.shadowRoot.querySelector('.print-safe-area')
          return Number(area.getAttribute('y')) + Number(area.getAttribute('height'))
        })(),
        dataUrl: exported.dataUrl
      }
    })
    expect(result.viewBox).toBe('0 0 2376 1680')
    expect(result.width).toBe('297mm')
    expect(result.height).toBe('210mm')
    await testInfo.attach(`${name}-a4`, { body: Buffer.from(result.dataUrl.split(',')[1], 'base64'), contentType: 'image/png' })
    await page.screenshot({ path: `/private/tmp/cadle-a4-${name}-editor.png` })
    expect(result.editorDetails).toEqual(result.exportedDetails)
    expect(result.samePixels).toBe(true)
    expect(result.selectionExported).toBe(false)
    expect(result.contentBottom).toBeLessThanOrEqual(result.detailsY - 40)
    if (name === 'circuits') {
      const titles = await app.locator('text.shape-text').evaluateAll((elements) => elements
        .filter((element) => ['Verlichting leefruimte', 'Stopcontacten keuken'].includes(element.textContent?.trim() ?? ''))
        .map((element) => {
          const bounds = (element as SVGTextElement).getBBox()
          return { x: bounds.x, width: bounds.width, y: Number(element.getAttribute('y')) }
        }).sort((a, b) => a.x - b.x))
      expect(titles).toHaveLength(2)
      expect(titles[0].y).toBeCloseTo(titles[1].y)
      expect(titles[0].x + titles[0].width).toBeLessThan(titles[1].x)
    }
    // Also exercise a narrow viewport; paper geometry must stay identical.
    const before = await app.evaluate((element: any) => element.toSVG())
    await page.setViewportSize({ width: 1000, height: 800 })
    expect(await app.evaluate((element: any) => element.toSVG())).toBe(before)
    await page.setViewportSize({ width: 1440, height: 1100 })
  }
})
