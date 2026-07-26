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

const PAGE_LEFT = 10
const PAGE_RIGHT = 287
const PAGE_WIDTH = PAGE_RIGHT - PAGE_LEFT
const COL = 148.5

const hline = (y: number, x1 = PAGE_LEFT, x2 = PAGE_RIGHT, color = '#3f352d', w = 0.4): string =>
  `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="${w}"/>`

const vline = (x: number, y1: number, y2: number, color = '#d4c8be', w = 0.3): string =>
  `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${color}" stroke-width="${w}"/>`

const sectionBar = (y: number, left: string, right?: string): string => `
  <rect x="${PAGE_LEFT}" y="${y}" width="${PAGE_WIDTH}" height="6" fill="#f0ebe5"/>
  ${tx(13, y + 4.3, left, { size: 2.5, weight: 700, fill: '#2d231c' })}
  ${right ? vline(COL, y, y + 6, '#c8b9ad', 0.3) : ''}
  ${right ? tx(COL + 3, y + 4.3, right, { size: 2.5, weight: 700, fill: '#2d231c' }) : ''}`

const fieldRow = (x: number, y: number, label: string, value: string): string =>
  `${tx(x, y, label, { size: 2.3, weight: 700, fill: '#7d736d' })}${tx(x + 22, y, value, { size: 2.8, weight: 500, fill: '#151110' })}`

const inputBox = (x: number, y: number, w: number, h: number, label: string, value: string): string =>
  `${tx(x, y, label, { size: 2.2, weight: 700, fill: '#7d736d' })}
  <rect x="${x}" y="${y + 2.5}" width="${w}" height="${h}" fill="#fbf9f7" stroke="#c8b9ad" stroke-width="0.35" rx="1.5"/>
  ${tx(x + 3, y + 2.5 + h * 0.64, value !== '—' ? value : 'AANVULLEN', {
    size: value !== '—' ? 2.8 : 2.05,
    weight: value !== '—' ? 600 : 500,
    fill: value !== '—' ? '#151110' : '#a09287'
  })}`

