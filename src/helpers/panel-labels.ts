/**
 * Panel-layout label printing.
 *
 * Generates the two artefacts every electrician needs when wiring a
 * distribution panel:
 *
 *   1. **Klemmenlijst (terminal list)** — a TSV that maps each binding
 *      group / circuit to its breaker rating, wire section, and member
 *      count. Drops directly into Excel or any label-printer driver
 *      that consumes tab-separated values.
 *
 *   2. **Label sheet** — a printable PDF/HTML where each row is a
 *      label sized for a typical DIN-rail label printer (60 × 12 mm).
 *
 * This module is rendering-free: it returns strings/blobs. The shell
 * decides whether to download them, copy to clipboard, or hand them to
 * a print dialog.
 */

import type { WireSection } from './wire-section.js'

export interface PanelLabelRow {
  bindingId: string
  letter: string
  number: number
  description?: string
  wireSection: WireSection
  breakerAmperage: number
  switches: number
  loads: number
  ready: boolean
}

/**
 * Build a tab-separated klemmenlijst. First row is a header; every
 * subsequent row is one circuit. Compatible with Excel, LibreOffice,
 * and Brother / DYMO label-printer drivers.
 */
export function buildKlemmenlijstTSV(rows: ReadonlyArray<PanelLabelRow>): string {
  const header = ['ID', 'Letter', 'Nr', 'Description', 'Wire', 'Breaker (A)', 'Switches', 'Loads', 'Ready']
  const body = rows.map((r) => [
    r.bindingId,
    r.letter,
    String(r.number),
    r.description ?? '',
    r.wireSection,
    String(r.breakerAmperage),
    String(r.switches),
    String(r.loads),
    r.ready ? 'yes' : 'no'
  ])
  return [header, ...body].map((cols) => cols.join('\t')).join('\n')
}

/**
 * Build a printable HTML page where every binding group becomes a
 * label sized 60 × 12 mm (typical DIN-rail label format). Open the
 * returned HTML in a new window and call `window.print()`.
 */
export function buildLabelSheetHTML(rows: ReadonlyArray<PanelLabelRow>, projectName = 'Project'): string {
  const labels = rows
    .map(
      (r) => `
      <div class="label">
        <div class="row">
          <span class="id">${escapeHtml(r.bindingId)}</span>
          <span class="rating">${r.breakerAmperage} A · ${escapeHtml(r.wireSection)}</span>
        </div>
        <div class="desc">${escapeHtml(r.description ?? `${r.switches} sw · ${r.loads} load`)}</div>
      </div>`
    )
    .join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(projectName)} — Panel labels</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { font-family: Arial, sans-serif; margin: 0; }
  .sheet { display: grid; grid-template-columns: repeat(3, 60mm); gap: 4mm; }
  .label {
    width: 60mm; height: 12mm;
    border: 0.3mm solid #888; border-radius: 1mm;
    padding: 1mm 2mm; box-sizing: border-box;
    display: flex; flex-direction: column; justify-content: space-between;
    page-break-inside: avoid;
  }
  .row { display: flex; justify-content: space-between; font-size: 9pt; }
  .id { font-weight: 700; }
  .rating { color: #555; }
  .desc { font-size: 7pt; color: #666; }
  @media print { .label { border-color: #000; } }
</style>
</head>
<body>
  <div class="sheet">${labels}</div>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Trigger a browser download of arbitrary text content.
 */
export function downloadText(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
