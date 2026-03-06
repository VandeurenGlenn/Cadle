import { LitElement, html, css } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import { Canvas, Circle, Line, IText, Object, loadSVGFromURL, util, PencilBrush } from './../fabric-imports.js'
import { AppShell } from '../shell.js'
import Rect from './../symbols/rectangle.js'
import state from '../state.js'
import './../contextmenu.js'
import { set } from 'idb-keyval'
import { version } from 'os'
import CadleWindow from '../symbols/window.js'
import CadleWall from './../symbols/wall.js'
import CadleDoor from '../symbols/door.js'
// import 'fabric-history';

declare type x = number
declare type y = number
declare type left = number
declare type top = number

declare global {
  interface HTMLElementTagNameMap {
    'draw-field': DrawField
  }
}

@customElement('draw-field')
export class DrawField extends LitElement {
  #canvas: Canvas
  #height = 0
  #width = 0
  #startPoints: { left: number; top: number } = { left: 0, top: 0 }

  moving = false
  drawing = false
  isNaming = false
  namingType?: string
  namingNumber = 0
  namingLetter = ''
  alphabet: string[] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  namingLetterIndex = 0
  _selectionWasTrue = false
  _drawState?: string
  _currentGroup: any

  @property({ type: Number })
  gridSize: number

  @property({ type: Number })
  zoomLevel: number = 1

  @query('context-menu')
  contextMenu!: any

