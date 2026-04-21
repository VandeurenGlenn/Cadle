import { LitElement, html, css } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import '@material/web/button/text-button.js'
import '@material/web/button/filled-button.js'
import '@material/web/checkbox/checkbox.js'
import '@material/web/progress/circular-progress.js'
import './header.js'
import * as pdfjsLib from 'pdfjs-dist'

async function getPdfjsLib() {
  console.log('pdfjsLib', pdfjsLib)

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
}

declare global {
  interface HTMLElementTagNameMap {
    'pdf-importer': PDFImporter
  }
}

@customElement('pdf-importer')
export class PDFImporter extends LitElement {
  @property({ type: Object })
  pdfDocument: any = null

  @state()
  pages: PDFPage[] = []

  @state()
  isLoading = false

  @state()
  error: string | null = null

  static styles = [
    css`
      :host {
        display: block;
        width: 100%;
        height: 100%;
        background: var(--md-sys-color-surface);
      }

      .container {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 20px;
      }

      cadle-header {
        margin-bottom: 20px;
      }

      .title {
        font-size: 24px;
        font-weight: 500;
        color: var(--md-sys-color-on-surface);
      }

      .actions {
        display: flex;
        gap: 10px;
      }

      .pages-container {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        gap: 16px;
        overflow-y: auto;
        flex: 1;
        padding: 10px;
      }

      .page-item {
        border: 2px solid var(--md-sys-color-outline);
        border-radius: 8px;
        overflow: hidden;
        cursor: pointer;
        transition: all 0.2s ease;
        background: var(--md-sys-color-surface-variant);
      }

      .page-item:hover {
        border-color: var(--md-sys-color-primary);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .page-item.selected {
        border-color: var(--md-sys-color-primary);
        background: var(--md-sys-color-primary-container);
      }

      .page-preview {
        position: relative;
        width: 100%;
        aspect-ratio: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        background: white;
        min-height: 200px;
      }

      .page-preview img {
        max-width: 100%;
        max-height: 300px;
        object-fit: contain;
      }

      .page-footer {
        padding: 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-top: 1px solid var(--md-sys-color-outline);
      }

      .page-number {
        font-size: 14px;
        color: var(--md-sys-color-on-surface-variant);
        font-weight: 500;
      }

      md-checkbox {
        margin: 0;
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
      }

      .error {
        color: var(--md-sys-color-error);
        padding: 16px;
        background: var(--md-sys-color-error-container);
        border-radius: 8px;
        margin-bottom: 16px;
      }

      .select-all-section {
        padding: 10px;
        border-bottom: 1px solid var(--md-sys-color-outline);
        display: flex;
        align-items: center;
        gap: 10px;
      }

      md-text-button,
      md-filled-button {
        pointer-events: auto;
      }
    `
  ]

  async loadPDF(file: File): Promise<void> {
    try {
      this.isLoading = true
      this.error = null
      const pdfjs = await getPdfjsLib()
      const arrayBuffer = await file.arrayBuffer()
      this.pdfDocument = await pdfjs.getDocument({ data: arrayBuffer }).promise
      await this.renderPages()
    } catch (err) {
      this.error = `Failed to load PDF: ${err.message}`
      console.error(err)
    } finally {
      this.isLoading = false
    }
  }

  private async renderPages(): Promise<void> {
    const pages: PDFPage[] = []

    for (let i = 1; i <= this.pdfDocument.numPages; i++) {
      const page = await this.pdfDocument.getPage(i)
      const viewport = page.getViewport({ scale: 1.5 })

      // Create canvas for PDF rendering
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      canvas.width = viewport.width
      canvas.height = viewport.height

      // Render page to canvas
      await page.render({ canvasContext: context!, viewport }).promise

      // Convert canvas to image for preview
      const previewImage = canvas.toDataURL('image/png')

      pages.push({
        pageNumber: i,
        canvas,
        previewImage,
        selected: true, // Select all pages by default
        width: viewport.width,
        height: viewport.height
      })
    }

    this.pages = pages
  }

  private togglePageSelection(pageNumber: number): void {
    const page = this.pages.find((p) => p.pageNumber === pageNumber)
    if (page) {
      page.selected = !page.selected
      this.requestUpdate()
    }
  }

