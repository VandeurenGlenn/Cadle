import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js'
import { Canvas } from 'fabric'

@customElement('save-field')
export class SaveField extends LitElement {
  #canvas: Canvas
  #height: number
  #width: number
  gridSize: number

  get #biggest() {
    return this.#width > this.#height ? this.#width : this.#height
  }

  static styles = [
    css`
      :host {
        display: flex;
      }
    `
  ];

  async loadFromJSON(json) {
    await this.#canvas.loadFromJSON(json);
    await this.#canvas.renderAll()
  }

  toDataURL() {
    return this.#canvas.toDataURL({multiplier: 3, quality: 100, enableRetinaScaling: true})
  }

  async connectedCallback(): Promise<void> {
    super.connectedCallback()
    await this.updateComplete
    const { width, height } = this.getBoundingClientRect()
    this.#width = width
    this.#height = height
    this.renderRoot.querySelector('canvas').width = width + document.querySelector('app-shell').drawer.getBoundingClientRect().width
    this.renderRoot.querySelector('canvas').height = height
    this.#canvas = new Canvas(this.renderRoot.querySelector('canvas'), { selection: false });
    
  }

  render() {
    return html`
    
    <canvas id="canvas" width="" height="600"></canvas>`;
  }
}
