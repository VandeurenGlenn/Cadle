import { expect, test } from '@playwright/test'
import { jsPDF } from 'jspdf'

const createProject = async (page: import('@playwright/test').Page, name: string) => {
  await page.goto('/#!/create-project')
  const values: Record<string, string> = {
    'Project name': name, 'Page name': 'Existing plan', 'Customer name': 'Ada',
    'Customer last name': 'Tester', Name: 'E2E', 'Last name': 'Installer', Company: 'Cadle Test',
    Street: 'Teststraat', 'House number': '1', 'Postal code': '1000', City: 'Brussel'
  }
  for (const [label, value] of Object.entries(values)) {
    await page.locator(`create-project-field input[data-field="${label}"]`).fill(value)
  }
  await page.locator('create-project-field .actions custom-button').click()
  await expect(page).toHaveURL(/#!\/editor\/model/)
}

const choosePdf = async (page: import('@playwright/test').Page, name: string, buffer: Buffer) => {
  await page.locator('project-actions custom-button[label="File"]').click()
  await page.locator('project-actions custom-list-item[data-group="import"]').click()
  const chooserPromise = page.waitForEvent('filechooser')
  await page.locator('project-actions custom-list-item[data-action="import-pdf"]').click()
  const chooser = await chooserPromise
  await chooser.setFiles({ name, mimeType: 'application/pdf', buffer })
  const importer = page.locator('pdf-importer')
  await expect(importer).toBeVisible()
  return importer
}

const openPdfImporter = async (page: import('@playwright/test').Page, name: string, buffer: Buffer) => {
  const importer = await choosePdf(page, name, buffer)
  await expect(importer.locator('.page-item')).toHaveCount(1)
  return importer
}

test('imports a real vector PDF as reviewed editable Cadle objects', async ({ page }) => {
  test.setTimeout(90_000)
  await createProject(page, 'E2E PDF conversion')

  const source = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  source.setLineWidth(3)
  source.rect(70, 90, 430, 580)
  source.setFontSize(12)
  source.text('Kitchen', 110, 140)
  source.text('stopcontact', 170, 230)
  const pdfBuffer = Buffer.from(source.output('arraybuffer'))

  const importer = await openPdfImporter(page, 'legacy-house.pdf', pdfBuffer)
  const initialMemory = await importer.evaluate((element: any) => ({
    retainedCanvas: Boolean(element.pages[0]?.canvas),
    previewPixels: element.pages[0]?.width * element.pages[0]?.height
  }))
  expect(initialMemory.retainedCanvas).toBe(false)
  expect(initialMemory.previewPixels).toBeLessThanOrEqual(240_000)
  const primaryAction = importer.locator('cadle-header custom-button').last()
  await expect(primaryAction).toContainText('Analyze 1 Page')
  await primaryAction.click()
  await expect(importer.getByText('Review before creating')).toBeVisible()
  await expect(importer.getByText('Original', { exact: true })).toBeVisible()
  await expect(importer.getByText('Cadle conversion review', { exact: true })).toBeVisible()
  const reviewedMemory = await importer.evaluate((element: any) => ({
    retainedCanvas: Boolean(element.pages[0]?.canvas),
    retainedProcessedCanvas: Boolean(element.pages[0]?.analysis?.processedCanvas),
    previewPixels: element.pages[0]?.width * element.pages[0]?.height
  }))
  expect(reviewedMemory).toEqual({ retainedCanvas: false, retainedProcessedCanvas: false, previewPixels: initialMemory.previewPixels })
  await expect(primaryAction).toContainText('Create 1 Page')
  await primaryAction.click()
  await expect(importer).toHaveCount(0)

  const imported = await page.locator('app-shell').evaluate((shell: any) => {
    const pageEntry = Object.values(shell.project.pages).find((entry: any) => entry.name === 'legacy-house') as any
    const native = pageEntry?.schema?.objects?.find((entry: any) => entry.kind === 'cadle-native-svg-document')
    return {
      pageCount: Object.keys(shell.project.pages).length,
      pageName: pageEntry?.name,
      shapes: native?.payload?.shapes?.map((shape: any) => ({ kind: shape.kind, locked: shape.locked })) ?? []
    }
  })
  expect(imported.pageCount).toBe(2)
  expect(imported.pageName).toBe('legacy-house')
  expect(imported.shapes.some((shape: any) => shape.kind === 'wall')).toBe(true)
  expect(imported.shapes.some((shape: any) => shape.kind === 'symbol')).toBe(true)
  expect(imported.shapes.some((shape: any) => shape.kind === 'image' && shape.locked)).toBe(true)
})

test('straightens a raster PDF and creates a reviewed door bound to its wall', async ({ page }) => {
  test.setTimeout(90_000)
  await createProject(page, 'E2E raster PDF conversion')
  const raster = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 800
    const context = canvas.getContext('2d')!
    context.fillStyle = '#eeeeee'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.strokeStyle = '#202020'
    context.lineCap = 'round'
    context.lineWidth = 6
    context.beginPath()
    context.moveTo(70, 350)
    context.lineTo(530, 350)
    context.stroke()
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(270, 350)
    context.lineTo(320, 405)
    context.stroke()
    return canvas.toDataURL('image/png')
  })
  const source = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  source.addImage(raster, 'PNG', 0, 0, 595, 842)
  const importer = await openPdfImporter(page, 'raster-door.pdf', Buffer.from(source.output('arraybuffer')))
  await importer.locator('label.scan-ocr input').uncheck()
  await importer.locator('label.scan-symbols input').uncheck()
  const primaryAction = importer.locator('cadle-header custom-button').last()
  await primaryAction.click()
  await expect(importer.getByText('Review before creating')).toBeVisible()
  await expect(primaryAction).toContainText(/Review \d+ Item/)
  const doorChoice = importer.locator('.line-review.check select').first()
  await expect(doorChoice).toHaveValue('door')
  await importer.getByRole('button', { name: /Confirm door suggestion/ }).click()
  await expect(primaryAction).toContainText('Create 1 Page')
  const comparisonImages = importer.locator('.comparison-preview img')
  await expect(comparisonImages).toHaveCount(2)
  expect(await comparisonImages.nth(0).getAttribute('src')).not.toBe(await comparisonImages.nth(1).getAttribute('src'))
  await primaryAction.click()
  await expect(importer).toHaveCount(0)

  const shapes = await page.locator('app-shell').evaluate((shell: any) => {
    const pageEntry = Object.values(shell.project.pages).find((entry: any) => entry.name === 'raster-door') as any
    return pageEntry.schema.objects[0].payload.shapes
  })
  const wall = shapes.find((shape: any) => shape.kind === 'wall')
  const door = shapes.find((shape: any) => shape.kind === 'door')
  expect(wall).toBeTruthy()
  expect(door).toBeTruthy()
  expect(door.wallId).toBe(wall.id)
})

