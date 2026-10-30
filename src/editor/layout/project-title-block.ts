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

// Reflow values before fitting exceptional long lines. Preserve the spelling
// entered by the user; capitals are reserved for field headings.
const textLines = (value: string, maxCharacters: number, maxLines: number): string[] => {
  const lines = ['']
  for (const word of value.split(/\s+/).filter(Boolean)) {
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
  // Date and sheet number have a fixed paper width; the address gets the
  // largest flexible field on both portrait and landscape sheets.
  const metaWidth = 32 * mm
  const pageWidth = Math.max(50 * mm, Math.min(76 * mm, bounds.width * 0.27))
  const identityWidth = Math.max(mm, bounds.width - pageWidth - metaWidth)
  const clientWidth = identityWidth * 0.42
  const addressWidth = identityWidth - clientWidth
  const addressX = bounds.x + clientWidth
  const pageX = addressX + addressWidth
  const metaX = pageX + pageWidth
  const pad = 2.5 * mm
  const text = (x: number, y: number, value: string, width: number, size = 2.6, weight = 400, anchor = 'start', muted = false) => {
    const fit = [...value].length * size * mm * 0.68 > width
      ? ` textLength="${width}" lengthAdjust="spacingAndGlyphs"` : ''
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size * mm}" font-weight="${weight}" fill="${muted ? '#555555' : '#111111'}"${fit}>${escapeText(value)}</text>`
  }
  const field = (key: string, x: number, width: number, label: string, values: string[], weight = 400) => {
    const available = Math.max(mm, width - pad * 2)
    const wrap = (size: number) => values.flatMap((value) => textLines(value, Math.max(1, Math.floor(available / (size * mm * 0.68))), 3))
    const size = wrap(2.6).length > 2 ? 2.3 : 2.6
    const wrapped = wrap(size)
    const lines = wrapped.length > 3 ? [wrapped[0], wrapped[1], wrapped.slice(2).join(' ')] : wrapped
    const firstBaseline = 6.8
    return `<g data-title-field="${key}" data-field-x="${x}" data-field-width="${width}">
      <title>${escapeText(values.join(', '))}</title>
      ${text(x + pad, bounds.y + 3 * mm, upper(label), available, 1.8, 600, 'start', true)}
      ${lines.map((line, index) => text(x + pad, bounds.y + (firstBaseline + index * 3) * mm, line, available, size, weight)).join('')}
    </g>`
  }
  const addressLabel = missingRequiredFields.length ? 'Installatieadres · aanvullen' : 'Installatieadres'
  const metaAvailable = metaWidth - pad * 2
  return `<g class="project-title-block" data-project-title-block="true" font-family="Segoe UI, Arial, sans-serif" fill="#111111">
    <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="white" stroke="#555555" stroke-width="${0.18 * mm}"/>
    <path d="M ${bounds.x} ${bounds.y} h ${bounds.width}" fill="none" stroke="#111111" stroke-width="${0.3 * mm}"/>
    <path d="M ${addressX} ${bounds.y} v ${bounds.height} M ${pageX} ${bounds.y} v ${bounds.height} M ${metaX} ${bounds.y} v ${bounds.height} M ${metaX} ${bounds.y + 7 * mm} h ${metaWidth}" fill="none" stroke="#999999" stroke-width="${0.13 * mm}"/>
    ${field('client', bounds.x, clientWidth, rows[0].label, [rows[0].value])}
    ${field('address', addressX, addressWidth, addressLabel, [rows[1].value, rows[1].subValue ?? '—'])}
    <g class="project-page-section" data-project-page-section="true">
      ${field('drawing', pageX, pageWidth, 'Tekening', [displayValue(pageName)], 600)}
    </g>
    <g data-title-field="metadata" data-field-x="${metaX}" data-field-width="${metaWidth}">
      ${text(metaX + pad, bounds.y + 4.5 * mm, 'DATUM', metaAvailable * 0.3, 1.8, 600, 'start', true)}
      ${text(metaX + metaWidth - pad, bounds.y + 4.5 * mm, rows[2].value, metaAvailable * 0.68, 2.3, 400, 'end')}
      ${text(metaX + pad, bounds.y + 11 * mm, 'BLAD', metaAvailable * 0.3, 1.8, 600, 'start', true)}
      ${text(metaX + metaWidth - pad, bounds.y + 11 * mm, pageNumberLabel(project, currentPageKey, pageName), metaAvailable * 0.65, 2.8, 600, 'end')}
    </g>
  </g>`
}
