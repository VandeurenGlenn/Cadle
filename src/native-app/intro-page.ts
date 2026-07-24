import type { Project } from '../types.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const e = (v: string | null | undefined): string =>
  (v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

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

const hline = (y: number, x1 = 10, x2 = 200, color = '#3f352d', w = 0.4): string =>
  `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="${w}"/>`

const vline = (x: number, y1: number, y2: number, color = '#d4c8be', w = 0.3): string =>
  `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${color}" stroke-width="${w}"/>`

const COL = 107 // x midpoint for 2-column layout

const sectionBar = (y: number, left: string, right?: string): string => `
  <rect x="10" y="${y}" width="190" height="6" fill="#f0ebe5"/>
  ${tx(13, y + 4.3, left, { size: 2.5, weight: 700, fill: '#2d231c' })}
  ${right ? vline(COL, y, y + 6, '#c8b9ad', 0.3) : ''}
  ${right ? tx(COL + 3, y + 4.3, right, { size: 2.5, weight: 700, fill: '#2d231c' }) : ''}`

const fieldRow = (x: number, y: number, label: string, value: string): string =>
  `${tx(x, y, label, { size: 2.3, weight: 700, fill: '#7d736d' })}${tx(x + 22, y, value, { size: 2.8, weight: 500, fill: '#151110' })}`

const inputBox = (x: number, y: number, w: number, h: number, label: string, value: string): string =>
  `${tx(x, y, label, { size: 2.2, weight: 700, fill: '#7d736d' })}
  <rect x="${x}" y="${y + 2.5}" width="${w}" height="${h}" fill="#fafafa" stroke="#b0a098" stroke-width="0.4" rx="1.5"/>
  ${value !== '—' ? tx(x + 3, y + 2.5 + h * 0.64, value, { size: 2.8, weight: 600, fill: '#151110' }) : ''}`

const sigBox = (x: number, y: number, w: number, h: number, title: string, name: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fafafa" stroke="#3f352d" stroke-width="0.4" rx="1.5"/>
  ${tx(x + w / 2, y + 6, title, { size: 2.4, weight: 700, fill: '#2d231c', anchor: 'middle' })}
  <line x1="${x + 8}" y1="${y + h - 16}" x2="${x + w - 8}" y2="${y + h - 16}" stroke="#c8b9ad" stroke-width="0.5"/>
  ${tx(x + w / 2, y + h - 9, name, { size: 2.3, weight: 400, fill: '#9e8e84', anchor: 'middle' })}`

// ── Public API ─────────────────────────────────────────────────────────────────

export const buildIntroPageSvg = (project: Project | null): string => {
  const projectName = upper(project?.name) || 'PROJECT'
  const customerName = val([project?.customer?.name, project?.customer?.lastname].filter(Boolean).join(' '))
  const installerName = val([project?.installer?.name, project?.installer?.lastname].filter(Boolean).join(' '))
  const company = val(project?.company)
  const btw = val(project?.installer?.btw)
  const eanCode = val(project?.eanCode)
  const mainFuseA = typeof project?.mainFuseA === 'number' ? `${project.mainFuseA} A` : '—'
  const distributor = val(project?.electricalProfile?.distributor)
  const supplyConfiguration = val(project?.electricalProfile?.supplyConfiguration)

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
  const HDR_H = 24
  const S1_Y = HDR_Y + HDR_H // 34 — Klant / Adres
  const S1_H = 52
  const S2_Y = S1_Y + S1_H // 86 — Installateur / Technische gegevens
  const S2_H = 65
  const S3_Y = S2_Y + S2_H // 151 — Datum
  const S3_H = 28
  const S4_Y = S3_Y + S3_H // 179 — Handtekeningen
  const S4_H = 78
  const FOOTER_Y = S4_Y + S4_H + 2 // 259

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" width="2480" height="3508">
  <rect width="210" height="297" fill="white"/>
  <rect x="10" y="10" width="190" height="277" fill="none" stroke="#3f352d" stroke-width="0.6" rx="1.5"/>

  <!-- ── HEADER ──────────────────────────────────────────────────────── -->
  <rect x="10" y="${HDR_Y}" width="190" height="${HDR_H}" fill="#2d231c" rx="1.5"/>
  ${tx(14, HDR_Y + 15, projectName, { size: 5.5, weight: 700, fill: 'white' })}
  ${tx(198, HDR_Y + 9, 'ELEKTRISCH INSTALLATIEPLAN', { size: 2.4, weight: 400, fill: '#9e8e80', anchor: 'end' })}
  ${tx(198, HDR_Y + 16.5, 'AREI / RGIE', { size: 3.2, weight: 700, fill: '#d4c0b0', anchor: 'end' })}

  <!-- ── S1: KLANT / INSTALLATIE ADRES ──────────────────────────────── -->
  ${sectionBar(S1_Y, 'KLANT / EIGENAAR', 'INSTALLATIE ADRES')}
  ${tx(13, S1_Y + 14, customerName, { size: 3.6, weight: 600, fill: '#151110' })}
  ${tx(COL + 3, S1_Y + 14, streetLine, { size: 3.2, weight: 500, fill: '#151110' })}
  ${tx(COL + 3, S1_Y + 23, cityLine, { size: 3, weight: 400, fill: '#2d231c' })}
  ${vline(COL, S1_Y, S1_Y + S1_H)}
  ${hline(S1_Y + S1_H)}

  <!-- ── S2: INSTALLATEUR / TECHNISCHE GEGEVENS ──────────────────────── -->
  ${sectionBar(S2_Y, 'INSTALLATEUR', 'TECHNISCHE GEGEVENS')}
  ${fieldRow(13, S2_Y + 17, 'NAAM', installerName)}
  ${fieldRow(13, S2_Y + 28, 'BEDRIJF', company)}
  ${fieldRow(13, S2_Y + 39, 'BTW / KBO', btw)}
  ${inputBox(COL + 3, S2_Y + 9, 88, 13, 'EAN-CODE (18 CIJFERS)', eanCode)}
  ${inputBox(COL + 3, S2_Y + 30, 42, 13, 'HOOFDZEKERING', mainFuseA)}
  ${inputBox(COL + 49, S2_Y + 30, 42, 13, 'NETBEHEERDER', distributor)}
  ${inputBox(COL + 3, S2_Y + 46, 88, 13, 'NETAANSLUITING', supplyConfiguration)}
  ${vline(COL, S2_Y, S2_Y + S2_H)}
  ${hline(S2_Y + S2_H)}

  <!-- ── S3: DATUM ───────────────────────────────────────────────────── -->
  ${sectionBar(S3_Y, 'DATUM')}
  ${tx(13, S3_Y + 14, 'OPMAAK SCHEMA', { size: 2.3, weight: 700, fill: '#7d736d' })}
  ${tx(13, S3_Y + 21, today, { size: 3.2, weight: 600, fill: '#151110' })}
  ${tx(COL + 3, S3_Y + 14, 'LAATSTE AANPASSING', { size: 2.3, weight: 700, fill: '#7d736d' })}
  ${tx(COL + 3, S3_Y + 21, '—', { size: 3, weight: 400, fill: '#b0a098' })}
  ${hline(S3_Y + S3_H)}

  <!-- ── S4: HANDTEKENINGEN ──────────────────────────────────────────── -->
  ${sectionBar(S4_Y, 'HANDTEKENINGEN')}
  ${sigBox(13, S4_Y + 9, 90, 63, 'HANDTEKENING INSTALLATEUR', installerName)}
  ${sigBox(COL + 3, S4_Y + 9, 90, 63, 'HANDTEKENING EIGENAAR', customerName)}
  ${hline(FOOTER_Y, 10, 200, '#d4c8be', 0.3)}

  <!-- ── FOOTER ──────────────────────────────────────────────────────── -->
  ${tx(105, FOOTER_Y + 9, 'Dit schema is opgemaakt conform het Algemeen Reglement op de Elektrische Installaties (AREI).', { size: 2.1, weight: 400, fill: '#9e8e84', anchor: 'middle' })}
  ${tx(105, FOOTER_Y + 15, `Gegenereerd door Cadle \u2022 ${today}`, { size: 2.0, weight: 400, fill: '#b0a098', anchor: 'middle' })}
</svg>`
}