test('rejects PDFs above the safe page limit before rendering previews', async ({ page }) => {
  test.setTimeout(90_000)
  await createProject(page, 'E2E PDF limits')
  const source = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  for (let index = 1; index < 101; index += 1) source.addPage()
  const importer = await choosePdf(page, 'too-many-pages.pdf', Buffer.from(source.output('arraybuffer')))
  await expect(importer.getByRole('alert')).toContainText('more than 100 pages')
  await expect(importer.locator('.page-item')).toHaveCount(0)
})

test('cancels a multi-page analysis without closing the importer', async ({ page }) => {
  test.setTimeout(90_000)
  await createProject(page, 'E2E PDF cancellation')
  const raster = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1000
    canvas.height = 1400
    const context = canvas.getContext('2d')!
    context.fillStyle = 'white'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.strokeStyle = 'black'
    context.lineWidth = 8
    for (let y = 100; y < 1300; y += 80) {
      context.beginPath()
      context.moveTo(80, y)
      context.lineTo(920, y)
      context.stroke()
    }
    return canvas.toDataURL('image/png')
  })
  const source = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  for (let index = 0; index < 8; index += 1) {
    if (index) source.addPage()
    source.addImage(raster, 'PNG', 0, 0, 595, 842)
  }
  const importer = await choosePdf(page, 'cancel-analysis.pdf', Buffer.from(source.output('arraybuffer')))
  await expect(importer.locator('.page-item')).toHaveCount(8)
  await importer.locator('label.scan-ocr input').uncheck()
  await importer.locator('label.scan-symbols input').uncheck()
  const primaryAction = importer.locator('cadle-header custom-button').last()
  await primaryAction.click()
  const cancel = importer.getByRole('button', { name: 'Cancel operation' })
  await expect(cancel).toBeVisible()
  await cancel.click()
  await expect(cancel).toHaveCount(0)
  await expect(importer).toBeVisible()
  await expect(primaryAction).toContainText('Analyze 8 Pages')
})
