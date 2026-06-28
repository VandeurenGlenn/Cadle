import jsPDF from 'jspdf'

export type A4ExportResult = {
  dataUrl: string
  orientation: 'portrait' | 'landscape'
  widthPx: number
  heightPx: number
}

export const downloadTextFile = (filename: string, content: string, type: string) => {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export const savePdfFromPng = (filename: string, exported: A4ExportResult) => {
  const pdf = new jsPDF({ format: 'a4', unit: 'px', orientation: exported.orientation, compress: true })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  pdf.setFillColor(255, 255, 255)
  pdf.rect(0, 0, pageWidth, pageHeight, 'F')
  pdf.addImage(exported.dataUrl, 'PNG', 0, 0, pageWidth, pageHeight, 'cadle-page', 'FAST')
  pdf.save(filename)
}
