import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './styles/item.css' with { type: 'css' }
import { unsafeSVG } from 'lit/directives/unsafe-svg.js'
import type { JsonValue } from '../../types.js'
import state from '../../state.js'
import pubsub from '../../pubsub.js'
import '@vandeurenglenn/lite-elements/menu.js'
import '@vandeurenglenn/lite-elements/dropdown.js'
import '@vandeurenglenn/lite-elements/list-item.js'
import '@vandeurenglenn/lite-elements/icon.js'
declare global {
  interface HTMLElementTagNameMap {
    'catalog-item': CatalogItem
  }
}

type SymbolMetadata = Record<string, JsonValue> & {
  kind?: string
  bindingRole?: string
  bindingId?: string
  situationElementType?: string
  sourceObjectUuid?: string
  oneLineEligible?: boolean
  situationMetadata?: JsonValue
}

@customElement('catalog-item')
export class CatalogItem extends LiteElement {
  @property({ type: String })
  accessor category = ''

  @property({ type: String })
  accessor folder = ''

  @property({ attribute: false })
  accessor symbol:
    | {
        kind?: string
        name: string
        path: string
        metadata?: Record<string, JsonValue>
      }
    | undefined

  @property({ type: String })
  accessor image = ''

  @property({ type: String, consumes: 'loadedPage' })
  accessor loadedPage = ''

  private _svgPreview = ''
  private _menuOpen = false
  private _menuX = 0
  private _menuY = 0
  private static _magnifierElement?: HTMLDivElement
  set headline(value: string) {
    // this.title = value
    this._headline = value.length > 28 ? `${value.slice(0, 28)} ...` : value
    this.requestRender()
  }

  get headline(): string {
    return this._headline
  }

  private _headline: string = ''

  static styles = [styles]

