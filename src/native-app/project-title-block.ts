import type { Project } from '../types.js'
import { PROJECT_TITLE_BLOCK_HEIGHT, PROJECT_TITLE_BLOCK_MARGIN, PROJECT_TITLE_BLOCK_WIDTH } from './constants.js'
import { getCachedSymbolSvg } from './symbol-svg-cache.js'

export const PROJECT_LOGO_SHAPE_ID = 'project-logo'

export const isProjectLogoVisible = (_project: Project | null): boolean => false

export type ProjectTitleBlockRow = {
  label: string
  value: string
}

export type ProjectTitleBlockData = {
  rows: ProjectTitleBlockRow[]
  missingRequiredFields: string[]
}

const escapeText = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const escapeAttribute = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

const toPrintUpper = (value: string): string => value.toLocaleUpperCase('nl-BE')

const displayValue = (value: string | null | undefined): string => value?.trim() || '—'

const combinedValue = (...parts: Array<string | null | undefined>): string =>
  displayValue(
    parts
      .map((part) => part?.trim() ?? '')
      .filter(Boolean)
      .join(' ')
  )

const addressValue = (project: Project | null): string => {
  if (!project) return '—'
  const streetLine = combinedValue(project.address?.street, project.address?.number)
  const cityLine = combinedValue(project.address?.postalCode, project.address?.city)
  return [streetLine, cityLine].filter((part) => part !== '—').join(' • ') || '—'
}

