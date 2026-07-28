import { LiteElement, customElement, html, listen, property, query } from '@vandeurenglenn/lite'
import '@vandeurenglenn/lite-elements/button.js'
import styles from './signature-pad-dialog.css' with { type: 'css' }
import {
  includeSignaturePoint,
  pointOnSignatureCanvas,
  signatureCropRect,
  type SignatureBounds,
  type SignaturePoint
} from '../../helpers/signature-canvas.js'

export type SignatureRole = 'installer' | 'customer'

export type SignatureSavedDetail = {
  role: SignatureRole
  dataUrl: string
}

@customElement('signature-pad-dialog')
export class SignaturePadDialog extends LiteElement {
  @property({ type: Boolean, reflect: true }) accessor open = false
  @property({ type: String }) accessor signatureRole: SignatureRole = 'installer'

  @query('.signature-canvas') accessor canvas!: HTMLCanvasElement
  @query('.use-signature') accessor useSignatureButton!: HTMLElement

  static styles = [styles]

  #activePointerId: number | null = null
  #lastPoint: SignaturePoint | null = null
  #bounds: SignatureBounds | null = null
  #hasInk = false

  onChange(property: string) {
    if (property === 'open' && this.open) {
      queueMicrotask(() => {
        this.#resetCanvas()
        this.canvas?.focus()
      })
    }
  }

  #context() {
    const context = this.canvas?.getContext('2d')
    if (!context) return null
    context.strokeStyle = '#171412'
    context.fillStyle = '#171412'
    context.lineCap = 'round'
    context.lineJoin = 'round'
    return context
  }

  #point(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect()
    return pointOnSignatureCanvas(
      rect,
      this.canvas.width,
      this.canvas.height,
      event.clientX,
      event.clientY
    )
  }

  #includePoint(point: SignaturePoint) {
    this.#bounds = includeSignaturePoint(this.#bounds, point)
  }

  #setHasInk(value: boolean) {
    this.#hasInk = value
    this.useSignatureButton?.toggleAttribute('disabled', !value)
  }

  #resetCanvas = () => {
    const context = this.#context()
    context?.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.#activePointerId = null
    this.#lastPoint = null
    this.#bounds = null
    this.#setHasInk(false)
  }

  #close = () => {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  @listen('keydown', { target: 'window' })
  onWindowKeydown(event: KeyboardEvent) {
    if (this.open && event.key === 'Escape') this.#close()
  }

  @listen('pointerdown', { target: '.signature-canvas' })
  onPointerDown(event: PointerEvent) {
    if (!this.open || this.#activePointerId !== null || event.button > 0) return
    event.preventDefault()
    const context = this.#context()
    if (!context) return

    const point = this.#point(event)
    this.#activePointerId = event.pointerId
    this.#lastPoint = point
    this.canvas.setPointerCapture(event.pointerId)
    context.beginPath()
    context.arc(point.x, point.y, 2.8, 0, Math.PI * 2)
    context.fill()
    this.#includePoint(point)
    this.#setHasInk(true)
  }

  @listen('pointermove', { target: '.signature-canvas' })
  onPointerMove(event: PointerEvent) {
    if (event.pointerId !== this.#activePointerId || !this.#lastPoint) return
    event.preventDefault()
    const context = this.#context()
    if (!context) return

    const point = this.#point(event)
    context.lineWidth = event.pointerType === 'pen' && event.pressure > 0
      ? 3.4 + event.pressure * 4.2
      : 5.2
    context.beginPath()
    context.moveTo(this.#lastPoint.x, this.#lastPoint.y)
    context.lineTo(point.x, point.y)
    context.stroke()
    this.#includePoint(point)
    this.#lastPoint = point
  }

  @listen('pointerup', { target: '.signature-canvas' })
  @listen('pointercancel', { target: '.signature-canvas' })
  onPointerEnd(event: PointerEvent) {
    if (event.pointerId !== this.#activePointerId) return
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
    this.#activePointerId = null
    this.#lastPoint = null
  }

  #useSignature = () => {
    if (!this.#hasInk || !this.#bounds) return
    const crop = signatureCropRect(this.#bounds, this.canvas.width, this.canvas.height)
    const output = document.createElement('canvas')
    output.width = crop.width
    output.height = crop.height
    const context = output.getContext('2d')
    if (!context) return
    context.drawImage(
      this.canvas,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height
    )
    const dataUrl = output.toDataURL('image/png')
    output.width = 1
    output.height = 1
    this.dispatchEvent(new CustomEvent<SignatureSavedDetail>('signature-saved', {
      bubbles: true,
      composed: true,
      detail: { role: this.signatureRole, dataUrl }
    }))
  }

  render() {
    const person = this.signatureRole === 'installer' ? 'installateur' : 'eigenaar'
    return html`
      <div class="backdrop" @click=${this.#close}></div>
      <section class="panel" role="dialog" aria-modal="true" aria-labelledby="signature-pad-title">
        <header>
          <div>
            <h3 id="signature-pad-title">Handtekening ${person}</h3>
            <p>Teken met je muis, vinger of stylus.</p>
          </div>
          <custom-button type="text" label="Sluiten" @click=${this.#close}></custom-button>
        </header>
        <main>
          <div class="canvas-frame">
            <canvas
              class="signature-canvas"
              width="1200"
              height="400"
              tabindex="0"
              role="img"
              aria-label="Tekenveld voor de handtekening van de ${person}"></canvas>
          </div>
          <span class="hint">De hulplijn wordt niet mee opgeslagen.</span>
        </main>
        <footer>
          <div class="secondary-actions">
            <custom-button type="text" label="Wissen" @click=${this.#resetCanvas}></custom-button>
          </div>
          <div class="primary-actions">
            <custom-button type="outlined" label="Annuleren" @click=${this.#close}></custom-button>
            <custom-button
              class="use-signature"
              type="filled"
              label="Handtekening gebruiken"
              disabled
              @click=${this.#useSignature}></custom-button>
          </div>
        </footer>
      </section>
    `
  }
}
