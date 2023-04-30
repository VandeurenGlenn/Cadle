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

  loadFromJSON(json) {
    return this.#canvas.loadFromJSON(json, this.#canvas.renderAll.bind(this.#canvas));
  }

  toDataURL() {
    return this.#canvas.toDataURL()
  }

  async connectedCallback(): Promise<void> {
    super.connectedCallback()
    await this.updateComplete
    const { width, height } = this.getBoundingClientRect()
    this.#width = width
    this.#height = height
    this.renderRoot.querySelector('canvas').width = width 
    this.renderRoot.querySelector('canvas').height = height
    this.#canvas = new Canvas(this.renderRoot.querySelector('canvas'), { selection: false });
    
  
  // create grid
  
    
    
    

 
    
    // snap to grid
    
    this.#canvas.on('object:moving', (options) => { 
      options.target.set({
        left: Math.round(options.target.left / this.gridSize) * this.gridSize,
        top: Math.round(options.target.top / this.gridSize) * this.gridSize
      });
    });

    // this.#canvas
  }

  render() {
    return html`
    
    <canvas id="canvas" width="" height="600"></canvas>`;
  }
}