  #openMagnifier = (event: MouseEvent | PointerEvent) => {
    if (window.matchMedia('(hover: none)').matches) return
    if (!this._svgPreview && !this.symbol?.path && !this.image) return
    const row =
      (event.currentTarget as HTMLElement | null) ?? (this.shadowRoot?.querySelector('.row') as HTMLElement | null)
    this.#showMagnifier(row)
  }

  #moveMagnifier = (event: MouseEvent | PointerEvent) => {
    const row =
      (event.currentTarget as HTMLElement | null) ?? (this.shadowRoot?.querySelector('.row') as HTMLElement | null)
    this.#positionMagnifier(row)
  }

  #getMagnifierElement() {
    if (CatalogItem._magnifierElement?.isConnected) return CatalogItem._magnifierElement
    const element = document.createElement('div')
    element.style.position = 'fixed'
    element.style.width = '170px'
    element.style.height = '130px'
    element.style.borderRadius = '14px'
    element.style.border = '1px solid var(--cadle-glass-border)'
    element.style.background = 'var(--cadle-glass-bg-strong)'
    element.style.boxShadow = '0 12px 24px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.1)'
    element.style.padding = '10px'
    element.style.boxSizing = 'border-box'
    element.style.pointerEvents = 'none'
    element.style.zIndex = '2147483647'
    element.style.display = 'none'
    element.style.backdropFilter = 'blur(var(--cadle-glass-blur))'
    ;(element.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter =
      'blur(var(--cadle-glass-blur))'
    document.body.append(element)
    CatalogItem._magnifierElement = element
    return element
  }

  #renderMagnifierContent(target: HTMLDivElement) {
    const previewSource = this.symbol?.path ?? this.image
    target.style.color = getComputedStyle(this).color
    if (this._svgPreview) {
      target.innerHTML = this._svgPreview
      const svg = target.querySelector('svg') as SVGElement | null
      if (svg) {
        svg.style.display = 'block'
        svg.style.width = '100%'
        svg.style.height = '100%'
      }
      return
    }

    if (previewSource) {
      target.innerHTML = ''
      const image = document.createElement('img')
      image.src = previewSource
      image.alt = ''
      image.style.display = 'block'
      image.style.width = '100%'
      image.style.height = '100%'
      image.style.objectFit = 'contain'
      target.append(image)
      return
    }

    target.innerHTML = ''
  }

  #showMagnifier(row: HTMLElement | null) {
    const target = this.#getMagnifierElement()
    this.#renderMagnifierContent(target)
    this.#positionMagnifier(row)
    target.style.display = 'block'
  }

  #positionMagnifier(row: HTMLElement | null) {
    const target = this.#getMagnifierElement()
    const anchorRect = (row ?? this).getBoundingClientRect()
    const gap = 16
    const magnifierWidth = 170
    const magnifierHeight = 130
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    let left = anchorRect.right + gap
    const top = anchorRect.top + (anchorRect.height - magnifierHeight) / 2
    if (left + magnifierWidth > viewportWidth - gap) {
      left = anchorRect.left - magnifierWidth - gap
    }

    const clampedLeft = Math.max(gap, Math.min(left, viewportWidth - magnifierWidth - gap))
    const clampedTop = Math.max(gap, Math.min(top, viewportHeight - magnifierHeight - gap))
    target.style.left = `${clampedLeft}px`
    target.style.top = `${clampedTop}px`
  }

  #closeMagnifier = () => {
    if (CatalogItem._magnifierElement) CatalogItem._magnifierElement.style.display = 'none'
  }

  #closeContextMenu = () => {
    this._menuOpen = false
    document.removeEventListener('pointerdown', this.#onDocumentPointerDown, true)
    this.requestRender()
  }

  #onDocumentPointerDown = (event: Event) => {
    if (!this._menuOpen) return
    const path = event.composedPath()
    if (path.includes(this)) return
    this.#closeContextMenu()
  }

  override disconnectedCallback(): void {
    this.#closeMagnifier()
    document.removeEventListener('pointerdown', this.#onDocumentPointerDown, true)
    super.disconnectedCallback()
  }

  onChange(name: string): void {
    if (name === 'image' || name === 'symbol') {
      this.#syncSvgPreview()
    }
  }

  async #syncSvgPreview() {
    const sourcePath = this.symbol?.path ?? this.image
    if (!sourcePath) {
      this._svgPreview = ''
      return
    }

    try {
      const markup = await this.#loadSvgMarkup(sourcePath)
      this._svgPreview = this.#themeSvgMarkup(markup)
      this.requestRender()
    } catch {
      this._svgPreview = ''
      this.requestRender()
    }
  }

  async #loadSvgMarkup(sourcePath: string) {
    if (sourcePath.startsWith('data:image/svg+xml')) {
      const [, payload = ''] = sourcePath.split(',', 2)
      if (sourcePath.includes(';base64,')) return atob(payload)
      return decodeURIComponent(payload)
    }

    const resolvedSourcePath = new URL(sourcePath, location.href).toString()
    const candidates = [resolvedSourcePath, encodeURI(resolvedSourcePath), sourcePath]
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate)
        if (response.ok) return response.text()
      } catch {
        // Try next candidate.
      }
    }

    throw new Error(`Failed to fetch SVG markup for ${sourcePath}`)
  }

  #themeSvgMarkup(markup: string) {
    const themedMarkup = this.#replaceBlackColorTokens(markup)
    const doc = new DOMParser().parseFromString(themedMarkup, 'image/svg+xml')
    const svg = doc.documentElement
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') return ''
    svg.setAttribute('width', '100%')
    svg.setAttribute('height', '100%')
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    const elements = svg.querySelectorAll('*')
    for (const element of elements) {
      this.#applyThemeColor(element, 'fill')
      this.#applyThemeColor(element, 'stroke')
      this.#replaceInlineStyleColor(element)
    }
    return new XMLSerializer().serializeToString(svg)
  }

  #replaceBlackColorTokens(markup: string) {
    return markup
      .replace(/(#000000|#000|black|#111111|#111|#222222|#222)(?![\w-])/gi, 'currentColor')
      .replace(/rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)/gi, 'currentColor')
      .replace(/rgb\(\s*17\s*,\s*17\s*,\s*17\s*\)/gi, 'currentColor')
      .replace(/rgb\(\s*34\s*,\s*34\s*,\s*34\s*\)/gi, 'currentColor')
  }

  #applyThemeColor(element: Element, attribute: 'fill' | 'stroke') {
    const value = element.getAttribute(attribute)
    if (!value) return
    const normalized = value.trim().toLowerCase()
    if (normalized === 'none' || normalized === 'transparent') return
    if (
      normalized === '#000' ||
      normalized === '#000000' ||
      normalized === 'black' ||
      normalized === '#111' ||
      normalized === '#111111' ||
      normalized === '#222' ||
      normalized === '#222222'
    ) {
      element.setAttribute(attribute, 'currentColor')
    }
  }

  #replaceInlineStyleColor(element: Element) {
    const style = element.getAttribute('style')
    if (!style) return
    element.setAttribute(
      'style',
      style
        .replace(/fill\s*:\s*(#000000|#000|black|#111111|#111|#222222|#222)/gi, 'fill: currentColor')
        .replace(/stroke\s*:\s*(#000000|#000|black|#111111|#111|#222222|#222)/gi, 'stroke: currentColor')
    )
  }

  #isDarkSvgColor(value) {
    if (typeof value !== 'string') return false
    const normalized = value.trim().toLowerCase()
    return (
      normalized === '#000' ||
      normalized === '#000000' ||
      normalized === 'black' ||
      normalized === '#111' ||
      normalized === '#111111' ||
      normalized === '#222' ||
      normalized === '#222222' ||
      normalized === 'rgb(0,0,0)' ||
      normalized === 'rgb(0, 0, 0)' ||
      normalized === 'rgb(17,17,17)' ||
      normalized === 'rgb(17, 17, 17)' ||
      normalized === 'rgb(34,34,34)' ||
      normalized === 'rgb(34, 34, 34)'
    )
  }

  #normalizeBindingId(value) {
    if (typeof value !== 'string') return ''
    return value.trim().toUpperCase()
  }

  #inferBindingRole(path: string, name: string) {
    const value = `${path} ${name}`.toLowerCase()
    if (value.includes('/switches/') || value.includes(' switch')) return 'switch'
    if (
      value.includes('/consumption appliances/') ||
      value.includes('/electrical devices/') ||
      value.includes('/socket outlets/') ||
      value.includes('socket outlet') ||
      value.includes('socket') ||
      value.includes('light') ||
      value.includes('lamp')
    ) {
      return 'load'
    }
    return 'neutral'
  }

  #nativeSymbolMetadata(sourcePath: string): SymbolMetadata {
    const metadata = (this.symbol?.metadata ?? {}) as SymbolMetadata
    const roleFromMeta = typeof metadata.bindingRole === 'string' ? metadata.bindingRole : undefined
    const inferredRole = this.#inferBindingRole(sourcePath, this.symbol?.name ?? this._headline ?? '')
    const bindingRole = roleFromMeta ?? inferredRole
    const seededBindingId = this.#normalizeBindingId(String(metadata.bindingId ?? state.text.current ?? ''))
    const next: SymbolMetadata = {
      ...metadata,
      symbolName: this.symbol?.name ?? this._headline,
      symbolPath: sourcePath as JsonValue,
      bindingRole,
      oneLineEligible:
        metadata.oneLineEligible === true ||
        bindingRole === 'switch' ||
        bindingRole === 'load' ||
        !!metadata.situationElementType,
      situationElementType:
        typeof metadata.situationElementType === 'string' ? metadata.situationElementType : undefined,
      situationMetadata:
        metadata.situationMetadata && typeof metadata.situationMetadata === 'object'
          ? metadata.situationMetadata
          : undefined,
      kind:
        typeof this.symbol?.kind === 'string'
          ? this.symbol.kind
          : typeof metadata.kind === 'string'
            ? metadata.kind
            : this.category,
      sourceObjectUuid: typeof metadata.sourceObjectUuid === 'string' ? metadata.sourceObjectUuid : undefined
    }
    if (seededBindingId) next.bindingId = seededBindingId
    return next
  }

  #click = async () => {
    const sourcePath = this.symbol?.path ?? this.image
    const sourceName = this.symbol?.name ?? this._headline
    if (!sourcePath || !sourceName) return
    pubsub.publish('shell.action', 'draw-symbol')
    pubsub.publish('native.catalog.pick', {
      name: sourceName,
      path: sourcePath,
      metadata: this.#nativeSymbolMetadata(sourcePath)
    })
    this.dispatchEvent(
      new CustomEvent('catalog-symbol-picked', {
        detail: {
          symbol: this.symbol,
          category: this.category,
          folder: this.folder
        },
        bubbles: true,
        composed: true
      })
    )
  }

  #onDragStart = (event: DragEvent) => {
    if (!event.dataTransfer) return
    const sourcePath = this.symbol?.path ?? this.image
    const sourceName = this.symbol?.name ?? this._headline
    if (!sourcePath || !sourceName || !this.category) return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(
      'application/x-cadle-catalog-dnd',
      JSON.stringify({
        kind: 'symbol',
        name: sourceName,
        path: sourcePath,
        fromCategory: this.category,
        fromFolder: this.folder || undefined
      })
    )
  }

  #openContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    this._menuX = event.clientX
    this._menuY = event.clientY
    this._menuOpen = true
    document.addEventListener('pointerdown', this.#onDocumentPointerDown, true)
    this.requestRender()
  }

  #onMenuSelected = async ({ detail }: CustomEvent) => {
    const action = (detail as Element | null)?.getAttribute?.('action')
    if (action !== 'export-symbol') {
      this.#closeContextMenu()
      return
    }

    const sourcePath = this.symbol?.path ?? this.image
    const fileName = (this.symbol?.name ?? this._headline ?? 'symbol').trim().replace(/\s+/g, '-')
    if (!sourcePath) {
      this.#closeContextMenu()
      return
    }

    try {
      const markup = await this.#loadSvgMarkup(sourcePath)
      const blob = new Blob([markup], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${fileName || 'symbol'}.svg`
      anchor.click()
      URL.revokeObjectURL(url)
    } finally {
      this.#closeContextMenu()
    }
  }

  firstRender(): void {
    this.addListener('click', this.#click)
    this.addListener('dragstart', this.#onDragStart)
    this.addListener('contextmenu', this.#openContextMenu)
  }

  render() {
    const previewSource = this.symbol?.path ?? this.image
    return html`
      <div
        class="row"
        draggable="true"
        @mouseenter=${this.#openMagnifier}
        @mousemove=${this.#moveMagnifier}
        @mouseleave=${this.#closeMagnifier}>
        <span class="headline">${this.headline}</span>
        <flex-it></flex-it>
        <slot name="end">
          <span
            class="preview"
            aria-hidden="true"
            >${this._svgPreview
              ? unsafeSVG(this._svgPreview)
              : previewSource
                ? html`<img
                    class="magnifier-image"
                    src=${previewSource}
                    alt="" />`
                : ''}</span
          >
        </slot>
      </div>
      <custom-dropdown
        class="symbol-contextmenu"
        style="position: fixed; left: ${this._menuX}px; top: ${this._menuY}px;"
        .open=${this._menuOpen}>
        <custom-menu @selected=${this.#onMenuSelected}>
          <custom-list-item
            type="menu"
            action="export-symbol">
            <custom-icon
              slot="start"
              icon="download"></custom-icon>
            export symbol
          </custom-list-item>
        </custom-menu>
      </custom-dropdown>
    `
  }
}