const sigBox = (x: number, y: number, w: number, h: number, title: string, name: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fafafa" stroke="#3f352d" stroke-width="0.4" rx="1.5"/>
  ${tx(x + w / 2, y + 6, title, { size: 2.4, weight: 700, fill: '#2d231c', anchor: 'middle' })}
  <line x1="${x + 8}" y1="${y + h - 8}" x2="${x + w - 8}" y2="${y + h - 8}" stroke="#c8b9ad" stroke-width="0.5"/>
  ${tx(x + w / 2, y + h - 3, name, { size: 2.3, weight: 400, fill: '#9e8e84', anchor: 'middle' })}`

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
  const supplyVoltage =
    typeof project?.electricalProfile?.supplyVoltageV === 'number'
      ? `${project.electricalProfile.supplyVoltageV} V`
      : '—'
  const earthingSystem =
    project?.electricalProfile?.earthingSystem && project.electricalProfile.earthingSystem !== 'unknown'
      ? upper(project.electricalProfile.earthingSystem)
      : '—'
  const electricalEdition = val(project?.electricalProfile?.edition)
  const mainDifferential = project?.electricalProfile?.boards?.[0]?.mainDifferential
  const mainDifferentialLabel = mainDifferential
    ? `${mainDifferential.ratedCurrentA} A · ${mainDifferential.sensitivityMa} mA · ${mainDifferential.poles}P${
        mainDifferential.type ? ` · TYPE ${mainDifferential.type}` : ''
      }`
    : '—'
  const logoUrl = project?.logoUrl?.trim() ?? ''
  const companyBrand = company !== '—' ? company.replace(/\s+BV$/i, '') : 'CADLE'
  const dimacLogo = /^DIMAC(?:\s|$)/i.test(project?.company?.trim() ?? '')
    ? getCachedSymbolSvg('assets/dimac.svg')
    : null
  const brandMarkup = logoUrl
    ? `<g>
        <rect x="14" y="12.5" width="48" height="17" rx="2" fill="white"/>
        <image href="${ea(logoUrl)}" x="16" y="14" width="44" height="14" preserveAspectRatio="xMidYMid meet"/>
      </g>`
    : dimacLogo
      ? `<svg x="14" y="11.5" width="46" height="19" viewBox="${ea(dimacLogo.viewBox)}" preserveAspectRatio="xMidYMid meet">${dimacLogo.inner}</svg>`
    : `<g aria-label="${ea(companyBrand)}">
        <rect x="14" y="14" width="11" height="14" rx="2" fill="none" stroke="#f1d5c4" stroke-width="0.8"/>
        <path d="M17 24 V18 H20.5 C23.5 18 23.5 24 20.5 24 Z" fill="none" stroke="#f1d5c4" stroke-width="0.8"/>
        <circle cx="17" cy="18" r="1.1" fill="#df8552"/>
        ${tx(29, 24.2, companyBrand, { size: 5.2, weight: 750, fill: 'white' })}
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
  const HDR_Y = 10
  const HDR_H = 22
  const S1_Y = HDR_Y + HDR_H // 34 — Klant / Adres
  const S1_H = 34
  const S2_Y = S1_Y + S1_H // 66 — Installateur / Technische gegevens
  const S2_H = 64
  const S3_Y = S2_Y + S2_H // 130 — Dossier
  const S3_H = 23
  const S4_Y = S3_Y + S3_H // 153 — Handtekeningen
  const S4_H = 37
  const FOOTER_Y = S4_Y + S4_H + 2 // 192

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 210" width="3508" height="2480">
  <rect width="297" height="210" fill="white"/>

  <!-- ── HEADER ──────────────────────────────────────────────────────── -->
  <rect x="${PAGE_LEFT}" y="${HDR_Y}" width="${PAGE_WIDTH}" height="${HDR_H}" fill="#2d231c" rx="1.5"/>
  ${brandMarkup}
  ${tx(148.5, HDR_Y + 13.5, 'ELEKTRISCH DOSSIER', { size: 3.5, weight: 700, fill: '#d4c0b0', anchor: 'middle' })}

  <!-- ── S1: KLANT / INSTALLATIE ADRES ──────────────────────────────── -->
  <rect x="${PAGE_LEFT}" y="${S1_Y + 6}" width="${PAGE_WIDTH}" height="${S1_H - 6}" fill="#fdfcfb"/>
  ${sectionBar(S1_Y, 'KLANT / EIGENAAR', 'INSTALLATIE ADRES')}
  ${tx(13, S1_Y + 15, customerName, { size: 3.6, weight: 600, fill: '#151110' })}
  ${tx(COL + 3, S1_Y + 15, streetLine, { size: 3.2, weight: 500, fill: '#151110' })}
  ${tx(COL + 3, S1_Y + 24, cityLine, { size: 3, weight: 400, fill: '#2d231c' })}
  ${vline(COL, S1_Y, S1_Y + S1_H)}
  ${hline(S1_Y + S1_H)}

  <!-- ── S2: INSTALLATEUR / TECHNISCHE GEGEVENS ──────────────────────── -->
  <rect x="${PAGE_LEFT}" y="${S2_Y + 6}" width="${PAGE_WIDTH}" height="${S2_H - 6}" fill="#fbf9f7"/>
  ${sectionBar(S2_Y, 'INSTALLATEUR', 'TECHNISCHE GEGEVENS')}
  ${fieldRow(13, S2_Y + 17, 'NAAM', installerName)}
  ${fieldRow(13, S2_Y + 29, 'BEDRIJF', company)}
  ${fieldRow(13, S2_Y + 41, 'BTW / KBO', btw)}
  ${inputBox(COL + 3, S2_Y + 9, 132.5, 9, 'EAN-CODE (18 CIJFERS)', eanCode)}
  ${inputBox(COL + 3, S2_Y + 25, 35, 9, 'HOOFDZEKERING', mainFuseA)}
  ${inputBox(COL + 42, S2_Y + 25, 63, 9, 'NETBEHEERDER', distributor)}
  ${inputBox(COL + 109, S2_Y + 25, 26.5, 9, 'AARDING', earthingSystem)}
  ${inputBox(COL + 3, S2_Y + 41, 47, 9, 'NETAANSLUITING', supplyConfiguration)}
  ${inputBox(COL + 54, S2_Y + 41, 28, 9, 'SPANNING', supplyVoltage)}
  ${inputBox(COL + 86, S2_Y + 41, 49.5, 9, 'HOOFDDIFFERENTIEEL', mainDifferentialLabel)}
  ${vline(COL, S2_Y, S2_Y + S2_H)}
  ${hline(S2_Y + S2_H)}

  <!-- ── S3: DOSSIER ─────────────────────────────────────────────────── -->
  <rect x="${PAGE_LEFT}" y="${S3_Y + 6}" width="${PAGE_WIDTH}" height="${S3_H - 6}" fill="#fdfcfb"/>
  ${sectionBar(S3_Y, 'DOSSIERGEGEVENS')}
  ${tx(13, S3_Y + 14, 'OPMAAK SCHEMA', { size: 2.3, weight: 700, fill: '#7d736d' })}
  ${tx(13, S3_Y + 21, today, { size: 3.2, weight: 600, fill: '#151110' })}
  ${tx(COL + 3, S3_Y + 14, 'NORM / UITGAVE', { size: 2.3, weight: 700, fill: '#7d736d' })}
  ${tx(COL + 3, S3_Y + 21, `AREI · ${electricalEdition}`, { size: 3, weight: 600, fill: '#151110' })}
  ${hline(S3_Y + S3_H)}

  <!-- ── S4: HANDTEKENINGEN ──────────────────────────────────────────── -->
  ${sectionBar(S4_Y, 'HANDTEKENINGEN')}
  ${sigBox(13, S4_Y + 8, 132, 26, 'HANDTEKENING INSTALLATEUR', installerName)}
  ${sigBox(COL + 3, S4_Y + 8, 132.5, 26, 'HANDTEKENING EIGENAAR', customerName)}
  ${hline(FOOTER_Y, PAGE_LEFT, PAGE_RIGHT, '#d4c8be', 0.3)}

  <!-- ── FOOTER ──────────────────────────────────────────────────────── -->
  ${tx(148.5, FOOTER_Y + 5, 'Onderdeel van het AREI-dossier · te controleren door installateur en erkend keuringsorganisme.', { size: 2.1, weight: 400, fill: '#9e8e84', anchor: 'middle' })}
  ${tx(148.5, FOOTER_Y + 10, `Gegenereerd door Cadle \u2022 ${today}`, { size: 2.0, weight: 400, fill: '#b0a098', anchor: 'middle' })}
</svg>`
}
