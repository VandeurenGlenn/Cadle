import { expect, test } from '@playwright/test'
import { buildProjectTitleBlockMarkup, getProjectTitleBlockBounds } from '../../src/editor/layout/project-title-block.ts'
import type { Project } from '../../src/types.ts'

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
    ['00000000-0000-4000-8000-000000000104', 'circuits', 'ONE-WIRE CIRCUITS'],
    ['00000000-0000-4000-8000-000000000105', 'kitchen', 'ONE-WIRE CIRCUITS KITCHEN']
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
    await app.locator('.project-title-block').screenshot({ path: `/private/tmp/cadle-titleblock-${name}.png` })
    expect(result.editorDetails).toEqual(result.exportedDetails)
    expect(result.editorStrokes.length).toBeGreaterThan(0)
    expect(result.editorStrokes.every(({ width }) => typeof width === 'string' && width.length > 0)).toBe(true)
    expect(result.exportedStrokes).toEqual(result.editorStrokes)
    expect(result.samePixels).toBe(true)
    expect(result.selectionExported).toBe(false)
    expect(result.contentBottom).toBeLessThanOrEqual(result.detailsY - 24)
    expect(result.contentBottom).toBe(1464)
    if (name === 'topology') {
      const clearance = await app.locator('g.shape-symbol').evaluateAll((groups) => groups.flatMap((group) => {
        const svg = group.querySelector('svg')
        const bounds = svg?.getBBox()
        const matrix = svg?.getScreenCTM()
        if (!bounds || !matrix) return []
        const right = new DOMPoint(bounds.x + bounds.width, bounds.y).matrixTransform(matrix).x
        return [...group.querySelectorAll('.onewire-technical-annotation')]
          .filter((label) => label.getAttribute('text-anchor') === 'start')
          .map((label) => label.getBoundingClientRect().left - right)
      }))
      expect(clearance.length).toBeGreaterThan(0)
      expect(Math.min(...clearance)).toBeGreaterThan(0)
      await expect(app.locator('.shape-text').filter({ hasText: /^AARDING$/ })).toHaveCount(0)
      const titleLayout = await app.evaluate((element) => {
        const root = element.shadowRoot!
        const names = [...root.querySelectorAll<SVGTextElement>('.shape-text')]
          .filter((text) => ['Hoofddiff.', 'Hoofdautomaat'].includes(text.textContent?.trim() ?? ''))
        const annotations = [...root.querySelectorAll<SVGTextElement>('.onewire-technical-annotation')]
        return names.map((name) => {
          const box = name.getBoundingClientRect()
          const poles = annotations.find((label) => /^\dP$/.test(label.textContent?.trim() ?? '') &&
            Math.abs(Number(label.getAttribute('x')) - Number(name.getAttribute('x'))) < 1e-6 &&
            Math.abs(Number(label.getAttribute('y')) - Number(name.getAttribute('y')) - 29) < 1e-6)
          const others = [...root.querySelectorAll<SVGTextElement>('.shape-text,.onewire-technical-annotation')].filter((text) => text !== name)
          const overlaps = others.filter((text) => {
            const other = text.getBoundingClientRect()
            return box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top
          }).map((text) => text.textContent)
          return { name: name.textContent, aligned: Boolean(poles), overlaps }
        })
      })
      expect(titleLayout).toHaveLength(2)
      expect(titleLayout.every(({ aligned }) => aligned)).toBe(true)
      expect(titleLayout.flatMap(({ overlaps }) => overlaps)).toEqual([])
      const clip = await app.locator('svg.stage').evaluate((svg) => {
        const boxes = [...svg.querySelectorAll('.shape-line,.shape-symbol,.shape-text')].map((node) => node.getBoundingClientRect())
        const x = Math.min(...boxes.map((box) => box.left)) - 24
        const y = Math.min(...boxes.map((box) => box.top)) - 24
        return { x, y, width: Math.max(...boxes.map((box) => box.right)) - x + 24, height: Math.max(...boxes.map((box) => box.bottom)) - y + 24 }
      })
      await page.screenshot({ path: '/private/tmp/cadle-topology-labels.png', clip })
    }
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
    if (name === 'circuits' || name === 'kitchen') {
      const gaps = await app.evaluate((element) => {
        const root = element.shadowRoot!
        return [...root.querySelectorAll<SVGTextElement>('text.shape-text')]
          .filter((text) => /^\dP$/.test(text.textContent?.trim() ?? ''))
          .map((poles) => {
            const groupId = poles.parentElement!.getAttribute('data-group-id')
            const groups = [...root.querySelectorAll<SVGGElement>('[data-group-id]')].filter((group) => group.getAttribute('data-group-id') === groupId)
            const symbol = groups.flatMap((group) => [...group.querySelectorAll<SVGSVGElement>('g.shape-symbol svg')])
              .find((svg) => svg.getAttribute('viewBox') === '0 0 28.783 28.8265')!
            const cable = groups.flatMap((group) => [...group.querySelectorAll<SVGTextElement>('text.shape-text')])
              .find((text) => text.textContent?.includes('mm²'))!
            const axis = new DOMPoint(15.3836, 28.47).matrixTransform(symbol.getScreenCTM()!).x
            const cableBox = cable.getBoundingClientRect()
            const rowSymbols = [...root.querySelectorAll<SVGSVGElement>('g.shape-symbol svg')]
              .filter((svg) => svg !== symbol && svg.getAttribute('viewBox') !== '0 0 24 54')
              .map((svg) => svg.getBoundingClientRect())
              .filter((box) => box.bottom < symbol.getBoundingClientRect().top && box.left >= axis - 16 && box.right <= axis + 100)
            return {
              poles: symbol.getBoundingClientRect().left - poles.getBoundingClientRect().right,
              conductor: cableBox.left - axis,
              rows: rowSymbols.length ? cableBox.top - Math.max(...rowSymbols.map((box) => box.bottom)) : 100
            }
          })
      })
      expect(gaps.length).toBeGreaterThan(0)
      for (const gap of gaps) {
        expect(gap.poles).toBeGreaterThan(4)
        expect(gap.conductor).toBeGreaterThan(4)
        expect(gap.rows).toBeGreaterThan(4)
      }
      if (name === 'kitchen') {
        const clip = await app.locator('svg.stage').evaluate((svg) => {
          const boxes = [...svg.querySelectorAll('.shape-line,.shape-symbol,.shape-text')].map((node) => node.getBoundingClientRect())
          const x = Math.min(...boxes.map((box) => box.left)) - 24
          const y = Math.min(...boxes.map((box) => box.top)) - 24
          return { x, y, width: Math.max(...boxes.map((box) => box.right)) - x + 24, height: Math.max(...boxes.map((box) => box.bottom)) - y + 24 }
        })
        await page.screenshot({ path: '/private/tmp/cadle-cable-clearance.png', clip })
      }
    }
    // Also exercise a narrow viewport; paper geometry must stay identical.
    const before = await app.evaluate((element: any) => element.toSVG())
    await page.setViewportSize({ width: 1000, height: 800 })
    expect(await app.evaluate((element: any) => element.toSVG())).toBe(before)
    await page.setViewportSize({ width: 1440, height: 1100 })
  }
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`paper symbols and text stay legible in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await page.addInitScript(() => localStorage.setItem('cadle-symbol-stroke-width', '0.65'))
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.goto('/?fixture=priority-suite#!/projects')
    await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
    await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000102"]').click()
    const app = page.locator('cadle-app')
    await app.evaluate(async (element: any) => { await element.exportA4PNG() })
    const metrics = await app.evaluate((element) => {
      const root = element.shadowRoot!
      const paper = root.querySelector('.project-title-block rect') as SVGRectElement
      const bounds = paper.getBBox()
      const labels = [...root.querySelectorAll<SVGTextElement>('.project-title-block text')]
      const symbols = [...root.querySelectorAll<SVGSVGElement>('g.shape-symbol:not(.symbol-preview) > svg')]
      const world = root.querySelector('.world') as SVGGElement
      const zoom = Math.hypot(world.getScreenCTM()!.a, world.getScreenCTM()!.b)
      const physicalStrokes = symbols.map((svg) => {
        const dims = svg.getAttribute('viewBox')!.split(/\s+/).map(Number)
        return Number(svg.style.getPropertyValue('--symbol-stroke-width')) * Number(svg.getAttribute('width')) / Math.max(dims[2], dims[3])
      })
      return {
        physicalStrokes, zoom,
        symbolDetails: symbols.map((svg) => ({ id: svg.parentElement?.getAttribute('data-shape-id'), viewBox: svg.getAttribute('viewBox'), width: svg.getAttribute('width'), stroke: svg.style.getPropertyValue('--symbol-stroke-width') })),
        textColors: [...root.querySelectorAll('.shape-text')].map((label) => getComputedStyle(label).fill),
        allDetailsInside: labels.every((label) => {
          const box = label.getBBox()
          return box.x >= bounds.x && box.y >= bounds.y && box.x + box.width <= bounds.x + bounds.width && box.y + box.height <= bounds.y + bounds.height
        }),
        gridMinor: getComputedStyle(root.querySelector('.grid')!).getPropertyValue('--cadle-grid-minor').trim()
      }
    })
    expect(metrics.physicalStrokes.length).toBeGreaterThan(0)
    expect(Math.min(...metrics.physicalStrokes), JSON.stringify(metrics.symbolDetails)).toBeCloseTo(2)
    expect(Math.min(...metrics.physicalStrokes) * metrics.zoom).toBeGreaterThanOrEqual(0.8)
    expect(metrics.textColors.length).toBeGreaterThan(0)
    expect(metrics.textColors.every((color) => color === 'rgb(0, 0, 0)')).toBe(true)
    expect(metrics.allDetailsInside).toBe(true)
    expect(metrics.gridMinor).toBe('rgba(80, 96, 112, 0.10)')
    await page.screenshot({ path: `/private/tmp/cadle-legibility-${colorScheme}.png` })
  })
}

test('title fields wrap long names and addresses without overlapping on either A4 orientation', async ({ page }) => {
  const projects = [
    {
      customer: { name: 'Sofie', lastname: 'Van den Broeck' },
      address: { street: 'Kerkstraat', number: '24 bus 3', postalCode: '9000', city: 'Gent' }
    },
    {
      customer: { name: 'Vereniging van mede-eigenaars', lastname: 'Residentie De Groene Binnentuinen' },
      address: { street: 'Burgemeester Charles & Marie de Kerchovelaan', number: '124 bus 12', postalCode: '9830', city: 'Sint-Martens-Latem' }
    }
  ]
  for (const [width, height] of [[2376, 1680], [1680, 2376]]) {
    for (const [index, data] of projects.entries()) {
      const title = index ? 'Situatieplan gelijkvloers en technische bijgebouwen' : 'Situatieplan'
      const markup = buildProjectTitleBlockMarkup(data as Project, title, width, height)
      const bounds = getProjectTitleBlockBounds(width, height)
      await page.setContent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width / 2}" viewBox="0 ${bounds.y - 8} ${width} ${bounds.height + 16}">${markup}</svg>`)
      const violations = await page.locator('[data-title-field]').evaluateAll((fields) => fields.flatMap((field) => {
        const x = Number(field.getAttribute('data-field-x'))
        const width = Number(field.getAttribute('data-field-width'))
        const paper = document.querySelector('.project-title-block rect') as SVGRectElement
        const bounds = paper.getBBox()
        const texts = [...field.querySelectorAll('text')]
        const boxes = texts.map((text) => text.getBBox())
        return texts.flatMap((text, index) => {
          const box = boxes[index]
          const outside = box.x < x || box.x + box.width > x + width || box.y < bounds.y || box.y + box.height > bounds.y + bounds.height
          const overlap = boxes.slice(index + 1).some((other) => box.x < other.x + other.width && box.x + box.width > other.x && box.y < other.y + other.height && box.y + box.height > other.y)
          return outside || overlap ? [text.textContent] : []
        })
      }))
      expect(violations).toEqual([])
      await expect(page.locator('[data-title-field="client"]')).toContainText(data.customer.lastname)
      await expect(page.locator('[data-title-field="address"]')).toContainText(data.address.city)
      await page.locator('svg').screenshot({ path: `/private/tmp/cadle-title-${width}-${index}.png` })
    }
  }
})
