import { expect, test } from '@playwright/test'
import { PAGE_DETAILS_GAP_MM } from '../../src/editor/layout/page-layout.ts'
import { PAPER_WORLD_UNITS_PER_MM } from '../../src/editor/constants.ts'

test('editor, SVG and A4 PNG share the sheet geometry and details strip', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('cadle-symbol-stroke-width', '1.4'))
  await page.route('**/symbols/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100))
    await route.continue()
  })
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
    await expect(app.locator('svg.stage .project-title-block')).toContainText(title, { ignoreCase: true })
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
      const symbolStrokes = (root: ParentNode) => [...root.querySelectorAll<SVGGElement>('g.shape-symbol[data-shape-id]')]
        .map((node) => ({
          id: node.getAttribute('data-shape-id'),
          width: node.querySelector('svg')?.style.getPropertyValue('--symbol-stroke-width')
        })).sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''))
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
        editorStrokes: symbolStrokes(element.shadowRoot),
        exportedStrokes: symbolStrokes(parsed),
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
    if (name === 'topology') {
      const cableClearance = await app.evaluate((element: HTMLElement) => {
        const root = element.shadowRoot!
        const caption = [...root.querySelectorAll('text.shape-text')].find((text) => text.textContent?.includes('4x10 mm² EXVB'))!
        const marker = root.querySelector('.connection-cable-marker')!
        return caption.getBoundingClientRect().left - marker.getBoundingClientRect().right
      })
      expect(cableClearance).toBeGreaterThan(6)
    }
    if (name === 'topology' || name === 'circuits') {
      const clip = await app.locator('g.shape-symbol').evaluateAll((symbols) => {
        const boxes = symbols.map((symbol) => symbol.getBoundingClientRect())
        const x = Math.max(0, Math.min(...boxes.map((box) => box.left)) - 60)
        const y = Math.max(0, Math.min(...boxes.map((box) => box.top)) - 60)
        return { x, y,
          width: Math.min(innerWidth, Math.max(...boxes.map((box) => box.right)) + 100) - x,
          height: Math.min(innerHeight, Math.max(...boxes.map((box) => box.bottom)) + 60) - y }
      })
      await page.screenshot({ path: `/private/tmp/cadle-${name}-proportions.png`, clip })
    }
    expect(result.editorDetails).toEqual(result.exportedDetails)
    expect(result.editorStrokes.length).toBeGreaterThan(0)
    expect(result.editorStrokes.every(({ width }) => typeof width === 'string' && width.length > 0)).toBe(true)
    expect(result.exportedStrokes).toEqual(result.editorStrokes)
    expect(result.samePixels).toBe(true)
    expect(result.selectionExported).toBe(false)
    expect(result.contentBottom).toBeLessThanOrEqual(result.detailsY - PAGE_DETAILS_GAP_MM * PAPER_WORLD_UNITS_PER_MM)
    if (name === 'circuits') {
      const titles = await app.locator('text.shape-text').evaluateAll((elements) => elements
        .filter((element) => ['Verlichting leefruimte', 'Stopcontacten keuken'].includes(element.textContent?.trim() ?? ''))
        .map((element) => element.textContent))
      expect(titles).toHaveLength(0)
    }
    // Also exercise a narrow viewport; paper geometry must stay identical.
    const before = await app.evaluate((element: any) => element.toSVG())
    await page.setViewportSize({ width: 1000, height: 800 })
    expect(await app.evaluate((element: any) => element.toSVG())).toBe(before)
    await page.setViewportSize({ width: 1440, height: 1100 })
  }
})