  _current: any = null

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
    cadleShell.action = value
  }

  get upperCanvas() {
    return this.shadowRoot?.querySelector('.upper-canvas') ?? null
  }

  static styles = [
    css`
      :host {
        display: flex;
      }
    `
  ]

  @query('.convas-container')
  canvasContainer!: any

  snap(value) {
    return Math.round(value / this.gridSize) * this.gridSize
  }

  updateMeasures(evt) {
    var obj = evt.target
    if (obj.type != 'group') {
      return
    }
    var width = obj.getWidth()
    var height = obj.getWidth()
    obj._objects[1].text = width.toFixed(2) + 'px'
    obj._objects[1].scaleX = 1 / obj.scaleX
    obj._objects[1].scaleY = 1 / obj.scaleY
    obj._objects[2].text = height.toFixed(2) + 'px'
    obj._objects[2].scaleX = 1 / obj.scaleY
    obj._objects[2].scaleY = 1 / obj.scaleX
  }

  async connectedCallback(): Promise<void> {
    super.connectedCallback()
    await this.updateComplete

    // Start with default A4 landscape dimensions
    const defaultWidth = 1123
    const defaultHeight = 794

    this.#width = defaultWidth
    this.#height = defaultHeight

    // @ts-ignore
    this.#canvas = new Canvas(this.renderRoot.querySelector('canvas'), {
      selection: true,
      evented: true,
      width: defaultWidth,
      height: defaultHeight,
      preserveObjectStacking: true
    })
    ;(this.#canvas as any).history = []

    this.gridSize = state.gridSize

    // Set initial zoom to 1 (100%)
    this.zoomLevel = 1
    this.#canvas.setZoom(1)

    // Resize canvas to fit container after layout is complete
    // Use setTimeout to ensure layout is fully settled
    setTimeout(() => {
      this.resizeCanvas()
    }, 100)

    this.#canvas.on('object:moving', (options) => {
      this.moving = true
      console.log(options)

      options.target.set(this.snapToGrid(options.target))
    })

    this.#canvas.on('after:render', (options) => {
      this.moving = false
    })

    this.#canvas.on('object:scaling', (options) => {
      console.log('scaling')

      var target = options.target
      var pointer = options.pointer

      const { left, top } = this.snapToGrid({ left: pointer.x, top: pointer.y })
      var px = left
      var py = top

      var rx = (px - target.left) / target.width
      var by = (py - target.top) / target.height
      var lx = (target.left - px + target.width * target.scaleX) / target.width
      var ty = (target.top - py + target.height * target.scaleY) / target.height

      var a = {}

      console.log(target.__corner)

      // Cannot get snap to work on some corners :-(
      switch (target.__corner) {
        case 'tl':
          // Not working
          //a = { scaleX: lx, scaleY: ty, left: px, top: py };
          break
        case 'mt':
          a = { scaleY: ty, top: py }
          break
        case 'tr':
          // Not working
          //a = { scaleX: rx, scaleY: ty, top: py  };
          break
        case 'ml':
          a = { scaleX: lx, left: px }
          break
        case 'mr':
          a = { scaleX: rx }
          break
        case 'bl':
          // Not working
          //a = { scaleX: lx, scaleY: by, left: px };
          break
        case 'mb':
          a = { scaleY: by }
          break
        case 'br':
          a = { scaleX: rx, scaleY: by }
          break
      }

      options.target.set(a)
    })

    this.#canvas.on('mouse:down', this._mousedown.bind(this))
    this.#canvas.on('mouse:up', this._mouseup.bind(this))
    this.addEventListener('mouseenter', this._mouseenter.bind(this))
    this.addEventListener('mouseleave', this._mouseleave.bind(this))
    this.#canvas.on('mouse:dblclick', this._dblclick.bind(this))
    // this.renderRoot.addEventListener('mousemove', this._mousemove.bind(this))
    this.#canvas.on('mouse:move', this._mousemove.bind(this))
    this.renderRoot.addEventListener('drop', this._drop.bind(this))

    this.addEventListener('contextmenu', this.#contextmenu)

    // Use ResizeObserver to handle container size changes
    const resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas()
    })
    resizeObserver.observe(this)

    // this.#canvas
  }

  #contextmenu = (event) => {
    const object = this.canvas.getActiveObject()
    if (object) {
      event.preventDefault()
      const rect = this.shadowRoot?.querySelector('canvas')?.getBoundingClientRect()
      if (!rect) return
      const { top, left } = rect
      // const { width } = this.contextMenu.getBoundingClientRect()
      this.contextMenu.style.top = `${object.top + top}px`
      this.contextMenu.style.left = `${object.left + left}px`
      this.contextMenu.open = true
    }
  }

  _dblclick() {
    console.log('dbl')
  }

  _drop(e) {
    console.log(e)
  }

  snapToGrid({ left, top }: { left?: number; top?: number }): { left: number; top: number } {
    let snappedLeft = left ?? 0
    let snappedTop = top ?? 0

    if (!this.freeDraw) {
      snappedLeft = Math.round(snappedLeft / this.gridSize) * this.gridSize
      snappedTop = Math.round(snappedTop / this.gridSize) * this.gridSize
    }

    return { left: snappedLeft, top: snappedTop }
  }

  _mousedown(e) {
    if (e.target) return
    if (!this._current && !this.drawing && !this.moving) {
      if (this.isNaming) {
        if (this.namingType === 'socket') {
          if (this.namingNumber === 8) {
            this.namingNumber = 0
            this.namingLetter = this.alphabet[(this.namingLetterIndex += 1)]
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
          this.drawing = true
          // Get canvas container's position to account for centering offset
          const canvasContainer = this.#canvas.getElement()?.parentElement
          const containerRect = canvasContainer?.getBoundingClientRect()
          const canvasRect = this.#canvas.getElement()?.getBoundingClientRect()

          // Calculate offset between event and canvas
          const offsetX = canvasRect?.left ?? 0
          const offsetY = canvasRect?.top ?? 0

          // Adjust event coordinates to canvas-relative
          const adjustedEvent = {
            clientX: e.clientX - offsetX,
            clientY: e.clientY - offsetY,
            pageX: e.pageX - offsetX,
            pageY: e.pageY - offsetY
          }

          const pointer = this.#canvas.getScenePoint(adjustedEvent)
          this.#startPoints = this.snapToGrid({ left: pointer.x, top: pointer.y })
          const id = Math.random().toString(36).slice(-12)
          const index = this.canvas._objects.length

          const sharedDrawOptions = {
            id,
            index,
            fill: state.styling.fill,
            stroke: state.styling.stroke
          }

          if (this.action === 'draw') {
            // this._current = new PencilBrush(this.#canvas);
            // this._current.color = '#555'
            // this._current.width = 1;
            this.#canvas.isDrawingMode = true
            // @ts-ignore
            this.#canvas.freeDrawingBrush = new PencilBrush(this.#canvas)
            this.#canvas.freeDrawingBrush.color = state.styling.stroke || '#555'
            this.#canvas.freeDrawingBrush.width = 2
          } else if (this.action === 'draw-line') {
            this._current = new Line(
              [this.#startPoints.left, this.#startPoints.top, this.#startPoints.left, this.#startPoints.top],
              {
                ...sharedDrawOptions,
                strokeWidth: 1,
                x2: this.#startPoints.top,
                y2: this.#startPoints.left,
                originX: 'center',
                originY: 'center',
                borderScaleFactor: 0,
                centeredRotation: true
              }
            )
          } else if (this.action === 'draw-circle') {
            this._current = new Circle({
              ...sharedDrawOptions,
              top: this.#startPoints.top,
              left: this.#startPoints.left,
              originX: 'left',
              originY: 'top',
              radius: pointer.x - this.#startPoints.left,
              strokeWidth: 1,
              centeredRotation: true
            })
          } else if (this.action === 'draw-arc') {
            this._current = new Circle({
              ...sharedDrawOptions,
              top: this.#startPoints.top,
              left: this.#startPoints.left,
              originX: 'left',
              originY: 'top',
              radius: pointer.y ? pointer.y - this.#startPoints.top : 0,
              startAngle: 0,
              endAngle: pointer.x - this.#startPoints.left,
              strokeWidth: 1,
              centeredRotation: true
            })
          } else if (this.action === 'draw-square') {
            this._current = new Rect({
              ...sharedDrawOptions,
              left: this.#startPoints.left,
              top: this.#startPoints.top,
              width: pointer.x - this.#startPoints.left,
              height: pointer.y - this.#startPoints.top
            })
          } else if (this.action === 'draw-wall') {
            this._current = new CadleWall({
              ...sharedDrawOptions,
              left: this.#startPoints.left,
              top: this.#startPoints.top,
              width: pointer.x - this.#startPoints.left,
              height: pointer.y - this.#startPoints.top,
              strokeWidth: 0,
              fill: cadleShell._currentColor
            })
          } else if (this.action === 'draw-window') {
            this._current = new CadleWindow({
              ...sharedDrawOptions,
              left: this.#startPoints.left,
              top: this.#startPoints.top,
              width: pointer.x - this.#startPoints.left,
              height: pointer.y - this.#startPoints.top,
              strokeWidth: 1,
              strokeDashArray: [5, 5]
            })
          } else if (this.action === 'draw-door') {
            this._current = new CadleDoor({
              ...sharedDrawOptions,
              left: this.#startPoints.left,
              top: this.#startPoints.top,
              width: pointer.x - this.#startPoints.left,
              height: pointer.y - this.#startPoints.top,
              strokeWidth: 1,
              strokeDashArray: [5, 5]
            })
          }
          if (this.action !== 'draw') this.canvas.add(this._current)
          break
      }
    }
  }

  updateObjects(currentPoints) {
    this.canvas.selection = false
    // const pointer = this.canvas.getPointer(e)
    if (this.action === 'draw') {
      return
      // this._current.onMouseMove({x:currentPoints.left, y:currentPoints.top}, e)
    } else if (this.action === 'draw-line') {
      this._current.set({ x2: currentPoints.left, y2: currentPoints.top })
    } else if (this.action === 'draw-circle') {
      this._current.set({ radius: Math.abs(this.#startPoints.left - currentPoints.left) })
      // this._current.set({ radius: Math.abs(this.#startPoints.top - pointer.y) });
    } else if (this.action === 'draw-square') {
      if (this.#startPoints.left > currentPoints.left) {
        this._current.set({ left: Math.abs(currentPoints.left) })
      }
      if (this.#startPoints.top > currentPoints.top) {
        this._current.set({ top: Math.abs(currentPoints.top) })
      }

      this._current.set({ width: Math.abs(this.#startPoints.left - currentPoints.left) })
      this._current.set({ height: Math.abs(this.#startPoints.top - currentPoints.top) })
    } else if (this.action === 'draw-window') {
      if (this.#startPoints.left > currentPoints.left) {
        this._current.set({ left: Math.abs(currentPoints.left) })
      }
      if (this.#startPoints.top > currentPoints.top) {
        this._current.set({ top: Math.abs(currentPoints.top) })
      }

      this._current.set({ width: Math.abs(this.#startPoints.left - currentPoints.left) })
      this._current.set({ height: Math.abs(this.#startPoints.top - currentPoints.top) })
    } else if (this.action === 'draw-door') {
      if (this.#startPoints.left > currentPoints.left) {
        this._current.set({ left: Math.abs(currentPoints.left) })
      }
      if (this.#startPoints.top > currentPoints.top) {
        this._current.set({ top: Math.abs(currentPoints.top) })
      }

      this._current.set({ width: Math.abs(this.#startPoints.left - currentPoints.left) })
      this._current.set({ height: Math.abs(this.#startPoints.top - currentPoints.top) })

      const dx = currentPoints.left - this.#startPoints.left
      const dy = currentPoints.top - this.#startPoints.top

      const isHorizontal = Math.abs(dx) >= Math.abs(dy)

      if (isHorizontal) {
        this._current.set({
          doorHingeSide: dx >= 0 ? 'right' : 'left',
          doorSwingDirection: dy >= 0 ? 'down' : 'up'
        })
      } else {
        this._current.set({
          doorHingeSide: dy >= 0 ? 'bottom' : 'top',
          doorSwingDirection: dx >= 0 ? 'right' : 'left'
        })
      }
    } else if (this.action === 'draw-arc') {
      console.log(currentPoints.left)
      console.log(this.#startPoints.left)

      this._current.set({
        radius: Math.abs(this.#startPoints.top - currentPoints.top),

        endAngle: Math.abs((this.#startPoints.left - currentPoints.left) / (Math.PI / 5))
      })
      // this._current.set({ radius: Math.abs(this.#startPoints.top - currentPoints.top) });
    } else if (this.action === 'draw-wall') {
      if (this.#startPoints.left > currentPoints.left) {
        this._current.set({ left: Math.abs(currentPoints.left) })
      }
      if (this.#startPoints.top > currentPoints.top) {
        this._current.set({ top: Math.abs(currentPoints.top) })
      }

      this._current.set({
        width: Math.abs(this.#startPoints.left - currentPoints.left),
        height: Math.abs(this.#startPoints.top - currentPoints.top)
      })
    } else if (this.action === 'draw-symbol') {
      this._current.set({ left: Math.abs(currentPoints.left) })
      this._current.set({ top: Math.abs(currentPoints.top) })
    } else if (this.action === 'draw-text') {
      this._current.set({ left: Math.abs(currentPoints.left) })
      this._current.set({ top: Math.abs(currentPoints.top) })
    }
  }

  _mousemove(e) {
    // Get canvas position to account for centering offset
    const canvasRect = this.#canvas.getElement()?.getBoundingClientRect()
    const offsetX = canvasRect?.left ?? 0
    const offsetY = canvasRect?.top ?? 0
    const adjustedEvent = {
      clientX: e.clientX - offsetX,
      clientY: e.clientY - offsetY,
      pageX: e.pageX - offsetX,
      pageY: e.pageY - offsetY
    }

    let pointer = this.#canvas.getScenePoint(adjustedEvent)
    state.mouse.position = { x: pointer.x, y: pointer.y }
    if (this.action === 'draw') {
      this.#canvas.isDrawingMode = true
      const brush = this.#canvas.freeDrawingBrush
      if (!brush) return
      brush.color = state.styling.stroke || '#555'
      brush.width = 2
      brush.onMouseMove({ x: pointer.x, y: pointer.y } as any, e as any)
      this.#canvas.renderAll()
      return
    }
    if (e.target && !this.drawing) return
    if (!this.drawing) return
    if (!this._current) return

    const currentPoints = this.snapToGrid({ left: pointer.x, top: pointer.y })
    this.updateObjects(currentPoints)
    this.canvas.renderAll()
  }

  _mouseenter(e) {
    const pointer = this.#canvas.getScenePoint(e)
    state.mouse.position = { x: pointer.x, y: pointer.y }
    if (this.action) this.#canvas.defaultCursor = 'crosshair'
    if (!this._current) return

    const currentPoints = this.snapToGrid({ left: pointer.x, top: pointer.y })
    if (this.action === 'draw-symbol' || this.action === 'draw-text') {
      this.drawing = true
      this._current.set({ left: Math.abs(currentPoints.left) })
      this._current.set({ top: Math.abs(currentPoints.top) })
      this.canvas.add(this._current)
    }
    this.canvas.renderAll()
  }

  _mouseleave(e) {
    console.log('leave')
    const pointer = this.#canvas.getScenePoint(e)
    state.mouse.position = { x: pointer.x, y: pointer.y }
    this.drawing = false
    if (!this._current) return
    if (this._current) this.canvas.remove(this._current)
    if (this.action === 'draw-symbol') {
    } else if (this.action === 'draw-text') {
      this.canvas.remove(this._current)
    } else {
      const currentPoints = this.snapToGrid({ left: pointer.x, top: pointer.y })
      this.updateObjects(currentPoints)
      this._current = undefined
    }

    this.canvas.renderAll()
  }

  _mouseup(e) {
    if (e.target && !this.drawing) return
    console.log(this.action)

    if (this.drawing && !this.moving) {
      // this.action = undefined
      this.drawing = false
      if (this.action !== 'draw') {
        this.canvas.remove(this._current)
        this.canvas.add(this._current)
      }
      this.canvas.selection = true
      this._current = undefined
      this.#canvas.isDrawingMode = false
      if (this.action === 'draw') {
        this.canvas.selection = true
        this.canvas.isDrawingMode = false
        this.action = undefined
      }
      if (this._selectionWasTrue) this.canvas.selection = true
      // this.canvas.renderAll()
    } else if (this.canvas.getActiveObjects().length > 1) {
      this._drawState = 'group'
      this._currentGroup = this.canvas.getActiveObjects()[0].group
      this.canvas.renderAll()
    }
  }

  toJSON() {
    const json = this.#canvas.toJSON()
    return json
  }

  async fromJSON(json: { objects?: any[]; version: string }) {
    console.log({ json })
    if (!json.objects) return
    const objects: any[] = []

    const specials: any[] = []

    for (const obj of json.objects) {
      if (
        obj.type === 'wall' ||
        obj.type === 'CadleWall' ||
        obj.type === 'CadleWidth' ||
        obj.type === 'CadleDepth' ||
        obj.type === 'CadleWindow' ||
        obj.type === 'CadleDoor'
      ) {
        specials.push(obj)
      } else if (obj.type) {
        if (!String(obj.radius).startsWith('-')) {
          objects.push(obj)
        }
      }
      if (!obj.type) {
        obj.type = 'CadleWall'
        specials.push(obj)
      }
      if (!obj) console.log(obj)
    }

    await this.#canvas.loadFromJSON({ objects, version: json.version })
    console.log({ specials })

    for (const obj of specials) {
      if (obj.type === 'CadleWall') {
        // delete obj.type
        const wall = new CadleWall(obj)
        this.#canvas.add(wall as any)
      } else if (obj.type === 'CadleDoor') {
        // delete obj.type
        const door = new CadleDoor(obj)
        this.#canvas.add(door as any)
      } else if (obj.type === 'CadleWindow') {
        // delete obj.type
        const width = new CadleWindow(obj)
        this.#canvas.add(width as any)
      }
    }

    this.#canvas.renderAll()
  }

  toDataURL() {
    return this.#canvas.toDataURL({ multiplier: 3, quality: 100, enableRetinaScaling: true })
  }

  resizeCanvas() {
    const container = this.parentElement?.getBoundingClientRect() ?? this.getBoundingClientRect()

    // Skip if container doesn't have valid dimensions yet
    if (!container.width || !container.height || container.width < 200 || container.height < 200) {
      return
    }

    // A4 landscape aspect ratio
    const aspectRatio = 1123 / 794

    // Calculate new canvas size from available viewport space
    const availableWidth = Math.max(200, container.width - 24)
    const availableHeight = Math.max(200, container.height - 24)

    let canvasWidth = availableWidth
    let canvasHeight = availableHeight

    if (canvasWidth / canvasHeight > aspectRatio) {
      canvasWidth = canvasHeight * aspectRatio
    } else {
      canvasHeight = canvasWidth / aspectRatio
    }

    canvasWidth = Math.floor(canvasWidth)
    canvasHeight = Math.floor(canvasHeight)

    // Only update if dimensions changed significantly (avoid tiny adjustments)
    if (Math.abs(this.#width - canvasWidth) > 10 || Math.abs(this.#height - canvasHeight) > 10) {
      this.#width = canvasWidth
      this.#height = canvasHeight
      this.#canvas.setDimensions({ width: canvasWidth, height: canvasHeight })
      this.#canvas.renderAll()
    }
  }

  fitToContainer() {
    // Reset zoom to 100% since canvas is already sized to fit
    this.setZoom(1)
  }

  setZoom(zoom: number) {
    // Clamp zoom between 0.1 and 3
    const newZoom = Math.max(0.1, Math.min(3, zoom))
    if (this.zoomLevel !== newZoom) {
      this.zoomLevel = newZoom
      this.#canvas.setZoom(this.zoomLevel)
      this.#canvas.renderAll()
      this.requestUpdate() // Trigger re-render to update zoom display
    }
  }

  zoomIn() {
    this.setZoom(this.zoomLevel * 1.2)
  }

  zoomOut() {
    this.setZoom(this.zoomLevel / 1.2)
  }

  resetZoom() {
    this.fitToContainer()
  }

  updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties)
    if (changedProperties.has('zoomLevel')) {
      // Zoom level updated, display is already re-rendered
    }
  }

  render() {
    return html` <style>
        :host {
          display: flex;
          position: relative;
          flex: 1 1 auto;
          min-width: 0;
          min-height: 0;
          box-sizing: border-box;
          width: 100%;
          height: 100%;
          align-items: center;
          justify-content: center;
          background-color: #f0f0f0;
          overflow: hidden;
        }

        .canvas-stage {
          position: relative;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .canvas-stage .canvas-container {
          margin: auto;
        }

        .shadow {
          position: absolute;
          width: 100%;
          height: 100%;
          box-shadow: inset 0 0 9px 2px #0000001f;
          z-index: 2;
          pointer-events: none;
        }
        canvas {
          background-image: url('./assets/grid-${this.gridSize}.png');
        }

        .zoom-controls {
          position: absolute;
          bottom: 16px;
          right: 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: var(--md-sys-color-surface);
          border-radius: 8px;
          padding: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          z-index: 3;
        }

        .zoom-level {
          font-size: 12px;
          color: var(--md-sys-color-on-surface);
          text-align: center;
          padding: 4px;
        }
      </style>
      <context-menu>
        <custom-list-item
          type="menu"
          action="add-to-catalog">
          <custom-icon
            slot="start"
            icon="add"></custom-icon>
          add
        </custom-list-item>
      </context-menu>
      <div class="canvas-stage">
        <div class="shadow"></div>
        <canvas></canvas>
      </div>

      <div class="zoom-controls">
        <div class="zoom-level">${Math.round(this.zoomLevel * 100)}%</div>
      </div>`
  }
}
