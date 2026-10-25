import { bomRowsToCsv, type BomRow } from '../circuit-analysis.js'
import { safeExportName } from '../../helpers/export-name.js'
import { downloadTextFile } from './downloads.js'

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
