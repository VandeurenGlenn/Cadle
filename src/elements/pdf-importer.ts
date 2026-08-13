import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './pdf-importer.css' with { type: 'css' }
import '@vandeurenglenn/lite-elements/button.js'
import './header.js'
import * as pdfjsLib from 'pdfjs-dist'
import type { Project, UUID } from '../types.js'
import type { NativeDocumentState } from '../data/project-document.js'
import type { ImageShape } from '../editor/model/types.js'
import {
  convertPdfVectorPageToCadle,
  extractPdfVectorPage,
  classifyPdfVectorText,
  type PdfConversionSummary,
  type PdfRecognizedSymbolKind,
  type PdfReviewLineKind,
  type PdfVectorPage
} from '../editor/pdf-vector-conversion.js'
import {
  fitPdfPageToPaper,
  importedPlanPageName,
  paperPresetForPdfPage,
  pdfPreviewRenderScale
} from '../editor/pdf-plan-import.js'
import {
  createPdfScanOcrSession,
  type PdfScanOcrSession
} from '../editor/pdf-scan-ocr.js'
import { detectPdfScanCanvasGeometry } from '../editor/pdf-scan-geometry.js'
import { detectPdfScanCanvasSymbols } from '../editor/pdf-scan-symbols.js'
import { detectPdfScanOpenings } from '../editor/pdf-scan-openings.js'
import { preparePdfScanCanvas, type PdfScanQuality } from '../editor/pdf-scan-preprocess.js'
import {
  applyPdfImportCorrections,
  confirmPdfReviewSuggestions,
  pdfReviewCounts,
  pdfReviewStatus,
  parsePdfImportCorrections,
  serializePdfImportCorrections,
  setPdfReviewLineKind,
  setPdfReviewTextKind,
  setPdfReviewTextValue,
  type PdfImportCorrection
} from '../editor/pdf-import-review.js'
import pubsub from '../pubsub.js'
async function getPdfjsLib() {
  // Set up worker with a data URL approach that doesn't require external fetch
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    // Use worker from node_modules if available
    const pdfWorkerPath = new URL('pdf.worker.min.mjs', import.meta.url)
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerPath.href
  }
  return pdfjsLib
}

interface PDFPage {
  pageNumber: number
  canvas?: HTMLCanvasElement
  previewImage?: string
  selected: boolean
  width: number
  height: number
  pdfWidth: number
  pdfHeight: number
  vector: PdfVectorPage
  analysis?: PDFPageAnalysis
}

interface PDFPageAnalysis {
  vector: PdfVectorPage
  detectedVector: PdfVectorPage
  history: PdfVectorPage[]
  summary: PdfConversionSummary
  usedOcr: boolean
  usedRasterGeometry: boolean
  rasterSymbols: number
  scanQuality?: PdfScanQuality
  processedCanvas?: HTMLCanvasElement
  processedPreviewImage?: string
}

interface PdfPageProxy {
  getViewport(options: { scale: number }): {
    width: number
    height: number
    transform: number[]
  }
  getTextContent(): Promise<{ items: Array<unknown> }>
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>
  render(options: {
    canvasContext: CanvasRenderingContext2D
    canvas: HTMLCanvasElement | null
    viewport: { width: number; height: number }
  }): {
    promise: Promise<void>
  }
}

interface PdfDocumentProxy {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPageProxy>
}
declare global {
  interface HTMLElementTagNameMap {
    'pdf-importer': PDFImporter
  }
}
@customElement('pdf-importer')
export class PDFImporter extends LiteElement {
  #sourceFileName = 'Old plan.pdf'
  #correctionStorageKey = 'cadle.pdf-import-corrections.v1'
  @property({ type: Object })
  accessor pdfDocument: PdfDocumentProxy | null = null

  @property()
  accessor pages: PDFPage[] = []

  @property({ attribute: false, consumes: 'projectKey' })
  accessor projectKey: UUID = '' as UUID

  @property({ attribute: false, consumes: 'project' })
  accessor project: Project | null = null

  @property()
  accessor isLoading = false

  @property()
  accessor error: string | null = null

  @property({ type: String })
  accessor importMode: 'background' | 'convert' = 'convert'

  @property({ type: Boolean })
  accessor keepBackground = true

  @property({ type: Boolean })
  accessor scanOcr = true

  @property({ type: Boolean })
  accessor scanGeometry = true

  @property({ type: Boolean })
  accessor scanSymbols = true

  @property({ type: Boolean })
  accessor enhanceScan = true

  @property({ type: String })
  accessor ocrStatus = ''

  @property({ type: Number })
  accessor activeReviewPage = 0

  @property({ type: Number })
  accessor reviewZoom = 1

  @property({ type: Boolean })
  accessor showReviewOverlay = true

  static styles = [styles]

  async loadPDF(file: File): Promise<void> {
    try {
      this.#sourceFileName = file.name
      this.isLoading = true
      this.error = null
      const pdfjs = await getPdfjsLib()
      const arrayBuffer = await file.arrayBuffer()
      this.pdfDocument = (await pdfjs.getDocument({ data: arrayBuffer }).promise) as unknown as PdfDocumentProxy
      await this.renderPages()
    } catch (err) {
      this.error = `Failed to load PDF: ${err instanceof Error ? err.message : String(err)}`
      console.error(err)
    } finally {
      this.isLoading = false
    }
  }

