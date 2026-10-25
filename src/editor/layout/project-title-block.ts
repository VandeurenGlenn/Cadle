import type { Project } from '../../types.js'
import { PAPER_WORLD_UNITS_PER_MM } from '../constants.js'
import { pageLayout } from './page-layout.js'

export const PROJECT_LOGO_SHAPE_ID = 'project-logo'
export const isProjectLogoVisible = (_project: Project | null): boolean => false

export type ProjectTitleBlockRow = { label: string; value: string; subValue?: string }
export type ProjectTitleBlockData = { rows: ProjectTitleBlockRow[]; missingRequiredFields: string[] }

const escapeText = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const upper = (value: string): string => value.toLocaleUpperCase('nl-BE')
const displayValue = (value: string | null | undefined): string => value?.trim() || '—'
const combinedValue = (...parts: Array<string | null | undefined>): string =>
  displayValue(parts.map((part) => part?.trim() ?? '').filter(Boolean).join(' '))
const formatDate = (): string =>
  new Intl.DateTimeFormat('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date())

const pageNumberLabel = (project: Project | null, currentPageKey: string, pageName: string): string => {
  const orderedPages = Object.entries(project?.pages ?? {}).sort(([, a], [, b]) =>
    (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.creationTime - b.creationTime
  )
  if (!orderedPages.length) return '1/1'
  let index = orderedPages.findIndex(([key]) => key === currentPageKey)
  if (index < 0 && pageName.trim()) index = orderedPages.findIndex(([, page]) => page.name === pageName)
  return `${Math.max(0, index) + 1}/${orderedPages.length}`
}

export const getProjectTitleBlockData = (project: Project | null, _pageName: string): ProjectTitleBlockData => ({
  rows: [
    { label: 'Klant', value: combinedValue(project?.customer?.name, project?.customer?.lastname) },
    {
      label: 'Adres',
      value: combinedValue(project?.address?.street, project?.address?.number),
      subValue: combinedValue(project?.address?.postalCode, project?.address?.city)
    },
    { label: 'Datum', value: formatDate() }
  ],
  missingRequiredFields: [project?.address?.street, project?.address?.number, project?.address?.postalCode, project?.address?.city]
    .map((value) => value?.trim() ?? '').filter((value) => !value)
})

export const getProjectTitleBlockBounds = (
  worldWidth: number,
  worldHeight: number,
  layoutScale = 1,
  originX = 0,
  originY = 0,
  marginMm?: number
) => pageLayout(worldWidth, worldHeight, marginMm, PAPER_WORLD_UNITS_PER_MM * layoutScale, originX, originY).details

export const getProjectLogoBounds = (project: Project | null, layoutScale = 1, originX = 0, originY = 0) => {
  const margin = 10 * PAPER_WORLD_UNITS_PER_MM * layoutScale
  const scale = Math.max(0.4, Math.min(2.5, project?.logoScale ?? 1))
  const width = 234 * layoutScale * scale
  const height = 48 * layoutScale * scale
  return {
    x: (project?.logoX ?? originX + margin + 125 * layoutScale) - width / 2,
    y: (project?.logoY ?? originY + margin + 32 * layoutScale) - height / 2,
    width,
    height
  }
}

// Preserve long names and addresses without crossing into the next field.
const textLines = (value: string, maxCharacters: number, maxLines: number): string[] => {
  const lines = ['']
  for (const word of upper(value).split(/\s+/).filter(Boolean)) {
    const last = lines.length - 1
    if (lines[last] && lines[last].length + word.length + 1 > maxCharacters && lines.length < maxLines) {
      lines.push(word)
    } else lines[last] += `${lines[last] ? ' ' : ''}${word}`
  }
  return lines
}

export const buildProjectTitleBlockMarkup = (
  project: Project | null,
  pageName: string,
  worldWidth: number,
  worldHeight: number,
  currentPageKey = '',
  layoutScale = 1,
  originX = 0,
  originY = 0,
  marginMm?: number
): string => {
  const mm = PAPER_WORLD_UNITS_PER_MM * layoutScale
  const bounds = getProjectTitleBlockBounds(worldWidth, worldHeight, layoutScale, originX, originY, marginMm)
  const { rows, missingRequiredFields } = getProjectTitleBlockData(project, pageName)
  const firstWidth = bounds.width * 0.32
  const secondWidth = bounds.width * 0.42
  const pageX = bounds.x + firstWidth + secondWidth
  const pad = 3 * mm
  const text = (x: number, y: number, value: string, width: number, size = 2.8, weight = 500) => {
    const fit = [...upper(value)].length * size * mm * 0.68 > width
      ? ` textLength="${width}" lengthAdjust="spacingAndGlyphs"` : ''
    return `<text x="${x}" y="${y}" font-size="${size * mm}" font-weight="${weight}"${fit}>${escapeText(upper(value))}</text>`
  }
  const field = (x: number, width: number, label: string, value: string, subValue?: string) => {
    const available = Math.max(mm, width - pad * 2)
    const lines = subValue ? [value, subValue] : textLines(value, Math.max(1, Math.floor(available / (2.8 * mm * 0.68))), 2)
    return text(x + pad, bounds.y + 5 * mm, label, available, 2.2, 700) + lines.map((line, index) =>
      text(x + pad, bounds.y + (11 + index * 4.5) * mm, line, available)
    ).join('')
  }
  const warning = missingRequiredFields.length
    ? text(bounds.x + firstWidth + pad, bounds.y + 25 * mm, 'Adresgegevens aanvullen', secondWidth - pad * 2, 2.2, 700)
    : ''
  return `<g class="project-title-block" data-project-title-block="true" font-family="Segoe UI, Arial, sans-serif" fill="#151110">
    <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="white" stroke="#3f352d" stroke-width="${0.25 * mm}"/>
    <path d="M ${bounds.x + firstWidth} ${bounds.y} v ${bounds.height} M ${pageX} ${bounds.y} v ${bounds.height}" fill="none" stroke="#3f352d" stroke-width="${0.2 * mm}"/>
    ${field(bounds.x, firstWidth, rows[0].label, rows[0].value)}
    ${text(bounds.x + pad, bounds.y + 25 * mm, `Datum  ${rows[2].value}`, firstWidth - pad * 2, 2.5)}
    ${field(bounds.x + firstWidth, secondWidth, 'Installatieadres', rows[1].value, rows[1].subValue)}
    ${warning}
    <g class="project-page-section" data-project-page-section="true">
      ${field(pageX, bounds.width - firstWidth - secondWidth, 'Tekening', displayValue(pageName))}
      ${text(pageX + pad, bounds.y + 25 * mm, `Blad ${pageNumberLabel(project, currentPageKey, pageName)}`, bounds.width - firstWidth - secondWidth - pad * 2, 2.5)}
    </g>
  </g>`
}
