import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js'
import { Image } from 'fabric';

declare global {
  interface HTMLElementTagNameMap {
    'catalog-item': CatalogItem;
  }
}

@customElement('catalog-item')
export class CatalogItem extends LitElement {
  set image(value) {
    this._image = value
    this.requestUpdate('image')
  }

  get image() {
    return this._image
  }

  private _image: string

  set headline(value) {
    this.title = value
    this._headline = value.length > 20 ? `${value.slice(0, 20)} ...` : value
    this.requestUpdate('headline')
  }

  get headline() {
    return this._headline
  }

  private _headline: string

  static styles = [
    css`
      :host {
        display: flex;
        width: 100%;
        align-items: center;
        box-sizing: border-box;
        padding: 4px 12px 4px 24px;
        font-size: 14px;
        font-weight: 500;
        height: 44px;
        cursor: pointer;
      }
    `
  ]

  async #click(event: Event) {
    event.stopImmediatePropagation()
    const image = await Image.fromURL(this.image)
    document.querySelector('app-shell').renderRoot.querySelector('draw-field').action = 'draw-symbol'
    document.querySelector('app-shell').renderRoot.querySelector('draw-field')._current = await image.clone()
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener('click', this.#click.bind(this))
  }

  render() {
    return html`
    <span>${this.headline}</span>
    <flex-one></flex-one>
    <slot name="end">
      <img src=${this.image}>
    </slot>
    `;
  }
}
