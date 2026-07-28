import type { Project } from '../types.js'
import { getCachedSymbolSvg } from './symbol-svg-cache.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const e = (v: string | null | undefined): string =>
  (v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const ea = (v: string): string =>
  e(v).replaceAll('"', '&quot;').replaceAll("'", '&apos;')

const upper = (v: string | null | undefined): string => e((v ?? '').trim().toUpperCase())

const val = (v: string | null | undefined): string => upper(v) || '—'

const tx = (
  x: number,
  y: number,
  content: string,
  {
    size = 2.8,
    weight = 400,
    fill = '#151110',
    anchor = 'start'
  }: { size?: number; weight?: number | string; fill?: string; anchor?: string } = {}
): string =>
  `<text x="${x}" y="${y}" font-family="Segoe UI,Arial,sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${content}</text>`

const PAGE_TOP = 4
const PAGE_LEFT = 4
const PAGE_RIGHT = 293
const PAGE_WIDTH = PAGE_RIGHT - PAGE_LEFT
const COL = 148.5

const hline = (y: number, x1 = PAGE_LEFT, x2 = PAGE_RIGHT, color = '#3f352d', w = 0.4): string =>
  `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="${w}"/>`

const vline = (x: number, y1: number, y2: number, color = '#d4c8be', w = 0.3): string =>
  `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${color}" stroke-width="${w}"/>`

const sectionBar = (y: number, left: string, right?: string): string => `
  <rect x="${PAGE_LEFT}" y="${y}" width="${PAGE_WIDTH}" height="6" fill="#f0ebe5"/>
  ${tx(PAGE_LEFT + 3, y + 4.3, left, { size: 2.5, weight: 700, fill: '#2d231c' })}
  ${right ? vline(COL, y, y + 6, '#c8b9ad', 0.3) : ''}
  ${right ? tx(COL + 3, y + 4.3, right, { size: 2.5, weight: 700, fill: '#2d231c' }) : ''}`

const fieldRow = (x: number, y: number, label: string, value: string): string =>
  `${tx(x, y, label, { size: 2.3, weight: 700, fill: '#7d736d' })}${tx(x + 22, y, value, { size: 2.8, weight: 500, fill: '#151110' })}`

const inputBox = (x: number, y: number, w: number, h: number, label: string, value: string): string =>
  `${tx(x, y, label, { size: 2.2, weight: 700, fill: '#7d736d' })}
  <rect x="${x}" y="${y + 2.5}" width="${w}" height="${h}" fill="#fbf9f7" stroke="#c8b9ad" stroke-width="0.35" rx="1.5"/>
  ${value !== '—' ? tx(x + 3, y + 2.5 + h * 0.64, value, {
    size: 2.8,
    weight: 600,
    fill: '#151110'
  }) : ''}`

const sigBox = (
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  name: string,
  signatureUrl: string,
  role: 'installer' | 'customer'
): string => {
  const signatureMarkup = signatureUrl
    ? `<image data-project-signature="${role}" href="${ea(signatureUrl)}" x="${x + 12}" y="${y + 10}" width="${w - 24}" height="${h - 23}" preserveAspectRatio="xMidYMid meet"/>`
    : ''
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fafafa" stroke="#3f352d" stroke-width="0.4" rx="1.5"/>
  ${tx(x + w / 2, y + 6, title, { size: 2.4, weight: 700, fill: '#2d231c', anchor: 'middle' })}
  ${signatureMarkup}
  <line x1="${x + 8}" y1="${y + h - 8}" x2="${x + w - 8}" y2="${y + h - 8}" stroke="#c8b9ad" stroke-width="0.5"/>
  ${tx(x + w / 2, y + h - 3, name, { size: 2.3, weight: 400, fill: '#9e8e84', anchor: 'middle' })}`
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const buildIntroPageSvg = (project: Project | null): string => {
  const customerName = val([project?.customer?.name, project?.customer?.lastname].filter(Boolean).join(' '))
  const installerName = val([project?.installer?.name, project?.installer?.lastname].filter(Boolean).join(' '))
  const company = val(project?.company)
  const btw = val(project?.installer?.btw)
  const eanCode = val(project?.eanCode)
  const mainFuseA = typeof project?.mainFuseA === 'number' ? `${project.mainFuseA} A` : '—'
  const distributor = val(project?.electricalProfile?.distributor)
  const supplyConfiguration = val(project?.electricalProfile?.supplyConfiguration)
  const earthingSystem =
    project?.electricalProfile?.earthingSystem && project.electricalProfile.earthingSystem !== 'unknown'
      ? upper(project.electricalProfile.earthingSystem)
      : '—'
  const mainDifferential = project?.electricalProfile?.boards?.[0]?.mainDifferential
  const mainDifferentialLabel = mainDifferential
    ? `${mainDifferential.ratedCurrentA} A · ${mainDifferential.sensitivityMa} mA · ${mainDifferential.poles}P${
        mainDifferential.type ? ` · TYPE ${mainDifferential.type}` : ''
      }`
    : '—'
  const logoUrl = project?.logoUrl?.trim() ?? ''
  const installerSignatureUrl = project?.installerSignatureUrl?.trim() ?? ''
  const customerSignatureUrl = project?.customerSignatureUrl?.trim() ?? ''
  const companyBrand = company !== '—' ? company.replace(/\s+BV$/i, '') : 'CADLE'
  const dimacLogo = /^DIMAC(?:\s|$)/i.test(project?.company?.trim() ?? '')
    ? getCachedSymbolSvg('assets/dimac.svg')
    : null
  const brandMarkup = logoUrl
    ? `<g>
        <rect x="8" y="6.5" width="48" height="17" rx="2" fill="white"/>
        <image href="${ea(logoUrl)}" x="10" y="8" width="44" height="14" preserveAspectRatio="xMidYMid meet"/>
      </g>`
    : dimacLogo
      ? `<svg x="8" y="5.5" width="46" height="19" viewBox="${ea(dimacLogo.viewBox)}" preserveAspectRatio="xMidYMid meet">${dimacLogo.inner}</svg>`
    : `<g aria-label="${ea(companyBrand)}">
        <rect x="8" y="8" width="11" height="14" rx="2" fill="none" stroke="#f1d5c4" stroke-width="0.8"/>
        <path d="M11 18 V12 H14.5 C17.5 12 17.5 18 14.5 18 Z" fill="none" stroke="#f1d5c4" stroke-width="0.8"/>
        <circle cx="11" cy="12" r="1.1" fill="#df8552"/>
        ${tx(23, 18.2, companyBrand, { size: 5.2, weight: 750, fill: 'white' })}
      </g>`

  const street = val(project?.address?.street)
  const num = e(project?.address?.number?.trim() ?? '')
  const streetLine = num ? `${street} ${num}` : street
  const postalCode = val(project?.address?.postalCode)
  const city = val(project?.address?.city)
  const cityLine = postalCode !== '—' || city !== '—' ? `${postalCode} ${city}` : '—'

  const today = new Intl.DateTimeFormat('nl-BE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date())

  // Y coordinates (mm)
  const HDR_Y = PAGE_TOP
  const HDR_H = 22
  const S1_Y = HDR_Y + HDR_H
  const S1_H = 36
  const S2_Y = S1_Y + S1_H
  const S2_H = 66
  const S4_Y = S2_Y + S2_H
  const S4_H = 72
  const FOOTER_Y = S4_Y + S4_H + 2

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 210" width="3508" height="2480">
  <rect width="297" height="210" fill="white"/>

  <!-- ── HEADER ──────────────────────────────────────────────────────── -->
  <rect x="${PAGE_LEFT}" y="${HDR_Y}" width="${PAGE_WIDTH}" height="${HDR_H}" fill="#2d231c" rx="1.5"/>
  ${brandMarkup}
  ${tx(148.5, HDR_Y + 13.5, 'ELEKTRISCH DOSSIER', { size: 3.5, weight: 700, fill: '#d4c0b0', anchor: 'middle' })}
  ${tx(PAGE_RIGHT - 4, HDR_Y + 8.5, 'DATUM', { size: 2.1, weight: 700, fill: '#a99587', anchor: 'end' })}
  ${tx(PAGE_RIGHT - 4, HDR_Y + 15, today, { size: 3, weight: 600, fill: '#f2e8e0', anchor: 'end' })}

  <!-- ── S1: KLANT / INSTALLATIE ADRES ──────────────────────────────── -->
  <rect x="${PAGE_LEFT}" y="${S1_Y + 6}" width="${PAGE_WIDTH}" height="${S1_H - 6}" fill="#fdfcfb"/>
  ${sectionBar(S1_Y, 'KLANT / EIGENAAR', 'INSTALLATIE ADRES')}
  ${tx(7, S1_Y + 15, customerName, { size: 3.6, weight: 600, fill: '#151110' })}
  ${tx(COL + 3, S1_Y + 15, streetLine, { size: 3.2, weight: 500, fill: '#151110' })}
  ${tx(COL + 3, S1_Y + 24, cityLine, { size: 3, weight: 400, fill: '#2d231c' })}
  ${vline(COL, S1_Y, S1_Y + S1_H)}
  ${hline(S1_Y + S1_H)}

  <!-- ── S2: INSTALLATEUR / TECHNISCHE GEGEVENS ──────────────────────── -->
  <rect x="${PAGE_LEFT}" y="${S2_Y + 6}" width="${PAGE_WIDTH}" height="${S2_H - 6}" fill="#fbf9f7"/>
  ${sectionBar(S2_Y, 'INSTALLATEUR', 'TECHNISCHE GEGEVENS')}
  ${fieldRow(7, S2_Y + 17, 'NAAM', installerName)}
  ${fieldRow(7, S2_Y + 29, 'BEDRIJF', company)}
  ${fieldRow(7, S2_Y + 41, 'BTW / KBO', btw)}
  ${inputBox(COL + 3, S2_Y + 9, 138.5, 9, 'EAN-CODE (18 CIJFERS)', eanCode)}
  ${inputBox(COL + 3, S2_Y + 25, 35, 9, 'HOOFDZEKERING', mainFuseA)}
  ${inputBox(COL + 42, S2_Y + 25, 63, 9, 'NETBEHEERDER', distributor)}
  ${inputBox(COL + 109, S2_Y + 25, 32.5, 9, 'AARDING', earthingSystem)}
  ${inputBox(COL + 3, S2_Y + 41, 65, 9, 'NETAANSLUITING', supplyConfiguration)}
  ${inputBox(COL + 72, S2_Y + 41, 69.5, 9, 'HOOFDDIFFERENTIEEL', mainDifferentialLabel)}
  ${vline(COL, S2_Y, S2_Y + S2_H)}
  ${hline(S2_Y + S2_H)}

  <!-- ── S3: HANDTEKENINGEN ──────────────────────────────────────────── -->
  ${sectionBar(S4_Y, 'HANDTEKENINGEN')}
  ${sigBox(7, S4_Y + 8, 138, 61, 'HANDTEKENING INSTALLATEUR', installerName, installerSignatureUrl, 'installer')}
  ${sigBox(COL + 3, S4_Y + 8, 138.5, 61, 'HANDTEKENING EIGENAAR', customerName, customerSignatureUrl, 'customer')}
  ${hline(FOOTER_Y, PAGE_LEFT, PAGE_RIGHT, '#d4c8be', 0.3)}

  <!-- ── FOOTER ──────────────────────────────────────────────────────── -->
  ${tx(148.5, FOOTER_Y + 5.5, `Gegenereerd door Cadle \u2022 ${today}`, { size: 2.0, weight: 400, fill: '#b0a098', anchor: 'middle' })}
</svg>`
}
