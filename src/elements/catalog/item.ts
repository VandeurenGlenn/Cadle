import { LiteElement, html, css, customElement, property, query } from '@vandeurenglenn/lite'
import styles from './styles/item.css' with { type: 'css' }
import { unsafeSVG } from 'lit/directives/unsafe-svg.js'
import { loadSVGFromString, loadSVGFromURL, util } from 'fabric'
import state from '../../state.js'
declare global {
  interface HTMLElementTagNameMap {
    'catalog-item': CatalogItem
  }
}
@customElement('catalog-item')
export class CatalogItem extends LiteElement {
  @property({ attribute: false })
  accessor symbol:
    | {
        name: string
        path: string
        metadata?: Record<string, unknown>
      }
    | undefined

  @property({ type: String })
  accessor image = ''

  private _svgPreview = ''
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
    ;(element.style as any).webkitBackdropFilter = 'blur(var(--cadle-glass-blur))'
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

  override disconnectedCallback(): void {
    this.#closeMagnifier()
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

  #isDarkSvgColor(value: unknown) {
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

  #themePlacedSvgObject(obj: any, themedColor: string) {
    const stroke = obj?.stroke
    const fill = obj?.fill
    if (this.#isDarkSvgColor(stroke)) obj.set('stroke', themedColor)
    if (this.#isDarkSvgColor(fill)) obj.set('fill', themedColor)
  }

  #normalizeBindingId(value: unknown) {
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

  #applySymbolMetadata(group: any, sourcePath: string) {
    const metadata = this.symbol?.metadata ?? {}
    const roleFromMeta = typeof metadata.bindingRole === 'string' ? metadata.bindingRole : undefined
    const inferredRole = this.#inferBindingRole(sourcePath, this.symbol?.name ?? this._headline ?? '')
    const bindingRole = roleFromMeta ?? inferredRole
    const seededBindingId = this.#normalizeBindingId(String(metadata.bindingId ?? state.text.current ?? ''))
    group.set({
      symbolName: this.symbol?.name ?? this._headline,
      symbolPath: sourcePath,
      bindingRole,
      oneLineEligible: bindingRole === 'switch' || bindingRole === 'load' || !!metadata.situationElementType,
      situationElementType:
        typeof metadata.situationElementType === 'string' ? metadata.situationElementType : undefined,
      sourceObjectUuid: typeof metadata.sourceObjectUuid === 'string' ? metadata.sourceObjectUuid : undefined
    })
    if (seededBindingId) {
      group.set({ bindingId: seededBindingId })
    }
  }

  #click = async (event: Event) => {
    // Ensure the draw page is active before placing a symbol
    if (typeof cadleShell !== 'undefined') {
      // If not already on the draw page, switch to it
      if (cadleShell.loadedPage && cadleShell.loadedPage !== 'draw') {
        cadleShell.loadedPage = 'draw'
      }
    }

    const sourcePath = this.symbol?.path ?? this.image
    if (!sourcePath) return
    const resolvedSourcePath = new URL(sourcePath, location.href).toString()
    const loadCandidates = [resolvedSourcePath, encodeURI(resolvedSourcePath), sourcePath]
    let svg: { objects: any[] } | null = null
    let lastError: unknown = null
    for (const candidate of loadCandidates) {
      try {
        const loaded = (await loadSVGFromURL(candidate)) as { objects: any[] }
        if (loaded?.objects?.length) {
          svg = loaded
          break
        }
      } catch (error) {
        lastError = error
      }
    }

    if (!svg) {
      try {
        const markup = await this.#loadSvgMarkup(sourcePath)
        const loaded = (await loadSVGFromString(markup)) as { objects: any[] }
        if (loaded?.objects?.length) svg = loaded
      } catch (error) {
        lastError = error
      }
    }

    if (!svg) {
      console.error('Failed to load catalog symbol SVG', { sourcePath, resolvedSourcePath, lastError })
      return
    }

    const themedColor =
      getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-on-surface').trim() || '#e6e1e5'
    svg.objects.forEach((obj) => {
      if (!obj) return
      obj.set({
        objectCaching: false,
        noScaleCache: true,
        strokeUniform: true
      })
      this.#themePlacedSvgObject(obj, themedColor)
      if (resolvedSourcePath.toLowerCase().endsWith('door.svg')) {
        obj.strokeWidth = 7
      } else {
        obj.strokeWidth = 1
      }
    })
    const validObjects = svg.objects.filter((obj) => obj !== null)
    if (validObjects.length === 0) return
    const group = util.groupSVGElements(validObjects)
    this.#applySymbolMetadata(group, sourcePath)
    group.set({
      centeredScaling: true,
      objectCaching: false,
      noScaleCache: true,
      strokeUniform: true
    })
    group.scale(1.2)
    group.setCoords()
    if (cadleShell.field) {
      cadleShell.field.action = 'draw-symbol'
      cadleShell.field._current = group
    }
  }

  firstRender(): void {
    this.addListener('click', this.#click)
  }

  render() {
    const previewSource = this.symbol?.path ?? this.image
    return html`
      <div
        class="row"
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
    `
  }
}
