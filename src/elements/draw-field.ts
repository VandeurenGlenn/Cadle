import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js'
import { Canvas, Circle, Line, Rect, Object, loadSVGFromURL, util } from 'fabric'
import { AppShell } from '../shell.js';

type x = number
type y = number
type left = number
type top = number

declare global {
  interface HTMLElementTagNameMap {
    'draw-field': DrawField;
  }
}

@customElement('draw-field')
export class DrawField extends LitElement {
  #canvas: Canvas
  #height: number
  #width: number
  #startPoints: [ x, y ]
  gridSize: number
  drawing: boolean

  _current: {}

  get #shell() {
    return document.querySelector('app-shell') as AppShell
  }

  get #biggest() {
    return this.#width > this.#height ? this.#width : this.#height
  }

  get canvas() {
    return this.#canvas
  }

  get action() {
    return this.#shell.action
  }

  get symbol() {
    return this.#shell.symbol
  }

  get freeDraw() {
    return this.#shell.freeDraw
  }

  set action(value) {
    document.querySelector('app-shell').action = value
  }

  static styles = [
    css`
      :host {
        display: flex;
      }
    `
  ];

  async connectedCallback(): Promise<void> {
    super.connectedCallback()
    await this.updateComplete
    const { width, height } = this.getBoundingClientRect()
    this.#width = width
    this.#height = height
    // this.renderRoot.querySelector('canvas').width = width 
    // this.renderRoot.querySelector('canvas').height = height
    this.#canvas = new Canvas(this.renderRoot.querySelector('canvas'), { selection :true, evented: false, width, height });
    this.gridSize = 10;
  
  // create grid
  
    const drawVertical = (i: number) => this.#canvas.add(new Line([ i * this.gridSize, 0, i * this.gridSize, this.#height], { stroke: '#ccc', selection: false, selectable: false, evented: false , excludeFromExport: true }))

    const drawHorizontal = (i: number) => this.#canvas.add(new Line([ 0, i * this.gridSize, this.#width, i * this.gridSize], { stroke: '#ccc', selection: false, selectable: false, evented: false , excludeFromExport: true }))
    
    for (var i = 0; i < (this.#biggest / this.gridSize); i++) {
      if (i <= this.#width) drawHorizontal(i)
      if (i <= this.#height) drawVertical(i)
    }

    
    // snap to grid
    
    this.#canvas.on('object:moving', (options) => {

      options.target.set(this.snapToGrid(options.target))
    });

    this.renderRoot.addEventListener('mousedown', this._mousedown.bind(this))
    this.renderRoot.addEventListener('mouseup', this._mouseup.bind(this))
    this.addEventListener('mouseenter', this._mouseenter.bind(this))
    this.addEventListener('mouseleave', this._mouseleave.bind(this))
    
    this.renderRoot.addEventListener('mousemove', this._mousemove.bind(this))
    this.renderRoot.addEventListener('drop', this._drop.bind(this))

    // this.#canvas
  }

  _drop(e) {
    console.log(e);
    
  }

  snapToGrid({left, top}: {left: number, top: number}): {left: number, top: number} {
    if (!this.freeDraw) {
      left = Math.round(left / this.gridSize) * this.gridSize
      top = Math.round(top / this.gridSize) * this.gridSize
    }

    return { left, top }
  }

  _mousedown(e) {
    if (this.isNaming) {
      if (this.namingType === 'socket') {
        if (this.namingNumber === 8) {
          this.namingNumber = 0
          this.namingLetter = this.alphabet[this.namingLetterIndex += 1]
        }
      }

      this.namingNumber += 1
      
    }
      
    if (this.action === 'save' || this.action === 'disable-grid' ||
        this.action === 'group' || this.action === 'remove'  ||
        this.action === 'select' || this.action === 'move') return;
    if (this.action) {
      
      
      this.drawing = true;
      const pointer = this.#canvas.getPointer(e);
      this.#startPoints = [ pointer.x, pointer.y ];
      const id = Math.random().toString(36).slice(-12)
      const index = this.canvas._objects.length
      console.log(this.#startPoints);
      
      if (this.action === 'draw-line') {
        this._current = new Line([...this.#startPoints, pointer.x, pointer.y], {
          id,
          index,
          strokeWidth: 1,
          x2: this.#startPoints[1],
          y2: this.#startPoints[0],
          fill: '#555',
          stroke: '#555',
          originX: 'center',
          originY: 'center',
          centeredRotation: true
        });
      } else if (this.action === 'draw-circle') {
        this._current = new Circle({
          id,
          index,
          top: this.#startPoints[1],
          left: this.#startPoints[0],
          originX: 'left',
          originY: 'top',
          radius: pointer.x-this.#startPoints[0],
          strokeWidth: 1,
          fill: '#00000000',
          stroke: '#555',
          centeredRotation: true
        });
      } else if (this.action === 'draw-arc') {
        this._current = new Circle({
          id,
          index,
          top: this.#startPoints[1],
          left: this.#startPoints[0],
          originX: 'left',
          originY: 'top',
          radius: pointer.y - this.#startPoints[1],
          startAngle: 0,
          endAngle: pointer.x - this.#startPoints[0],
          strokeWidth: 1,
          fill: '#00000000',
          stroke: '#555',
          centeredRotation: true
        });
      } else if (this.action === 'draw-square') {
        this._current = new Rect({
          id,
          index,
          left: this.#startPoints[0],
          top: this.#startPoints[1],
          originX: 'left',
          originY: 'top',
          width: pointer.x-this.#startPoints[0],
          height: pointer.y-this.#startPoints[1],
          angle: 0,
          strokeWidth: 1,
          fill: '#00000000',
          stroke: '#555',
          centeredRotation: true
        });
      } else if (this.action === 'draw-symbol') {
        // loadSVGFromURL(this.symbol, (objects, options) => {
        //   this._current = util.groupSVGElements(objects);
          
        // })

      }
      this.canvas.add(this._current);
    }
    
  }
  
  _mousemove(e) {
    const pointer = this.#canvas.getPointer(e)


    
    if (!this.drawing) return
    this.canvas.selection = false
    // const pointer = this.canvas.getPointer(e)
    if (this.action === 'draw-line') {
      console.log('line');
      
      this._current.set({ x2: pointer.x, y2: pointer.y })
    } else if (this.action === 'draw-circle') {
      this._current.set({ radius: Math.abs(this.#startPoints[0] - pointer.x) });
      // this._current.set({ radius: Math.abs(this.#startPoints[1] - pointer.y) });    
    } else if (this.action === 'draw-square') {
      if (this.#startPoints[0] > pointer.x){
        this._current.set({ left: Math.abs(pointer.x) });
      }
      if (this.#startPoints[1] > pointer.y){
        this._current.set({ top: Math.abs(pointer.y) });
      }
      
      this._current.set({ width: Math.abs(this.#startPoints[0] - pointer.x) });
      this._current.set({ height: Math.abs(this.#startPoints[1] - pointer.y) });
    } else if (this.action === 'draw-arc') {
      console.log(pointer.x);
      console.log(this.#startPoints[0]);
      
      this._current.set({ 
        radius: Math.abs(this.#startPoints[1] - pointer.y),
        
        endAngle: Math.abs((this.#startPoints[0] - pointer.x) / (Math.PI / 5))
      });
      // this._current.set({ radius: Math.abs(this.#startPoints[1] - pointer.y) });
    } else if (this.action === 'draw-symbol') {
      
        this._current.set({ left: Math.abs(pointer.x) });
        this._current.set({ top: Math.abs(pointer.y) });
    }
    console.log('render');
    
    this.canvas.renderAll()
  }

  _mouseenter(e) {
    console.log('enter');
    const pointer = this.canvas.getPointer(e)
    if (this.action === 'draw-symbol') {
      this.drawing = true
      this._current.set({ left: Math.abs(pointer.x) });
      this._current.set({ top: Math.abs(pointer.y) });
      this.canvas.add(this._current)
    }
    this.canvas.renderAll()
  }

  _mouseleave(e) {
    console.log('leave');
    this.drawing = false
    if (this.action === 'draw-symbol') {
      this.canvas.remove(this._current)
    }
    this.canvas.renderAll()
  }

  _mouseup() {
    if (this.drawing) {
      this.action = undefined
      this.drawing = false
      this.canvas.remove(this._current)
      this.canvas.add(this._current);
      this.canvas.selection = true
      if (this._selectionWasTrue) this.canvas.selection = true
      // this.canvas.renderAll()
    } else if (this.canvas.getActiveObjects().length > 1) {
      this._drawState = 'group'
      this._currentGroup = this.canvas.getActiveObjects()[0].group;
      this.canvas.renderAll()
    }
  }

  toJSON() {
    return this.#canvas.toJSON()
  }

  async fromJSON(json) {
    await this.#canvas.loadFromJSON(json)

    this.#canvas.renderAll()
  }

  render() {
    return html`
    
    <canvas id="canvas" width="" height="600"></canvas>`;
  }
}