const formatDate = (): string =>
  new Intl.DateTimeFormat('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date())

const pageNumberLabel = (project: Project | null, currentPageKey: string, pageName: string): string => {
  const orderedPages = Object.entries(project?.pages ?? {}).sort(([, a], [, b]) => {
    const orderA = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER
    const orderB = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER
    return orderA - orderB || a.creationTime - b.creationTime
  })

  if (orderedPages.length === 0) return '1/1'

  let activeIndex = orderedPages.findIndex(([key]) => key === currentPageKey)
  if (activeIndex < 0 && pageName.trim()) {
    activeIndex = orderedPages.findIndex(([, page]) => page.name === pageName)
  }
  if (activeIndex < 0) activeIndex = 0

  return `${activeIndex + 1}/${orderedPages.length}`
}

export const getProjectTitleBlockData = (project: Project | null, pageName: string): ProjectTitleBlockData => {
  const rows: ProjectTitleBlockRow[] = [
    { label: 'Klant', value: combinedValue(project?.customer?.name, project?.customer?.lastname) },
    { label: 'Adres', value: addressValue(project) },
    { label: 'Datum', value: formatDate() }
  ]

  const missingRequiredFields = [
    project?.address?.street,
    project?.address?.number,
    project?.address?.postalCode,
    project?.address?.city
  ]
    .map((value) => value?.trim() ?? '')
    .filter((value) => value.length === 0)

  return { rows, missingRequiredFields }
}

export const getProjectTitleBlockBounds = (
  worldWidth: number,
  worldHeight: number,
  layoutScale = 1,
  originX = 0,
  originY = 0
) => {
  const scaledWidth = PROJECT_TITLE_BLOCK_WIDTH * layoutScale
  const scaledHeight = PROJECT_TITLE_BLOCK_HEIGHT * layoutScale
  const scaledMargin = PROJECT_TITLE_BLOCK_MARGIN * layoutScale
  return {
    x: originX + Math.max(0, worldWidth - scaledWidth - scaledMargin),
    y: originY + Math.max(0, worldHeight - scaledHeight - scaledMargin),
    width: scaledWidth,
    height: scaledHeight
  }
}

export const getProjectLogoBounds = (project: Project | null, layoutScale = 1, originX = 0, originY = 0) => {
  const scaledMargin = PROJECT_TITLE_BLOCK_MARGIN * layoutScale
  const logoBounds = {
    x: originX + scaledMargin,
    y: originY + scaledMargin,
    width: 250 * layoutScale,
    height: 64 * layoutScale
  }
  const logoScaleRaw =
    typeof project?.logoScale === 'number' && Number.isFinite(project.logoScale) ? project.logoScale : 1
  const logoScale = Math.max(0.4, Math.min(2.5, logoScaleRaw))
  const logoInnerWidth = (logoBounds.width - 16) * logoScale
  const logoInnerHeight = (logoBounds.height - 16) * logoScale
  const logoCenterX =
    typeof project?.logoX === 'number' && Number.isFinite(project.logoX)
      ? project.logoX
      : logoBounds.x + logoBounds.width / 2
  const logoCenterY =
    typeof project?.logoY === 'number' && Number.isFinite(project.logoY)
      ? project.logoY
      : logoBounds.y + logoBounds.height / 2

  return {
    x: logoCenterX - logoInnerWidth / 2,
    y: logoCenterY - logoInnerHeight / 2,
    width: logoInnerWidth,
    height: logoInnerHeight
  }
}

export const buildProjectTitleBlockMarkup = (
  project: Project | null,
  pageName: string,
  worldWidth: number,
  worldHeight: number,
  currentPageKey = '',
  layoutScale = 1,
  originX = 0,
  originY = 0
): string => {
  const cornerMargin = PROJECT_TITLE_BLOCK_MARGIN * layoutScale
  const logoBounds = {
    x: originX + cornerMargin,
    y: originY + cornerMargin,
    width: 250 * layoutScale,
    height: 64 * layoutScale
  }
  const pageBounds = {
    width: 190 * layoutScale,
    height: 64 * layoutScale,
    x: originX + Math.max(0, worldWidth - cornerMargin - 190 * layoutScale),
    y: originY + cornerMargin
  }

  const { rows, missingRequiredFields } = getProjectTitleBlockData(project, pageName)
  const pageIndicator = pageNumberLabel(project, currentPageKey, pageName)
  const pageTitle = displayValue(pageName)
  const bounds = getProjectTitleBlockBounds(worldWidth, worldHeight, layoutScale, originX, originY)
  const innerX = bounds.x + 14
  const warningY = bounds.y + 16
  const top = bounds.y + 36
  const labelX = innerX
  const valueX = innerX + 92
  const bottomY = bounds.y + bounds.height - 12
  const availableRowsHeight = Math.max(0, bottomY - top)
  const rowSpacing = rows.length > 1 ? availableRowsHeight / (rows.length - 1) : 0

  const rowsMarkup = rows
    .map((row, index) => {
      const y = top + index * rowSpacing
      return `
        <text x="${labelX}" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-size="${13 * layoutScale}" font-weight="700" fill="#2d231c">${escapeText(toPrintUpper(row.label))}</text>
        <text x="${valueX}" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-size="${13 * layoutScale}" font-weight="600" fill="#151110">${escapeText(toPrintUpper(row.value))}</text>
      `
    })
    .join('')

  const warningMarkup = missingRequiredFields.length
    ? `<text x="${bounds.x + bounds.width - 14 * layoutScale}" y="${warningY}" text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-size="${10 * layoutScale}" font-weight="700" fill="#b42318">ONTBREKENDE AREI-GEGEVENS</text>`
    : ''

  const pageMarkup = `
    <g class="project-page-section" data-project-page-section="true">
      <text x="${pageBounds.x + pageBounds.width}" y="${pageBounds.y + 24 * layoutScale}" text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-size="${8.5 * layoutScale}" font-weight="600" fill="#4a3c32">${escapeText(toPrintUpper(pageTitle))}</text>
      <text x="${pageBounds.x + pageBounds.width}" y="${pageBounds.y + 48 * layoutScale}" text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-size="${16 * layoutScale}" font-weight="700" fill="#151110">${escapeText(toPrintUpper(pageIndicator))}</text>
    </g>
  `.trim()

  if (!isProjectLogoVisible(project)) {
    return `
      ${pageMarkup}
      <g class="project-title-block" data-project-title-block="true">
        <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" rx="${7 * layoutScale}" ry="${7 * layoutScale}" fill="none" stroke="#3f352d" stroke-width="${1.4 * layoutScale}"/>
        ${warningMarkup}
        ${rowsMarkup}
      </g>
    `.trim()
  }

  const logoUrl = project?.logoUrl?.trim() ?? ''
  const logoColor = project?.logoColor?.trim() ?? ''
  const logoPlacement = getProjectLogoBounds(project, layoutScale, originX, originY)
  const logoX = logoPlacement.x
  const logoY = logoPlacement.y
  const logoInnerWidth = logoPlacement.width
  const logoInnerHeight = logoPlacement.height
  const logoSvg = logoUrl ? getCachedSymbolSvg(logoUrl) : null

  const logoContentMarkup = logoUrl
    ? logoSvg
      ? `<svg x="${logoX}" y="${logoY}" width="${logoInnerWidth}" height="${logoInnerHeight}" viewBox="${escapeAttribute(logoSvg.viewBox)}" preserveAspectRatio="xMidYMid meet" style="${logoColor ? `--symbol-fill:${escapeAttribute(logoColor)};--symbol-stroke:${escapeAttribute(logoColor)};` : ''}">${logoSvg.inner}</svg>`
      : `<image href="${escapeAttribute(logoUrl)}" x="${logoX}" y="${logoY}" width="${logoInnerWidth}" height="${logoInnerHeight}" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="${logoBounds.x + 14}" y="${logoBounds.y + 39}" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="700" fill="#2d231c">LOGO</text>`

  const logoMarkup = `
    <g class="project-logo-section" data-project-logo-section="true" data-shape-id="${PROJECT_LOGO_SHAPE_ID}">
      ${logoContentMarkup}
    </g>
  `.trim()

  return `
    ${logoMarkup}
    ${pageMarkup}
    <g class="project-title-block" data-project-title-block="true">
      <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" rx="${7 * layoutScale}" ry="${7 * layoutScale}" fill="none" stroke="#3f352d" stroke-width="${1.4 * layoutScale}"/>
      ${warningMarkup}
      ${rowsMarkup}
    </g>
  `.trim()
}
