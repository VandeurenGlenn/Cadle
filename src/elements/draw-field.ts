import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js'
import { Canvas, Circle, Line, Rect, Object, loadSVGFromURL, util } from 'fabric'

@customElement('draw-field')
export class DrawField extends LitElement {
  #canvas: Canvas
  #height: number
  #width: number
  gridSize: number

  get #biggest() {
    return this.#width > this.#height ? this.#width : this.#height
  }

  get canvas() {
    return this.#canvas
  }

  get action() {
    return document.querySelector('app-shell').action
  }

  get symbol() {
    return document.querySelector('app-shell').symbol
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

    this.#canvas.add(new Rect({ 
      left: 100, 
      top: 100, 
      width: 50, 
      height: 50, 
      fill: '#faa', 
      originX: 'left', 
      originY: 'top',
      centeredRotation: true
    }));
    
    this.#canvas.add(new Circle({ 
      left: 300, 
      top: 300, 
      radius: 50, 
      fill: '#9f9', 
      originX: 'left', 
      originY: 'top',
      centeredRotation: true
    }));
    
    // snap to grid
    
    this.#canvas.on('object:moving', (options) => { 
      options.target.set({
        left: Math.round(options.target.left / this.gridSize) * this.gridSize,
        top: Math.round(options.target.top / this.gridSize) * this.gridSize
      });
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

  _mousedown(e) {
      
    if (this.action === 'save' || this.action === 'disable-grid' ||
        this.action === 'group' || this.action === 'remove'  ||
        this.action === 'select' || this.action === 'move') return;
    if (this.action) {
      
      
      this.drawing = true;
      const pointer = this.#canvas.getPointer(e);
      this._currentPoints = [ pointer.x, pointer.y, pointer.x, pointer.y ];
      const id = Math.random().toString(36).slice(-12)
      const index = this.canvas._objects.length
      if (this.action === 'draw-line') {
        this._current = new Line(this._currentPoints, {
          id,
          index,
          strokeWidth: 5,
          fill: '#555',
          stroke: '#555',
          originX: 'center',
          originY: 'center'
        });
      } else if (this.action === 'draw-circle') {
        this._current = new Circle({
          id,
          index,
          top: this._currentPoints[1],
          left: this._currentPoints[0],
          originX: 'left',
          originY: 'top',
          radius: pointer.x-this._currentPoints[0],
          strokeWidth: 5,
          fill: '#00000000',
          stroke: '#555'
        });
      } else if (this.action === 'draw-arc') {
        this._current = new Circle({
          id,
          index,
          top: this._currentPoints[1],
          left: this._currentPoints[0],
          originX: 'left',
          originY: 'top',
          radius: pointer.y-this._currentPoints[1],
          startAngle: 0,
          endAngle: pointer.x -this._currentPoints[0],
          strokeWidth: 5,
          fill: '#00000000',
          stroke: '#555'
        });
      } else if (this.action === 'draw-square') {
        this._current = new Rect({
          id,
          index,
          left: this._currentPoints[0],
          top: this._currentPoints[1],
          originX: 'left',
          originY: 'top',
          width: pointer.x-this._currentPoints[0],
          height: pointer.y-this._currentPoints[1],
          angle: 0,
          strokeWidth: 5,
          fill: '#00000000',
          stroke: '#555'
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
    
    this.mouseLocation = {
      left: pointer.x,
      top: pointer.y
    }
    
    if (!this.drawing) return
    // const pointer = this.canvas.getPointer(e)
    if (this.action === 'draw-line') {
      this._current.set({ x2: pointer.x, y2: pointer.y })
    } else if (this.action === 'draw-circle') {
      this._current.set({ radius: Math.abs(this._currentPoints[0] - pointer.x) });
      // this._current.set({ radius: Math.abs(this._currentPoints[1] - pointer.y) });    
    } else if (this.action === 'draw-square') {
      if (this._currentPoints[0] > pointer.x){
        this._current.set({ left: Math.abs(pointer.x) });
      }
      if (this._currentPoints[1] > pointer.y){
        this._current.set({ top: Math.abs(pointer.y) });
      }
      
      this._current.set({ width: Math.abs(this._currentPoints[0] - pointer.x) });
      this._current.set({ height: Math.abs(this._currentPoints[1] - pointer.y) });
    } else if (this.action === 'draw-arc') {
      this._current.set({ 
        radius: Math.abs(this._currentPoints[1] - pointer.y),
        endAngle: Math.abs((currentMouseLocation.x -this._currentPoints[0]) / 10 + (Math.PI / 5))
      });
      // this._current.set({ radius: Math.abs(this._currentPoints[1] - pointer.y) });
    } else if (this.action === 'draw-symbol') {
      
        this._current.set({ left: Math.abs(pointer.x) });
        this._current.set({ top: Math.abs(pointer.y) });
    }
    
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
      this.canvas.remove(this.canvas.getActiveObject())
    }
    this.canvas.renderAll()
  }

  _mouseup() {
    if (this.drawing) {
      this.action = undefined
      this.drawing = false
      this.canvas.remove(this._current)
      this.canvas.add(this._current);
      
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

  render() {
    return html`
    
    <canvas id="canvas" width="" height="600"></canvas>`;
  }
}
