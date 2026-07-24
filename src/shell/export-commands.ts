import { bomRowsToCsv, type BomRow } from '../native-app/circuit-analysis.js'
import { downloadTextFile } from '../native-app/export/downloads.js'

export const safeExportName = (name: string): string =>
  (name || 'cadle-project').replace(/[^a-z0-9_-]+/gi, '-')

export const downloadDataUrl = (dataUrl: string, filename: string): void => {
  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = filename
  anchor.click()
}

export const downloadBom = (rows: BomRow[], projectName: string): boolean => {
  if (!rows.length) return false
  downloadTextFile(`${safeExportName(projectName)}-bom.csv`, bomRowsToCsv(rows), 'text/csv;charset=utf-8')
  return true
}