  private async renderPages(): Promise<void> {
    const pages: PDFPage[] = []
    for (let i = 1; i <= this.pdfDocument.numPages; i++) {
      const page = await this.pdfDocument.getPage(i)
      const pdfViewport = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: pdfPreviewRenderScale(pdfViewport.width, pdfViewport.height) })
      const vector = await extractPdfVectorPage(
        page,
        pdfViewport.transform,
        pdfViewport.width,
        pdfViewport.height,
        pdfjsLib.OPS
      )
      // Create canvas for PDF rendering
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      canvas.width = viewport.width
      canvas.height = viewport.height
      // Render page to canvas
      await page.render({ canvasContext: context!, viewport, canvas }).promise
      // Convert canvas to image for preview
      const previewImage = canvas.toDataURL('image/png')
      pages.push({
        pageNumber: i,
        canvas,
        previewImage,
        selected: true, // Select all pages by default
        width: viewport.width,
        height: viewport.height,
        pdfWidth: pdfViewport.width,
        pdfHeight: pdfViewport.height,
        vector
      })
    }

    this.pages = pages
  }

  private togglePageSelection(pageNumber: number): void {
    const page = this.pages.find((p) => p.pageNumber === pageNumber)
    if (page) {
      page.selected = !page.selected
      this.requestRender()
    }
  }

  private toggleAllPages(): void {
    const allSelected = this.pages.every((p) => p.selected)
    this.pages.forEach((p) => {
      p.selected = !allSelected
    })
    this.requestRender()
  }

  private invalidateAnalysis(): void {
    this.pages = this.pages.map((page) => ({ ...page, analysis: undefined }))
  }

  private readCorrections(): PdfImportCorrection[] {
    try {
      return parsePdfImportCorrections(localStorage.getItem(this.#correctionStorageKey) ?? '[]')
    } catch {
      return []
    }
  }

  private exportCorrections(): void {
    const blob = new Blob([serializePdfImportCorrections(this.readCorrections())], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'cadle-pdf-corrections.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  private async importCorrections(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    try {
      const imported = parsePdfImportCorrections(await file.text())
      const merged = new Map(this.readCorrections().map((correction) => [correction.source.toLocaleLowerCase().trim(), correction]))
      for (const correction of imported) merged.set(correction.source.toLocaleLowerCase().trim(), correction)
      localStorage.setItem(this.#correctionStorageKey, serializePdfImportCorrections([...merged.values()]))
      this.invalidateAnalysis()
      this.error = null
      pubsub.publish('show-notification', { message: `Imported ${imported.length} PDF correction${imported.length === 1 ? '' : 's'}. Analyze again to apply them.` })
    } catch (err) {
      this.error = `Could not import corrections: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  private saveCorrection(source: string, kind: PdfRecognizedSymbolKind, correctedText?: string): void {
    if (!source.trim()) return
    const corrections = this.readCorrections().filter(
      (item) => item.source.toLocaleLowerCase().trim() !== source.toLocaleLowerCase().trim()
    )
    corrections.push({ source, kind, ...(correctedText && correctedText !== source ? { correctedText } : {}) })
    try {
      localStorage.setItem(this.#correctionStorageKey, JSON.stringify(corrections.slice(-500)))
    } catch {
      // Import must still succeed if browser storage is unavailable or full.
    }
  }

  private async analyzeSelectedPages(): Promise<void> {
    const selectedPages = this.pages.filter((page) => page.selected)
    if (!selectedPages.length) return
    let ocrSession: PdfScanOcrSession | null = null
    try {
      this.isLoading = true
      this.error = null
      const needsOcr = this.scanOcr && selectedPages.some((page) => page.vector.texts.length === 0 && page.canvas)
      if (needsOcr) {
        this.ocrStatus = 'Starting local text recognition…'
        ocrSession = await createPdfScanOcrSession((status, progress) => {
          this.ocrStatus = `${status} · ${Math.round(progress * 100)}%`
        })
      }
      const corrections = this.readCorrections()
      for (const page of selectedPages) {
        const rasterPage = page.vector.lines.length === 0 && page.vector.texts.length === 0
        const prepared = rasterPage && page.canvas && this.enhanceScan
          ? preparePdfScanCanvas(page.canvas)
          : { canvas: page.canvas, quality: undefined }
        const analysisCanvas = prepared.canvas
        let sourceVector: PdfVectorPage = {
          ...page.vector,
          lines: page.vector.lines.map((line) => ({ ...line })),
          texts: page.vector.texts.map((text) => ({ ...text }))
        }
        let usedRasterGeometry = false
        let usedOcr = false
        let rasterSymbols = 0
        if (this.scanGeometry && analysisCanvas && sourceVector.lines.length === 0) {
          this.ocrStatus = `Detecting walls and lines on page ${page.pageNumber}…`
          const lines = detectPdfScanCanvasGeometry(analysisCanvas, { width: page.pdfWidth, height: page.pdfHeight })
          const detailed = detectPdfScanCanvasGeometry(
            analysisCanvas,
            { width: page.pdfWidth, height: page.pdfHeight },
            { minimumLengthRatio: 0.018, maximumGap: 3, mergeGapRatio: 0.002 }
          )
          const openings = detectPdfScanOpenings(detailed, lines, { width: page.pdfWidth, height: page.pdfHeight })
          sourceVector = { ...sourceVector, lines: [...lines, ...openings] }
          usedRasterGeometry = lines.length > 0
        }
        if (ocrSession && analysisCanvas && sourceVector.texts.length === 0) {
          this.ocrStatus = `Recognizing text on page ${page.pageNumber} of ${selectedPages.length}…`
          const recognized = await ocrSession.recognize(analysisCanvas, { width: page.pdfWidth, height: page.pdfHeight })
          sourceVector = { ...sourceVector, texts: recognized.texts.map((text) => ({ ...text, originalText: text.text })) }
          usedOcr = true
        }
        if (this.scanSymbols && analysisCanvas) {
          this.ocrStatus = `Recognizing unlabelled symbols on page ${page.pageNumber}…`
          const detected = detectPdfScanCanvasSymbols(analysisCanvas, { width: page.pdfWidth, height: page.pdfHeight })
            .filter((candidate) => !sourceVector.texts.some((text) => {
              if (classifyPdfVectorText(text) !== classifyPdfVectorText(candidate)) return false
              return Math.hypot(text.x - candidate.x, text.y - candidate.y) < Math.min(page.pdfWidth, page.pdfHeight) * 0.1
            }))
            .map((text) => ({ ...text, originalText: text.text }))
          sourceVector = { ...sourceVector, texts: [...sourceVector.texts, ...detected] }
          rasterSymbols = detected.length
        }
        sourceVector = applyPdfImportCorrections(sourceVector, corrections)
        const conversion = convertPdfVectorPageToCadle(sourceVector, { x: 0, y: 0, width: page.pdfWidth, height: page.pdfHeight })
        page.analysis = {
          vector: sourceVector,
          detectedVector: {
            ...sourceVector,
            lines: sourceVector.lines.map((line) => ({ ...line })),
            texts: sourceVector.texts.map((text) => ({ ...text }))
          },
          history: [],
          summary: conversion.summary,
          usedOcr,
          usedRasterGeometry,
          rasterSymbols,
          scanQuality: prepared.quality,
          ...(rasterPage && analysisCanvas
            ? { processedCanvas: analysisCanvas, processedPreviewImage: analysisCanvas.toDataURL('image/png') }
            : {})
        }
      }
      this.pages = [...this.pages]
      this.activeReviewPage = selectedPages[0]?.pageNumber ?? 0
    } catch (err) {
      this.error = `Failed to analyze PDF: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      await ocrSession?.terminate()
      this.ocrStatus = ''
      this.isLoading = false
    }
  }

  private refreshAnalysis(page: PDFPage, vector: PdfVectorPage, remember = true): void {
    if (!page.analysis) return
    const conversion = convertPdfVectorPageToCadle(vector, { x: 0, y: 0, width: page.pdfWidth, height: page.pdfHeight })
    const history = remember
      ? [...page.analysis.history, page.analysis.vector].slice(-20)
      : page.analysis.history
    page.analysis = { ...page.analysis, vector, summary: conversion.summary, history }
    this.error = null
    this.pages = [...this.pages]
  }

  private reviewTextValue(page: PDFPage, index: number, value: string): void {
    if (!page.analysis) return
    const vector = setPdfReviewTextValue(page.analysis.vector, index, value)
    this.refreshAnalysis(page, vector)
  }

  private reviewTextKind(page: PDFPage, index: number, kind: PdfRecognizedSymbolKind): void {
    if (!page.analysis) return
    const vector = setPdfReviewTextKind(page.analysis.vector, index, kind)
    this.refreshAnalysis(page, vector)
  }

  private reviewLineKind(page: PDFPage, index: number, kind: PdfReviewLineKind): void {
    if (!page.analysis) return
    this.refreshAnalysis(page, setPdfReviewLineKind(page.analysis.vector, index, kind))
  }

  private confirmPageSuggestions(page: PDFPage): void {
    if (!page.analysis) return
    this.refreshAnalysis(page, confirmPdfReviewSuggestions(page.analysis.vector))
  }

  private undoPageReview(page: PDFPage): void {
    if (!page.analysis?.history.length) return
    const vector = page.analysis.history[page.analysis.history.length - 1]
    page.analysis.history = page.analysis.history.slice(0, -1)
    this.refreshAnalysis(page, vector, false)
  }

  private setAllPageLines(page: PDFPage, kind: PdfReviewLineKind): void {
    if (!page.analysis) return
    this.refreshAnalysis(page, {
      ...page.analysis.vector,
      lines: page.analysis.vector.lines.map((line) => ({ ...line, reviewKind: kind, reviewPending: false }))
    })
  }

  private resetPageReview(page: PDFPage): void {
    if (!page.analysis) return
    this.refreshAnalysis(page, {
      ...page.analysis.detectedVector,
      lines: page.analysis.detectedVector.lines.map((line) => ({ ...line })),
      texts: page.analysis.detectedVector.texts.map((text) => ({ ...text }))
    }, false)
    if (page.analysis) page.analysis.history = []
  }

  private persistReviewedCorrections(pages: readonly PDFPage[]): void {
    for (const page of pages) {
      for (const text of page.analysis?.vector.texts ?? []) {
        const source = text.originalText
        if (!source || source === 'lichtpunt') continue
        const kind = text.recognizedKind
        if (!kind || kind === 'auto') continue
        this.saveCorrection(source, kind, text.text)
      }
    }
  }

  private async importSelectedPages(): Promise<void> {
    const selectedPages = this.pages.filter((p) => p.selected)
    if (selectedPages.length === 0) {
      this.error = 'Please select at least one page to import'
      return
    }
    if (this.importMode === 'convert' && selectedPages.some((page) => !page.analysis)) {
      this.error = 'Analyze and review every selected page before creating the Cadle plan.'
      return
    }
    const unresolved = selectedPages.reduce(
      (total, page) => total + (page.analysis ? pdfReviewCounts(page.analysis.vector).unresolved : 0),
      0
    )
    if (this.importMode === 'convert' && unresolved > 0) {
      this.error = `Review the remaining ${unresolved} uncertain item(s) before creating the Cadle plan.`
      return
    }
    const originalProjectPages = this.project ? { ...(this.project.pages ?? {}) } : null
    try {
      this.isLoading = true
      const { setProjectData } = await import('../api/project.js')
      if (!this.project) throw new Error('No project is currently loaded')
      const existingPageCount = Object.keys(this.project.pages ?? {}).length
      const importedPageKeys: UUID[] = []
      const summaries: PdfConversionSummary[] = []
      for (const [importIndex, pageData] of selectedPages.entries()) {
        const pageName = importedPlanPageName(
          this.#sourceFileName,
          pageData.pageNumber,
          selectedPages.length
        )
        const pageUuid = crypto.randomUUID() as UUID
        const dataUrl = (this.importMode === 'convert' ? pageData.analysis?.processedCanvas : undefined)?.toDataURL('image/png')
          ?? pageData.canvas?.toDataURL('image/png')
        if (!dataUrl) continue
        const paperPreset = paperPresetForPdfPage(pageData.pdfWidth, pageData.pdfHeight)
        const fitted = fitPdfPageToPaper(pageData.width, pageData.height, paperPreset, 10)
        const image: ImageShape = {
          id: crypto.randomUUID(),
          kind: 'image',
          position: fitted.position,
          name: `Old plan – ${pageName}`,
          path: dataUrl,
          width: fitted.width,
          height: fitted.height,
          groupId: `old-plan-${pageUuid}`,
          locked: true
        }
        const sourceVector = this.importMode === 'convert' ? pageData.analysis!.vector : pageData.vector
        const conversion = convertPdfVectorPageToCadle(
          sourceVector,
          {
            x: fitted.position.x - fitted.width / 2,
            y: fitted.position.y - fitted.height / 2,
            width: fitted.width,
            height: fitted.height
          },
          this.importMode === 'background' || this.keepBackground ? image : undefined
        )
        const convertedContentCount = conversion.shapes.length - (conversion.shapes[0] === image ? 1 : 0)
        const shapes = this.importMode === 'convert' && convertedContentCount > 0
          ? conversion.shapes
          : [image]
        if (this.importMode === 'convert') summaries.push(conversion.summary)
        const nativeState: NativeDocumentState = {
          version: 2,
          shapes,
          selectedId: null,
          paperPreset,
          printMargin: 10,
          worldWidth: fitted.worldWidth,
          worldHeight: fitted.worldHeight
        }
        this.project.pages[pageUuid] = {
          creationTime: Date.now(),
          name: pageName,
          schema: {
            version: 'native-svg-1',
            objects: [{ kind: 'cadle-native-svg-document', payload: nativeState }]
          },
          pageType: 'groundplan',
          order: existingPageCount + importIndex
        }
        importedPageKeys.push(pageUuid)
      }

      await setProjectData(this.projectKey, this.project)
      if (this.importMode === 'convert') this.persistReviewedCorrections(selectedPages)
      pubsub.publish('project-updated', { projectKey: this.projectKey })
      pubsub.publish('show-notification', {
        message: this.importMode === 'convert'
          ? `Created ${importedPageKeys.length} reviewed Cadle page(s): ${summaries.reduce((sum, item) => sum + item.symbols, 0)} symbols and ${summaries.reduce((sum, item) => sum + item.vectorLines, 0)} editable lines.`
          : `Imported ${importedPageKeys.length} old-plan page(s) as drawing backgrounds.`
      })
      // Dispatch event to notify parent that import is complete
      this.dispatchEvent(new CustomEvent('import-complete', {
        detail: { pagesImported: importedPageKeys.length, pageKeys: importedPageKeys, summaries }
      }))
    } catch (err) {
      if (this.project && originalProjectPages) this.project.pages = originalProjectPages
      this.error = `Failed to import pages: ${err instanceof Error ? err.message : String(err)}`
      console.error(err)
    } finally {
      this.ocrStatus = ''
      this.isLoading = false
    }
  }

  private handleCancel(): void {
    this.dispatchEvent(new CustomEvent('import-cancel'))
  }

  private focusReviewControl(id: string): void {
    const control = this.shadowRoot?.getElementById(id) as HTMLElement | null
    const details = control?.closest('details')
    if (details) details.open = true
    control?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    control?.focus({ preventScroll: true })
  }

  private activateWithKeyboard(event: KeyboardEvent, action: () => void): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    action()
  }

  private renderReviewOverlay(page: PDFPage) {
    const vector = page.analysis?.vector
    if (!vector) return ''
    return html`<svg class="review-overlay" viewBox=${`0 0 ${vector.width} ${vector.height}`} aria-label="Conversion review overlay">
      ${vector.lines.map((line, index) => line.reviewKind === 'ignore' ? '' : html`<line
        class=${`review-line ${line.reviewKind === 'door' || line.reviewKind === 'window' || line.reviewKind === 'gate'
          ? 'opening'
          : line.reviewKind === 'line' || (line.reviewKind !== 'wall' && line.lineWidth < 1.5) ? 'thin' : 'wall'}`}
        x1=${String(line.x1)} y1=${String(line.y1)} x2=${String(line.x2)} y2=${String(line.y2)}
        role="button" tabindex="0" aria-label=${`Edit line ${index + 1}`}
        @click=${() => this.focusReviewControl(`review-line-${page.pageNumber}-${index}`)}
        @keydown=${(event: KeyboardEvent) => this.activateWithKeyboard(event, () => this.focusReviewControl(`review-line-${page.pageNumber}-${index}`))} />`)}
      ${vector.texts.map((text, index) => {
        const status = pdfReviewStatus(text)
        if (status === 'plain' || text.recognizedKind === 'ignore') return ''
        return html`<circle class=${`review-marker ${status}`} cx=${String(text.x)} cy=${String(text.y)} r=${String(Math.max(5, text.fontSize * 0.7))}
          role="button" tabindex="0" aria-label=${`Review ${text.text}`}
          @click=${() => this.focusReviewControl(`review-text-${page.pageNumber}-${index}`)}
          @keydown=${(event: KeyboardEvent) => this.activateWithKeyboard(event, () => this.focusReviewControl(`review-text-${page.pageNumber}-${index}`))} />`
      })}
    </svg>`
  }

  private renderPreviewSheet(page: PDFPage, overlay: boolean, label: string) {
    const preview = overlay ? page.analysis?.processedPreviewImage ?? page.previewImage : page.previewImage
    return html`<figure class="comparison-sheet">
      <figcaption>${label}</figcaption>
      <div class="preview-scroll">
        <div class="preview-sheet" style=${`aspect-ratio: ${page.width} / ${page.height}; width: ${this.reviewZoom * 100}%`}>
          <img src=${preview ?? ''} alt=${`${label}, page ${page.pageNumber}`} />
          ${overlay && this.showReviewOverlay ? this.renderReviewOverlay(page) : ''}
        </div>
      </div>
    </figure>`
  }

  private reviewCrop(page: PDFPage, x: number, y: number, label: string) {
    const positionX = Math.max(0, Math.min(100, x / Math.max(1, page.pdfWidth) * 100))
    const positionY = Math.max(0, Math.min(100, y / Math.max(1, page.pdfHeight) * 100))
    return html`<button
      class="review-crop"
      type="button"
      title=${`Locate ${label} on page`}
      aria-label=${`Locate ${label} on page`}
      style=${`background-image: url("${page.analysis?.processedPreviewImage ?? page.previewImage ?? ''}"); background-position: ${positionX}% ${positionY}%`}
      @click=${() => {
        this.reviewZoom = 2
        this.shadowRoot?.querySelector('.comparison-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }}></button>`
  }

  private renderPageReview(page: PDFPage) {
    const analysis = page.analysis
    if (!analysis) return ''
    const counts = pdfReviewCounts(analysis.vector)
    const textEntries = analysis.vector.texts.map((text, index) => ({ text, index }))
    const unresolvedTextEntries = textEntries.filter(({ text }) => {
      const status = pdfReviewStatus(text)
      return status === 'check' || status === 'unrecognized'
    })
    const resolvedTextEntries = textEntries.filter(({ text }) => {
      const status = pdfReviewStatus(text)
      return status !== 'check' && status !== 'unrecognized'
    })
    const visibleTextEntries = [
      ...unresolvedTextEntries,
      ...resolvedTextEntries.slice(0, Math.max(0, 100 - unresolvedTextEntries.length))
    ]
    const lineEntries = analysis.vector.lines.map((line, index) => ({ line, index }))
    const pendingLineEntries = lineEntries.filter(({ line }) => line.reviewPending)
    const visibleLineEntries = [
      ...pendingLineEntries,
      ...lineEntries.filter(({ line }) => !line.reviewPending).slice(0, Math.max(0, 120 - pendingLineEntries.length))
    ]
    return html`<div class="review-panel" @click=${(event: Event) => event.stopPropagation()}>
      <div class="review-heading">
        <strong>Review before creating</strong>
        <span>${analysis.summary.walls} walls · ${analysis.vector.lines.length - analysis.summary.walls} lines · ${analysis.summary.symbols} symbols</span>
      </div>
      ${analysis.scanQuality?.warnings.length
        ? html`<div class="scan-quality" role="status">
            ${analysis.scanQuality.warnings.map((warning) => html`<span>${warning}</span>`)}
          </div>`
        : ''}
      <div class="review-actions">
        ${counts.check ? html`<button type="button" @click=${() => this.confirmPageSuggestions(page)}>Confirm ${counts.check} suggestion${counts.check === 1 ? '' : 's'}</button>` : ''}
        <button type="button" ?disabled=${analysis.history.length === 0} @click=${() => this.undoPageReview(page)}>Undo</button>
        <button type="button" @click=${() => this.resetPageReview(page)}>Reset page review</button>
      </div>
      <div class="review-legend">
        <span><i class="confirmed"></i>Confirmed</span>
        <span><i class="check"></i>Check</span>
        <span><i class="unrecognized"></i>Unrecognized</span>
      </div>
      ${analysis.vector.texts.length
        ? html`<div class="review-section">
            <strong>Text and symbols</strong>
            ${visibleTextEntries.map(({ text, index }) => html`<div class=${`review-row ${pdfReviewStatus(text)}`}>
              <span class="status-dot" aria-hidden="true"></span>
              ${this.reviewCrop(page, text.x, text.y, text.text)}
              <input
                id=${`review-text-${page.pageNumber}-${index}`}
                class="review-text"
                .value=${text.text}
                aria-label=${`Recognized text ${index + 1}`}
                @change=${(event: Event) => this.reviewTextValue(page, index, (event.target as HTMLInputElement).value)} />
              <select
                id=${`review-line-${page.pageNumber}-${index}`}
                .value=${text.recognizedKind ?? classifyPdfVectorText(text)}
                aria-label=${`Object type for ${text.text}`}
                @change=${(event: Event) => this.reviewTextKind(page, index, (event.target as HTMLSelectElement).value as PdfRecognizedSymbolKind)}>
                <option value="text">Text</option>
                <option value="socket">Wall outlet</option>
                <option value="switch">Switch</option>
                <option value="lighting">Light point</option>
                <option value="spot">Spot</option>
                <option value="breaker">Breaker</option>
                <option value="rcd">RCD</option>
                <option value="ignore">Ignore</option>
              </select>
              ${pdfReviewStatus(text) === 'check' || pdfReviewStatus(text) === 'unrecognized'
                ? html`<button
                    class="confirm-row"
                    type="button"
                    title="Confirm this choice"
                    aria-label=${`Confirm ${text.text}`}
                    @click=${() => this.reviewTextKind(page, index, text.recognizedKind ?? classifyPdfVectorText(text))}>✓</button>`
                : html`<span></span>`}
              <small>${text.confidence == null ? 'vector' : `${Math.round(text.confidence)}%`}</small>
            </div>`)}
            ${visibleTextEntries.length < analysis.vector.texts.length
              ? html`<small>${analysis.vector.texts.length - visibleTextEntries.length} confirmed/plain text item(s) collapsed.</small>`
              : ''}
          </div>`
        : ''}
      ${analysis.vector.lines.length
        ? html`<details class="review-section" .open=${pendingLineEntries.length > 0}>
            <summary>Walls and lines (${analysis.vector.lines.length})</summary>
            <div class="bulk-line-actions">
              <span>Set all:</span>
              <button type="button" @click=${() => this.setAllPageLines(page, 'auto')}>Auto</button>
              <button type="button" @click=${() => this.setAllPageLines(page, 'wall')}>Walls</button>
              <button type="button" @click=${() => this.setAllPageLines(page, 'line')}>Lines</button>
            </div>
            ${visibleLineEntries.map(({ line, index }) => html`<div class=${`review-row line-review ${line.reviewPending ? 'check' : ''}`}>
              ${this.reviewCrop(page, (line.x1 + line.x2) / 2, (line.y1 + line.y2) / 2, `line ${index + 1}`)}
              <span>Line ${index + 1}</span>
              <select
                .value=${line.reviewKind ?? 'auto'}
                aria-label=${`Line ${index + 1} type`}
                @change=${(event: Event) => this.reviewLineKind(page, index, (event.target as HTMLSelectElement).value as PdfReviewLineKind)}>
                <option value="auto">Auto (${line.lineWidth >= 1.5 ? 'wall' : 'line'})</option>
                <option value="wall">Wall</option>
                <option value="line">Line</option>
                <option value="door">Door</option>
                <option value="window">Window</option>
                <option value="gate">Gate</option>
                <option value="ignore">Remove</option>
              </select>
              ${line.reviewPending
                ? html`<button
                    class="confirm-row"
                    type="button"
                    aria-label=${`Confirm ${line.reviewKind} suggestion for line ${index + 1}`}
                    @click=${() => this.reviewLineKind(page, index, line.reviewKind ?? 'auto')}>✓</button>`
                : ''}
            </div>`)}
            ${visibleLineEntries.length < analysis.vector.lines.length
              ? html`<small>${analysis.vector.lines.length - visibleLineEntries.length} additional lines remain visible in the overlay and keep their automatic classification.</small>`
              : ''}
          </details>`
        : ''}
    </div>`
  }

  render() {
    if (this.isLoading && this.pages.length === 0) {
      return html`
        <div class="container">
          <div class="loading">
            <span class="progress" role="progressbar" aria-label="Loading PDF"></span>
          </div>
        </div>
      `
    }

    const selectedCount = this.pages.filter((p) => p.selected).length
    const selectedPages = this.pages.filter((p) => p.selected)
    const reviewReady = selectedPages.length > 0 && selectedPages.every((page) => page.analysis)
    const unresolvedCount = reviewReady
      ? selectedPages.reduce((total, page) => total + pdfReviewCounts(page.analysis!.vector).unresolved, 0)
      : 0
    const reviewPageIndex = Math.max(0, selectedPages.findIndex((page) => page.pageNumber === this.activeReviewPage))
    const activePage = reviewReady ? selectedPages[reviewPageIndex] ?? selectedPages[0] : null
    const nextIssuePage = reviewReady && unresolvedCount
      ? [...selectedPages.slice(reviewPageIndex + 1), ...selectedPages.slice(0, reviewPageIndex + 1)]
        .find((page) => pdfReviewCounts(page.analysis!.vector).unresolved > 0)
      : null
    const visiblePages = activePage ? [activePage] : this.pages
    return html`
      <div class="container">
        <cadle-header>
          <div>
            <div class="title">Import old plan from PDF</div>
            <div class="subtitle">Convert vector content to editable Cadle objects or keep the PDF as a reference background.</div>
          </div>
          <div
            class="actions"
            slot="end">
            <custom-button
              type="text"
              label="Cancel"
              @click=${() => this.handleCancel()}></custom-button>
            <custom-button
              type="filled"
              .label=${this.importMode === 'convert'
                ? reviewReady && unresolvedCount
                  ? `Review ${unresolvedCount} Item${unresolvedCount === 1 ? '' : 's'}`
                  : `${reviewReady ? 'Create' : 'Analyze'} ${selectedCount} Page${selectedCount !== 1 ? 's' : ''}`
                : `Import ${selectedCount} Page${selectedCount !== 1 ? 's' : ''}`}
              aria-disabled=${String(selectedCount === 0 || this.isLoading || (reviewReady && unresolvedCount > 0))}
              @click=${() => {
                if (selectedCount === 0 || this.isLoading || (reviewReady && unresolvedCount > 0)) return
                if (this.importMode === 'convert' && !reviewReady) void this.analyzeSelectedPages()
                else void this.importSelectedPages()
              }}></custom-button>
          </div>
        </cadle-header>
        ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : ''}
        <div class="import-options">
          <label>
            <input
              type="radio"
              name="import-mode"
              value="convert"
              .checked=${this.importMode === 'convert'}
              @change=${() => { this.importMode = 'convert'; this.invalidateAnalysis() }} />
            <span><strong>Convert to Cadle plan</strong><small>Editable lines, text and confidently recognized current symbols</small></span>
          </label>
          <label>
            <input
              type="radio"
              name="import-mode"
              value="background"
              .checked=${this.importMode === 'background'}
              @change=${() => { this.importMode = 'background'; this.invalidateAnalysis() }} />
            <span><strong>Reference background only</strong><small>Keep each PDF page as a locked image</small></span>
          </label>
          ${this.importMode === 'convert'
            ? html`<label class="scan-geometry">
                <input type="checkbox" .checked=${this.scanGeometry} @change=${(event: Event) => { this.scanGeometry = (event.target as HTMLInputElement).checked; this.invalidateAnalysis() }} />
                <span><strong>Detect scan walls and lines</strong><small>Long raster strokes become editable Cadle geometry; small details stay on the underlay</small></span>
              </label>
              <label class="scan-enhance">
                <input type="checkbox" .checked=${this.enhanceScan} @change=${(event: Event) => { this.enhanceScan = (event.target as HTMLInputElement).checked; this.invalidateAnalysis() }} />
                <span><strong>Improve and straighten scans</strong><small>Local contrast enhancement, quality checks and automatic correction up to 3°</small></span>
              </label>
              <label class="scan-ocr">
                <input type="checkbox" .checked=${this.scanOcr} @change=${(event: Event) => { this.scanOcr = (event.target as HTMLInputElement).checked; this.invalidateAnalysis() }} />
                <span><strong>Recognize scan text locally</strong><small>Dutch and English OCR; clear labels become editable objects and current symbols</small></span>
              </label>
              <label class="scan-symbols">
                <input type="checkbox" .checked=${this.scanSymbols} @change=${(event: Event) => { this.scanSymbols = (event.target as HTMLInputElement).checked; this.invalidateAnalysis() }} />
                <span><strong>Recognize unlabelled electrical symbols</strong><small>Unique light points are accepted automatically; probable switches and grounded outlets require review</small></span>
              </label>
              <label class="keep-background">
                <input type="checkbox" .checked=${this.keepBackground} @change=${(event: Event) => (this.keepBackground = (event.target as HTMLInputElement).checked)} />
                <span><strong>Keep original underlay</strong><small>Recommended for checking uncertain or unrecognized old symbols</small></span>
              </label>
              <div class="correction-tools">
                <span><strong>Learned PDF corrections</strong><small>Move your reviewed OCR choices between browsers or computers.</small></span>
                <button type="button" @click=${() => this.exportCorrections()}>Export JSON</button>
                <label class="file-button">Import JSON<input type="file" accept="application/json,.json" @change=${(event: Event) => void this.importCorrections(event)} /></label>
              </div>`
            : ''}
        </div>
        ${this.ocrStatus ? html`<div class="ocr-progress" role="status" aria-live="polite"><span class="progress" aria-hidden="true"></span><span>${this.ocrStatus}</span></div>` : ''}
        ${this.pages.length > 0
          ? html`
              <div class="select-all-section">
                ${activePage
                  ? html`<span>${selectedCount} reviewed page${selectedCount === 1 ? '' : 's'}</span>
                      <button type="button" @click=${() => { this.invalidateAnalysis(); this.activeReviewPage = 0 }}>Change page selection or analysis settings</button>`
                  : html`<input
                      type="checkbox"
                      .checked=${this.pages.every((p) => p.selected)}
                      .indeterminate=${this.pages.some((p) => p.selected) && !this.pages.every((p) => p.selected)}
                      aria-label="Select all pages"
                      @change=${() => this.toggleAllPages()} />
                    <span>${selectedCount} of ${this.pages.length} pages selected</span>`}
              </div>
            `
          : ''}
        ${activePage
          ? html`<div class="review-navigation">
              <button
                type="button"
                ?disabled=${reviewPageIndex <= 0}
                @click=${() => (this.activeReviewPage = selectedPages[Math.max(0, reviewPageIndex - 1)]?.pageNumber ?? activePage.pageNumber)}>← Previous</button>
              <span>Reviewing page ${reviewPageIndex + 1} of ${selectedPages.length}${unresolvedCount ? ` · ${unresolvedCount} item${unresolvedCount === 1 ? '' : 's'} remaining` : ' · ready to create'}</span>
              <div class="review-next-actions">
                <button type="button" @click=${() => (this.reviewZoom = Math.max(0.5, this.reviewZoom - 0.25))} aria-label="Zoom out">−</button>
                <button type="button" @click=${() => (this.reviewZoom = 1)}>${Math.round(this.reviewZoom * 100)}%</button>
                <button type="button" @click=${() => (this.reviewZoom = Math.min(3, this.reviewZoom + 0.25))} aria-label="Zoom in">+</button>
                <button type="button" aria-pressed=${String(this.showReviewOverlay)} @click=${() => (this.showReviewOverlay = !this.showReviewOverlay)}>${this.showReviewOverlay ? 'Hide' : 'Show'} overlay</button>
                ${nextIssuePage && nextIssuePage.pageNumber !== activePage.pageNumber
                  ? html`<button type="button" @click=${() => (this.activeReviewPage = nextIssuePage.pageNumber)}>Next issue</button>`
                  : ''}
                <button
                  type="button"
                  ?disabled=${reviewPageIndex >= selectedPages.length - 1}
                  @click=${() => (this.activeReviewPage = selectedPages[Math.min(selectedPages.length - 1, reviewPageIndex + 1)]?.pageNumber ?? activePage.pageNumber)}>Next →</button>
              </div>
            </div>`
          : ''}
        <div class=${`pages-container ${activePage ? 'review-mode' : ''}`}>
          ${visiblePages.map(
            (page) => html`
              <div
                class="page-item ${page.selected ? 'selected' : ''}"
                role=${activePage ? 'group' : 'checkbox'}
                tabindex=${activePage ? '-1' : '0'}
                aria-checked=${activePage ? undefined : String(page.selected)}
                @click=${() => { if (!activePage) this.togglePageSelection(page.pageNumber) }}
                @keydown=${(event: KeyboardEvent) => {
                  if (!activePage) this.activateWithKeyboard(event, () => this.togglePageSelection(page.pageNumber))
                }}>
                <div class="page-preview">
                  ${page.previewImage
                    ? activePage
                      ? html`<div class="comparison-preview">
                          ${this.renderPreviewSheet(page, false, 'Original')}
                          ${this.renderPreviewSheet(page, true, 'Cadle conversion review')}
                        </div>`
                      : html`<div class="preview-sheet" style=${`aspect-ratio: ${page.width} / ${page.height}`}>
                          <img src=${page.previewImage} alt=${`Page ${page.pageNumber}`} />
                        </div>`
                    : 'Loading...'}
                </div>
                <div class="page-footer">
                  <span class="page-number">
                    Page ${page.pageNumber}
                    <small>
                      ${page.vector.lines.length || page.vector.texts.length
                        ? page.analysis
                          ? `Reviewed · ${page.analysis.vector.lines.length} lines · ${page.analysis.vector.texts.length} text items`
                          : `${page.vector.lines.length} vector lines · ${page.vector.texts.length} text items`
                        : this.scanOcr && this.importMode === 'convert'
                          ? page.analysis
                            ? `Reviewed scan · ${page.analysis.vector.lines.length} lines · ${page.analysis.vector.texts.length} text items`
                            : 'Scan/image · analyze before conversion'
                          : 'Scan/image · background import only'}
                    </small>
                  </span>
                  ${activePage ? '' : html`<input
                      type="checkbox"
                      .checked=${page.selected}
                      aria-label=${`Select page ${page.pageNumber}`}
                      @click=${(e: Event) => {
                        e.stopPropagation()
                        this.togglePageSelection(page.pageNumber)
                      }} />`}
                </div>
                ${this.renderPageReview(page)}
              </div>
            `
          )}
        </div>
      </div>
    `
  }
}
