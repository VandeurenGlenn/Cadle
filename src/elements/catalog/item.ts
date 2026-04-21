import { LitElement, html, css, PropertyValues } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { unsafeSVG } from 'lit/directives/unsafe-svg.js'
import { loadSVGFromURL, util } from 'fabric'
import state from '../../state.js'

declare global {
  interface HTMLElementTagNameMap {
    'catalog-item': CatalogItem
  }
}

@customElement('catalog-item')
export class CatalogItem extends LitElement {
  @property({ attribute: false })
  symbol?: {
    name: string
    path: string
    metadata?: Record<string, unknown>
  }

  @property({ type: String })
  set image(value) {
    this._image = value
    this.requestUpdate('image')
  }

  get image() {
    return this._image
  }

  private _image: string
  private _svgPreview = ''

  set headline(value) {
    this.title = value
    this._headline = value.length > 28 ? `${value.slice(0, 28)} ...` : value
    this.requestUpdate('headline')
  }

  get headline() {
    return this._headline
  }

  private _headline: string

  static styles = [
    css`
      :host {
        user-select: none;
        display: flex;
        width: 100%;
        align-items: center;
        gap: 12px;
        box-sizing: border-box;
        padding: 4px 12px 4px 24px;
        font-size: 14px;
        font-weight: 500;
        height: 44px;
        cursor: pointer;
      }

      .headline {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .preview {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 24px;
        color: inherit;
        flex: 0 0 auto;
      }

      .preview :where(svg) {
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
      }
    `
  ]

  protected override willUpdate(changedProperties: PropertyValues<this>) {
    if (changedProperties.has('image') || changedProperties.has('symbol')) {
      this.#syncSvgPreview()
    }
  }

  async #syncSvgPreview() {
    const sourcePath = this.symbol?.path ?? this._image
    if (!sourcePath) {
      this._svgPreview = ''
      return
    }

    try {
      const markup = await this.#loadSvgMarkup(sourcePath)
      this._svgPreview = this.#themeSvgMarkup(markup)
      this.requestUpdate()
    } catch {
      this._svgPreview = ''
      this.requestUpdate()
    }
  }

  async #loadSvgMarkup(sourcePath: string) {
    if (sourcePath.startsWith('data:image/svg+xml')) {
      const [, payload = ''] = sourcePath.split(',', 2)
      if (sourcePath.includes(';base64,')) return atob(payload)
      return decodeURIComponent(payload)
    }

    const response = await fetch(sourcePath)
    return response.text()
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
    console.log(event)

    // const svg = await this.#loadSVGFromURL()
    // util.groupSVGElements(svg)
    // console.log({svg});
    // const group = new Group([svg])
    // document.querySelector('app-shell').renderRoot.querySelector('draw-field').action = 'draw-symbol'
    // document.querySelector('app-shell').renderRoot.querySelector('draw-field')._current = group

    const sourcePath = this.symbol?.path ?? this._image
    const svg = await loadSVGFromURL(sourcePath)
    const themedColor =
      getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-on-surface').trim() || '#e6e1e5'

    // console.log(svg)
    svg.objects.forEach((obj) => {
      this.#themePlacedSvgObject(obj, themedColor)
      if (sourcePath.endsWith('door.svg')) {
        obj.strokeWidth = 7
      } else {
        obj.strokeWidth = 1
      }
    })

    const group = util.groupSVGElements(svg.objects)
    this.#applySymbolMetadata(group, sourcePath)
    // console.log(group)
    // group.backgroundColor = '#fff'
    group.scale(1.2)
    cadleShell.field.action = 'draw-symbol'
    cadleShell.field._current = group
  }

  override onclick = (event) => {
    this.#click(event)
  }

  render() {
    return html`
      <span class="headline">${this.headline}</span>
      <flex-it></flex-it>
      <slot name="end">
        <span
          class="preview"
          aria-hidden="true"
          >${this._svgPreview ? unsafeSVG(this._svgPreview) : ''}</span
        >
      </slot>
    `
  }
}