  private toggleAllPages(): void {
    const allSelected = this.pages.every((p) => p.selected)
    this.pages.forEach((p) => {
      p.selected = !allSelected
    })
    this.requestUpdate()
  }

  private async importSelectedPages(): Promise<void> {
    const selectedPages = this.pages.filter((p) => p.selected)

    if (selectedPages.length === 0) {
      this.error = 'Please select at least one page to import'
      return
    }

    try {
      this.isLoading = true

      const cadleShell = (globalThis as any).cadleShell
      const { setProjectData } = await import('../api/project.js')
      const { FabricImage } = await import('fabric')

      for (const pageData of selectedPages) {
        const pageName = `Page ${pageData.pageNumber}`
        const pageUuid = crypto.randomUUID()

        // Use the canvas as our source
        const dataUrl = pageData.canvas!.toDataURL('image/png')

        // Create a FabricImage from the data URL
        const fabricImage = await FabricImage.fromURL(
          dataUrl,
          {},
          {
            left: 0,
            top: 0,
            selectable: true,
            evented: true
          }
        )

        // Convert to JSON for storage
        const imageObject = fabricImage.toJSON()

        cadleShell.project.pages[pageUuid] = {
          name: pageName,
          schema: {
            version: '6.0.0',
            objects: [imageObject]
          }
        }
      }

      await setProjectData(cadleShell.projectKey, cadleShell.project)

      pubsub.publish('project-updated', { projectKey: cadleShell.projectKey })
      pubsub.publish('show-notification', { message: `Imported ${selectedPages.length} page(s) successfully!` })
      // Dispatch event to notify parent that import is complete
      this.dispatchEvent(new CustomEvent('import-complete', { detail: { pagesImported: selectedPages.length } }))
    } catch (err) {
      this.error = `Failed to import pages: ${err.message}`
      console.error(err)
    } finally {
      this.isLoading = false
    }
  }

  private handleCancel(): void {
    this.dispatchEvent(new CustomEvent('import-cancel'))
  }

  render() {
    if (this.isLoading && this.pages.length === 0) {
      return html`
        <div class="container">
          <div class="loading">
            <md-circular-progress indeterminate></md-circular-progress>
          </div>
        </div>
      `
    }

    const selectedCount = this.pages.filter((p) => p.selected).length

    return html`
      <div class="container">
        <cadle-header>
          <div class="title">Select PDF Pages to Import</div>
          <div
            class="actions"
            slot="end">
            <md-text-button @click=${() => this.handleCancel()}>Cancel</md-text-button>
            <md-filled-button
              @click=${() => this.importSelectedPages()}
              ?disabled=${selectedCount === 0}>
              Import ${selectedCount} Page${selectedCount !== 1 ? 's' : ''}
            </md-filled-button>
          </div>
        </cadle-header>

        ${this.error ? html`<div class="error">${this.error}</div>` : ''}
        ${this.pages.length > 0
          ? html`
              <div class="select-all-section">
                <md-checkbox
                  ?checked=${this.pages.every((p) => p.selected)}
                  ?indeterminate=${this.pages.some((p) => p.selected) && !this.pages.every((p) => p.selected)}
                  @change=${() => this.toggleAllPages()}></md-checkbox>
                <span>${selectedCount} of ${this.pages.length} pages selected</span>
              </div>
            `
          : ''}

        <div class="pages-container">
          ${this.pages.map(
            (page) => html`
              <div
                class="page-item ${page.selected ? 'selected' : ''}"
                @click=${() => this.togglePageSelection(page.pageNumber)}>
                <div class="page-preview">
                  ${page.previewImage
                    ? html`<img
                        src="${page.previewImage}"
                        alt="Page ${page.pageNumber}" />`
                    : 'Loading...'}
                </div>
                <div class="page-footer">
                  <span class="page-number">Page ${page.pageNumber}</span>
                  <md-checkbox
                    ?checked=${page.selected}
                    @click=${(e: Event) => {
                      e.stopPropagation()
                      this.togglePageSelection(page.pageNumber)
                    }}></md-checkbox>
                </div>
              </div>
            `
          )}
        </div>
      </div>
    `
  }
}
