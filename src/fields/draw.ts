import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js'
import { Canvas, Circle, Line, IText, Object, loadSVGFromURL, util } from './../fabric-imports.js'
import { AppShell } from '../shell.js';
import Rect from './../symbols/rectangle.js'
// import 'fabric-history';

declare type x = number
declare type y = number
declare type left = number
declare type top = number

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
  #startPoints: {left: number, top: number}

  @property({type: Number})
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

  snap(value) {
    return Math.round(value / this.gridSize) * this.gridSize
  }

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
  
    // const drawVertical = (i: number) => this.#canvas.add(new Line([ i * this.gridSize, 0, i * this.gridSize, this.#height], { stroke: '#ccc', selection: false, selectable: false, evented: false , excludeFromExport: true }))

    // const drawHorizontal = (i: number) => this.#canvas.add(new Line([ 0, i * this.gridSize, this.#width, i * this.gridSize], { stroke: '#ccc', selection: false, selectable: false, evented: false , excludeFromExport: true }))
    
    // for (var i = 0; i < (this.#biggest / this.gridSize); i++) {
    //   if (i <= this.#width) drawHorizontal(i)
    //   if (i <= this.#height) drawVertical(i)
    // }

    
    // snap to grid
    
    this.#canvas.on('object:moving', (options) => {
      console.log(options);
      
      options.target.set(this.snapToGrid(options.target))
    });

    this.#canvas.on('object:scaling', (options) => {
      var target = options.target;
      var pointer = options.pointer;
    
      var px = this.snap(pointer.x);
      var py = this.snap(pointer.y);

      var rx = (px - target.left) / target.width;
      var by = (py - target.top) / target.height;
      var lx = (target.left - px + (target.width * target.scaleX)) / (target.width);
      var ty = (target.top - py + (target.height * target.scaleY)) / (target.height);
    
      var a = {};
    
      // Cannot get snap to work on some corners :-(
      switch (target.__corner)
      {
        case "tl":
          // Not working
          //a = { scaleX: lx, scaleY: ty, left: px, top: py };
          break;
        case "mt":
          a = { scaleY: ty, top: py };
          break;
        case "tr":
          // Not working
          //a = { scaleX: rx, scaleY: ty, top: py  };
          break;
        case "ml":
          a = { scaleX: lx, left: px };
          break;
        case "mr":
          a = { scaleX: rx };
          break;
        case "bl":
          // Not working
          //a = { scaleX: lx, scaleY: by, left: px };
          break;
        case "mb":
          a = { scaleY: by };
          break;
        case "br":
          a = { scaleX: rx, scaleY: by };
          break;
      }
    
      options.target.set(a);
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

    switch (this.action) {
      case 'save':
      case 'disable-grid':
      case 'group':
      case 'remove':
      case 'select':
      case 'move':
      case 'draw-symbol':
      case 'draw-text':
      case null:
      case undefined:
        return
      default:
        this.drawing = true;
        const pointer = this.#canvas.getPointer(e);
        this.#startPoints = this.snapToGrid({left: pointer.x, top: pointer.y})
        const id = Math.random().toString(36).slice(-12)
        const index = this.canvas._objects.length

        const sharedDrawOptions = {
          id,
          index
        }
        if (this.action === 'draw-wall') {
          this._current = new Line([this.#startPoints.left, this.#startPoints.top, this.#startPoints.left, this.#startPoints.top], {
            id,
            index,
            strokeWidth: 10,
            x2: this.#startPoints.top,
            y2: this.#startPoints.left,
            fill: '#555',
            stroke: '#555',
            originX: 'center',
            originY: 'center',
            borderScaleFactor: 0,
            centeredRotation: true
          });
        } else if (this.action === 'draw-line') {
          this._current = new Line([this.#startPoints.left, this.#startPoints.top, this.#startPoints.left, this.#startPoints.top], {
            id,
            index,
            strokeWidth: 1,
            x2: this.#startPoints.top,
            y2: this.#startPoints.left,
            fill: '#555',
            stroke: '#555',
            originX: 'center',
            originY: 'center',
            borderScaleFactor: 0,
            centeredRotation: true
          });
        } else if (this.action === 'draw-circle') {
          this._current = new Circle({
            id,
            index,
            top: this.#startPoints.top,
            left: this.#startPoints.left,
            originX: 'left',
            originY: 'top',
            radius: pointer.x-this.#startPoints.left,
            strokeWidth: 1,
            fill: '#00000000',
            stroke: '#555',
            borderScaleFactor: 0,
            centeredRotation: true
          });
        } else if (this.action === 'draw-arc') {
          this._current = new Circle({
            id,
            index,
            top: this.#startPoints.top,
            left: this.#startPoints.left,
            originX: 'left',
            originY: 'top',
            radius: pointer.y - this.#startPoints.top,
            startAngle: 0,
            endAngle: pointer.x - this.#startPoints.left,
            strokeWidth: 1,
            borderScaleFactor: 0,
            fill: '#00000000',
            stroke: '#555',
            centeredRotation: true
          });
        } else if (this.action === 'draw-square') {
          this._current = new Rect({
            id,
            index,
            left: this.#startPoints.left,
            top: this.#startPoints.top,
            width: pointer.x-this.#startPoints.left,
            height: pointer.y-this.#startPoints.top
          });
        } else if (this.action === 'draw-wall') {
          this._current = new Rect({
            id,
            index,
            left: this.#startPoints.left,
            top: this.#startPoints.top,
            width: pointer.x-this.#startPoints.left,
            height: pointer.y-this.#startPoints.top
          });
        }
        this.canvas.add(this._current);
        break;
    }
  }
  
  _mousemove(e) {
    let pointer = this.#canvas.getPointer(e)
    const currentPoints = this.snapToGrid({left: pointer.x, top: pointer.y})

    
    if (!this.drawing) return
    this.canvas.selection = false
    // const pointer = this.canvas.getPointer(e)
    if (this.action === 'draw-line' || this.action === 'draw-wall') {
      
      this._current.set({ x2: currentPoints.left, y2: currentPoints.top })
    } else if (this.action === 'draw-circle') {
      this._current.set({ radius: Math.abs(this.#startPoints.left - currentPoints.left) });
      // this._current.set({ radius: Math.abs(this.#startPoints.top - pointer.y) });    
    } else if (this.action === 'draw-square') {
      if (this.#startPoints.left > currentPoints.left){
        this._current.set({ left: Math.abs(currentPoints.left) });
      }
      if (this.#startPoints.top > currentPoints.top){
        this._current.set({ top: Math.abs(currentPoints.top) });
      }
      
      this._current.set({ width: Math.abs(this.#startPoints.left - currentPoints.left) });
      this._current.set({ height: Math.abs(this.#startPoints.top - currentPoints.top) });
    } else if (this.action === 'draw-arc') {
      console.log(currentPoints.left);
      console.log(this.#startPoints.left);
      
      this._current.set({ 
        radius: Math.abs(this.#startPoints.top - currentPoints.top),
        
        endAngle: Math.abs((this.#startPoints.left - currentPoints.left) / (Math.PI / 5))
      });
      // this._current.set({ radius: Math.abs(this.#startPoints.top - currentPoints.top) });
    } else if (this.action === 'draw-symbol') {
      this._current.set({ left: Math.abs(currentPoints.left) });
      this._current.set({ top: Math.abs(currentPoints.top) });
    }  else if (this.action === 'draw-text') {
      this._current.set({ left: Math.abs(currentPoints.left) });
      this._current.set({ top: Math.abs(currentPoints.top) });
    }
    console.log('render');
    
    this.canvas.renderAll()
  }

  _mouseenter(e) {
    if (!this._current) return
    console.log('enter');
    const pointer = this.#canvas.getPointer(e)
    const currentPoints = this.snapToGrid({left: pointer.x, top: pointer.y})
    if (this.action === 'draw-symbol') {
      this.drawing = true
      this._current.set({ left: Math.abs(currentPoints.left) });
      this._current.set({ top: Math.abs(currentPoints.top) });
      this.canvas.add(this._current)
    } else if (this.action === 'draw-text') {
      this.drawing = true
      this._current.set({ left: Math.abs(currentPoints.left) });
      this._current.set({ top: Math.abs(currentPoints.top) });
      this.canvas.add(this._current)
    }
    this.canvas.renderAll()
  }

  _mouseleave(e) {
    console.log('leave');
    this.drawing = false
    if (this.action === 'draw-symbol') {
      this.canvas.remove(this._current)
    } else if (this.action === 'draw-text') {
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
      this._current = undefined
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
  
  toDataURL() {
    return this.#canvas.toDataURL({multiplier: 3, quality: 100, enableRetinaScaling: true})
  }

  render() {
    return html`
    <style>

      :host {
        background-image: url('./assets/grid-${this.gridSize}.png');
      }
    </style>
    
    <canvas id="canvas" width="" height="600"></canvas>`;
  }
}
