import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js'
import { Group, Image, loadSVGFromURL, util, SVG } from 'fabric';

declare global {
  interface HTMLElementTagNameMap {
    'catalog-item': CatalogItem;
  }
}

@customElement('catalog-item')
export class CatalogItem extends LitElement {
  @property({type: String})
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

  #loadSVGFromURL() {
    return new Promise((resolve, reject) => {
      loadSVGFromURL(this._image, async svg => {
        resolve(svg)
      } )
    })
    
  }

  #click = async (event: Event) => {
    console.log(event);
    
    // const svg = await this.#loadSVGFromURL()
    // util.groupSVGElements(svg)
    // console.log({svg});
    // const group = new Group([svg])
    // document.querySelector('app-shell').renderRoot.querySelector('draw-field').action = 'draw-symbol'
    // document.querySelector('app-shell').renderRoot.querySelector('draw-field')._current = group
    
    const svg = await loadSVGFromURL(this._image)
    console.log(svg);
    
    const group = util.groupSVGElements(svg.objects)
    console.log(group);
    
    document.querySelector('app-shell').renderRoot.querySelector('draw-field').action = 'draw-symbol'
    document.querySelector('app-shell').renderRoot.querySelector('draw-field')._current = group
  }

  override onclick = (event) => {this.#click(event)}

  render() {
    return html`
    <span>${this.headline}</span>
    <flex-it></flex-it>
    <slot name="end">
      <img src=${this.image}>
    </slot>
    `;
  }
}
