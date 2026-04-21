import { LitElement, html, css } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import { Canvas, Circle, Line, IText, loadSVGFromURL, util, PencilBrush } from './../fabric-imports.js'
import { AppShell } from '../shell.js'
import Rect from './../symbols/rectangle.js'
import state from '../state.js'
import './../contextmenu.js'
import CadleWindow from '../symbols/window.js'
import CadleWall from './../symbols/wall.js'
import CadleDoor from '../symbols/door.js'
import CadleGate from '../symbols/gate.js'
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
  readonly #a4LandscapeWidth = 1123
  readonly #a4LandscapeHeight = 794
  readonly #a4LandscapeAspect = this.#a4LandscapeWidth / this.#a4LandscapeHeight
  #startPoints: { left: number; top: number } = { left: 0, top: 0 }
  #drawSnapWall: any = null
  #lastMoveSnap = new WeakMap<any, { left: number; top: number }>()
  #bindingLookup = new Map<string, any[]>()
  #bindingLookupVersion = 0
  #bindingLookupScheduled = false
  #measurementOverlayScheduled = false

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

  @property({ type: Boolean })
  showMeasurements: boolean = false

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
        background: transparent;
        overflow: hidden;
        width: 100%;
        height: 100%;
      }

      canvas {
        background: transparent !important;
        transition: none;
      }
    `
  ]

  @query('.convas-container')
  canvasContainer!: any

  snap(value) {
    return Math.round(value / this.gridSize) * this.gridSize
  }

  #extractPointer(input: any) {
    if (input?.scenePoint) {
      return {
        x: Number(input.scenePoint.x ?? 0),
        y: Number(input.scenePoint.y ?? 0)
      }
    }

    const rawEvent = input?.e ?? input
    if (!rawEvent) return { x: 0, y: 0 }

    try {
      const point = this.#canvas.getScenePoint(rawEvent)
      return { x: Number(point.x ?? 0), y: Number(point.y ?? 0) }
    } catch {
      if (input?.pointer) {
        return {
          x: Number(input.pointer.x ?? 0),
          y: Number(input.pointer.y ?? 0)
        }
      }

      return { x: 0, y: 0 }
    }
  }

  #normalizeBindingId(value: unknown) {
    if (typeof value !== 'string') return ''
    return value.trim().toUpperCase()
  }

  #inferBindingRole(obj: any): 'switch' | 'load' | 'neutral' {
    const explicitRole = String(obj?.bindingRole ?? '').toLowerCase()
    if (explicitRole === 'switch' || explicitRole === 'load') return explicitRole

    const haystack = `${obj?.symbolPath ?? ''} ${obj?.symbolName ?? ''}`.toLowerCase()
    if (haystack.includes('/switches/') || haystack.includes(' switch')) return 'switch'
    if (
      haystack.includes('/consumption appliances/') ||
      haystack.includes('/electrical devices/') ||
      haystack.includes('light') ||
      haystack.includes('lamp')
    ) {
      return 'load'
    }

    return 'neutral'
  }

  #displayTypeForObject(obj: any) {
    if (typeof obj?.situationElementType === 'string') return obj.situationElementType
    if (typeof obj?.type === 'string' && obj.type.startsWith('Cadle'))
      return obj.type.replace('Cadle', '').toLowerCase()
    return String(obj?.type ?? 'symbol')
  }

  #buildBoundSymbolPath(bindingId: string, role: string, type: string) {
    const roleLabel = role === 'neutral' ? '' : ` ${role.toUpperCase()}`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="44" viewBox="0 0 120 44"><rect x="1" y="1" width="118" height="42" rx="6" fill="#fff" stroke="#444" stroke-width="1.5"/><text x="10" y="19" font-family="Arial, sans-serif" font-size="11" fill="#222">${bindingId}${roleLabel}</text><text x="10" y="34" font-family="Arial, sans-serif" font-size="10" fill="#666">${type}</text></svg>`
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  }

  getBoundOneLineCatalogSymbols() {
    const symbols: {
      name: string
      path: string
      metadata: Record<string, unknown>
    }[] = []

    for (const [bindingId, objects] of this.#bindingLookup.entries()) {
      for (const obj of objects) {
        const role = this.#inferBindingRole(obj)
        const type = this.#displayTypeForObject(obj)
        const uniqueId = obj?.uuid ?? `${obj?.type ?? 'symbol'}-${obj?.index ?? Math.random().toString(36).slice(2)}`

        symbols.push({
          name: `${bindingId} - ${type}`,
          path: this.#buildBoundSymbolPath(bindingId, role, type),
          metadata: {
            bindingId,
            bindingRole: role,
            situationElementType: type,
            sourceObjectUuid: uniqueId,
            oneLineEligible: true,
            sourceType: 'situation-binding'
          }
        })
      }
    }

    return symbols
  }

  #refreshBindingLookup() {
    this.#bindingLookup.clear()

    for (const obj of this.#canvas.getObjects()) {
      const bindingId = this.#normalizeBindingId((obj as any)?.bindingId)
      if (!bindingId) continue

      const bucket = this.#bindingLookup.get(bindingId)
      if (bucket) bucket.push(obj)
      else this.#bindingLookup.set(bindingId, [obj])
    }

    this.#bindingLookupVersion += 1
    this.dispatchEvent(
      new CustomEvent('binding-lookup-updated', {
        bubbles: true,
        composed: true,
        detail: {
          version: this.#bindingLookupVersion,
          symbols: this.getBoundOneLineCatalogSymbols()
        }
      })
    )
  }

  #scheduleBindingLookupRefresh() {
    if (this.#bindingLookupScheduled) return
    this.#bindingLookupScheduled = true

    requestAnimationFrame(() => {
      this.#bindingLookupScheduled = false
      this.#refreshBindingLookup()
    })
  }

  #formatDimensionLabel(lengthInPixels: number) {
    const lengthInCentimeters = (Math.max(0, lengthInPixels) / 50) * 100
    if (lengthInCentimeters >= 100) {
      const meters = Math.round((lengthInCentimeters / 100) * 100) / 100
      return `${meters} m`
    }

    const rounded = Math.round(lengthInCentimeters)
    return `${rounded} cm`
  }

  #drawDimensionLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, rotate = false) {
    ctx.save()
    if (rotate) {
      ctx.translate(x, y)
      ctx.rotate(-Math.PI / 2)
      x = 0
      y = 0
    }

    ctx.font = '600 11px "IBM Plex Sans", "Segoe UI", sans-serif'
    const textWidth = ctx.measureText(text).width
    const paddingX = 6
    const paddingY = 4
    const boxWidth = textWidth + paddingX * 2
    const boxHeight = 18

    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.fillRect(x - boxWidth / 2, y - boxHeight + paddingY, boxWidth, boxHeight)
    ctx.strokeStyle = 'rgba(52, 40, 30, 0.35)'
    ctx.lineWidth = 1
    ctx.strokeRect(x - boxWidth / 2, y - boxHeight + paddingY, boxWidth, boxHeight)

    ctx.fillStyle = '#3d2f25'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(text, x, y)
    ctx.restore()
  }

  #drawArrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size = 7) {
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(angle + Math.PI / 6) * size, y + Math.sin(angle + Math.PI / 6) * size)
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(angle - Math.PI / 6) * size, y + Math.sin(angle - Math.PI / 6) * size)
    ctx.stroke()
  }

  #drawHorizontalDimension(
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    width: number,
    height: number,
    label: string
  ) {
    const extension = 12
    const offset = Math.max(20, Math.min(32, height + 8))
    const y = top - offset
    const x1 = left
    const x2 = left + width

    ctx.beginPath()
    ctx.moveTo(x1, top)
    ctx.lineTo(x1, y + extension)
    ctx.moveTo(x2, top)
    ctx.lineTo(x2, y + extension)
    ctx.moveTo(x1, y)
    ctx.lineTo(x2, y)
    ctx.stroke()

    this.#drawArrowHead(ctx, x1, y, 0)
    this.#drawArrowHead(ctx, x2, y, Math.PI)

    this.#drawDimensionLabel(ctx, left + width / 2, y - 4, label)
  }

  #drawVerticalDimension(
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    width: number,
    height: number,
    label: string
  ) {
    const extension = 12
    const offset = Math.max(20, Math.min(32, width + 8))
    const x = left - offset
    const y1 = top
    const y2 = top + height

    ctx.beginPath()
    ctx.moveTo(left, y1)
    ctx.lineTo(x + extension, y1)
    ctx.moveTo(left, y2)
    ctx.lineTo(x + extension, y2)
    ctx.moveTo(x, y1)
    ctx.lineTo(x, y2)
    ctx.stroke()

    this.#drawArrowHead(ctx, x, y1, Math.PI / 2)
    this.#drawArrowHead(ctx, x, y2, -Math.PI / 2)

    this.#drawDimensionLabel(ctx, x - 4, top + height / 2, label, true)
  }

  #sceneToViewport(point: { x: number; y: number }) {
    const vpt = (this.#canvas as any).viewportTransform as number[] | undefined
    if (!vpt || vpt.length < 6) return point

    return {
      x: point.x * vpt[0] + point.y * vpt[2] + vpt[4],
      y: point.x * vpt[1] + point.y * vpt[3] + vpt[5]
    }
  }

  #getMeasurementOverlayContext() {
    const topContext = (this.#canvas as any).contextTop as CanvasRenderingContext2D | undefined
    if (!topContext) return undefined

    this.#canvas.clearContext(topContext)
    return topContext
  }

  #getMeasurementTargets() {
    return this.#canvas.getObjects().filter((obj: any) => obj.type === 'CadleWall' || obj.type === 'CadleWindow')
  }

  #intervalsOverlap(a: [number, number], b: [number, number], margin = 12) {
    return !(a[1] + margin < b[0] || b[1] + margin < a[0])
  }

  #assignDimensionLane(lanes: Array<Array<[number, number]>>, interval: [number, number]) {
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      const lane = lanes[laneIndex]
      const blocked = lane.some((existing) => this.#intervalsOverlap(existing, interval))
      if (!blocked) {
        lane.push(interval)
        return laneIndex
      }
    }

    lanes.push([interval])
    return lanes.length - 1
  }

  #drawArchitecturalSideDimension(
    ctx: CanvasRenderingContext2D,
    segment: {
      left: number
      top: number
      width: number
      height: number
      centerX: number
      centerY: number
      isHorizontal: boolean
      label: string
    },
    planBounds: { left: number; top: number; right: number; bottom: number; centerX: number; centerY: number },
    laneState: {
      top: Array<Array<[number, number]>>
      bottom: Array<Array<[number, number]>>
      left: Array<Array<[number, number]>>
      right: Array<Array<[number, number]>>
    }
  ) {
    const baseOffset = 28
    const laneStep = 24

    if (segment.isHorizontal) {
      const side = segment.centerY <= planBounds.centerY ? 'top' : 'bottom'
      const interval: [number, number] = [segment.left, segment.left + segment.width]
      const laneIndex = this.#assignDimensionLane(laneState[side], interval)
      const y =
        side === 'top'
          ? planBounds.top - (baseOffset + laneIndex * laneStep)
          : planBounds.bottom + (baseOffset + laneIndex * laneStep)

      const x1 = segment.left
      const x2 = segment.left + segment.width
      const yRef = side === 'top' ? segment.top : segment.top + segment.height

      ctx.beginPath()
      ctx.moveTo(x1, yRef)
      ctx.lineTo(x1, y)
      ctx.moveTo(x2, yRef)
      ctx.lineTo(x2, y)
      ctx.moveTo(x1, y)
      ctx.lineTo(x2, y)
      ctx.stroke()

      this.#drawArrowHead(ctx, x1, y, 0)
      this.#drawArrowHead(ctx, x2, y, Math.PI)

      this.#drawDimensionLabel(ctx, (x1 + x2) / 2, side === 'top' ? y - 4 : y + 18, segment.label)
      return
    }

    const side = segment.centerX <= planBounds.centerX ? 'left' : 'right'
    const interval: [number, number] = [segment.top, segment.top + segment.height]
    const laneIndex = this.#assignDimensionLane(laneState[side], interval)
    const x =
      side === 'left'
        ? planBounds.left - (baseOffset + laneIndex * laneStep)
        : planBounds.right + (baseOffset + laneIndex * laneStep)

    const y1 = segment.top
    const y2 = segment.top + segment.height
    const xRef = side === 'left' ? segment.left : segment.left + segment.width

    ctx.beginPath()
    ctx.moveTo(xRef, y1)
    ctx.lineTo(x, y1)
    ctx.moveTo(xRef, y2)
    ctx.lineTo(x, y2)
    ctx.moveTo(x, y1)
    ctx.lineTo(x, y2)
    ctx.stroke()

    this.#drawArrowHead(ctx, x, y1, Math.PI / 2)
    this.#drawArrowHead(ctx, x, y2, -Math.PI / 2)

    this.#drawDimensionLabel(ctx, side === 'left' ? x - 4 : x + 14, (y1 + y2) / 2, segment.label, true)
  }

  #getViewportBoundsForObject(obj: any) {
    const coords = typeof obj?.getCoords === 'function' ? obj.getCoords() : []
    if (!coords || coords.length === 0) return null

    const transformed = coords.map((point: any) =>
      this.#sceneToViewport({
        x: Number(point?.x ?? 0),
        y: Number(point?.y ?? 0)
      })
    )

    const xs = transformed.map((point: { x: number; y: number }) => point.x)
    const ys = transformed.map((point: { x: number; y: number }) => point.y)
    const left = Math.min(...xs)
    const top = Math.min(...ys)
    const right = Math.max(...xs)
    const bottom = Math.max(...ys)

    return {
      left,
      top,
      width: Math.abs(right - left),
      height: Math.abs(bottom - top)
    }
  }

  #scheduleMeasurementOverlayRender() {
    if (this.#measurementOverlayScheduled) return
    this.#measurementOverlayScheduled = true

    requestAnimationFrame(() => {
      this.#measurementOverlayScheduled = false
      this.#renderArchitecturalMeasurements()
    })
  }

  #renderArchitecturalMeasurements() {
    const ctx = this.#getMeasurementOverlayContext()
    if (!ctx) return

    if (!this.showMeasurements) return

    ctx.save()
    ctx.strokeStyle = '#3d2f25'
    ctx.fillStyle = '#3d2f25'
    ctx.lineWidth = 1.2
    ctx.setLineDash([])
    ctx.font = '600 11px "IBM Plex Sans", "Segoe UI", sans-serif'

    const targets = this.#getMeasurementTargets()
    if (targets.length === 0) {
      ctx.restore()
      return
    }

    const segments: Array<{
      left: number
      top: number
      width: number
      height: number
      centerX: number
      centerY: number
      isHorizontal: boolean
      label: string
    }> = []

    for (const obj of targets) {
      const bounds = this.#getViewportBoundsForObject(obj)
      if (!bounds) continue
      const { left, top, width, height } = bounds

      if (!width || !height) continue

      const isHorizontal = width >= height
      const sceneLength = isHorizontal
        ? Math.abs(Number(obj?.width ?? 0) * Number(obj?.scaleX ?? 1))
        : Math.abs(Number(obj?.height ?? 0) * Number(obj?.scaleY ?? 1))
      const label = this.#formatDimensionLabel(sceneLength)

      segments.push({
        left,
        top,
        width,
        height,
        centerX: left + width / 2,
        centerY: top + height / 2,
        isHorizontal,
        label
      })
    }

    if (segments.length === 0) {
      ctx.restore()
      return
    }

    const planBounds = {
      left: Math.min(...segments.map((segment) => segment.left)),
      top: Math.min(...segments.map((segment) => segment.top)),
      right: Math.max(...segments.map((segment) => segment.left + segment.width)),
      bottom: Math.max(...segments.map((segment) => segment.top + segment.height)),
      centerX: 0,
      centerY: 0
    }
    planBounds.centerX = (planBounds.left + planBounds.right) / 2
    planBounds.centerY = (planBounds.top + planBounds.bottom) / 2

    const laneState = {
      top: [] as Array<Array<[number, number]>>,
      bottom: [] as Array<Array<[number, number]>>,
      left: [] as Array<Array<[number, number]>>,
      right: [] as Array<Array<[number, number]>>
    }

    const orderedSegments = [...segments].sort((a, b) =>
      a.isHorizontal === b.isHorizontal ? 0 : a.isHorizontal ? -1 : 1
    )
    for (const segment of orderedSegments) {
      this.#drawArchitecturalSideDimension(ctx, segment, planBounds, laneState)
    }

    ctx.restore()
  }

  updateMeasures(evt) {
    var obj = evt.target
    if (obj.type != 'group') {
      return
    }
    const groupObjects = obj.getObjects?.() ?? []
    if (groupObjects.length < 3) return
    var width = obj.getWidth()
    var height = obj.getWidth()
    groupObjects[1].text = width.toFixed(2) + 'px'
    groupObjects[1].scaleX = 1 / obj.scaleX
    groupObjects[1].scaleY = 1 / obj.scaleY
    groupObjects[2].text = height.toFixed(2) + 'px'
    groupObjects[2].scaleX = 1 / obj.scaleY
    groupObjects[2].scaleY = 1 / obj.scaleX
  }

  async connectedCallback(): Promise<void> {
    super.connectedCallback()
    await this.updateComplete

    // Start with default A4 landscape dimensions
    const defaultWidth = this.#a4LandscapeWidth
    const defaultHeight = this.#a4LandscapeHeight

    this.#width = defaultWidth
    this.#height = defaultHeight

    // @ts-ignore
    this.#canvas = new Canvas(this.renderRoot.querySelector('canvas'), {
      selection: true,
      selectionKey: 'shiftKey',
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
      const target = options.target
      if (!target) return

      if (this.#isOpeningObject(target)) {
        const centerPoint = {
          left: Number(target.left ?? 0) + Math.abs(Number(target.width ?? 0) * Number(target.scaleX ?? 1)) / 2,
          top: Number(target.top ?? 0) + Math.abs(Number(target.height ?? 0) * Number(target.scaleY ?? 1)) / 2
        }
        const wallSnap = this.#findNearestWall(centerPoint)

        if (wallSnap) {
          this.#snapOpeningToWall(target, centerPoint, wallSnap)
          return
        }
      }

      const snapped = this.snapToGrid({ left: target.left, top: target.top })
      const previous = this.#lastMoveSnap.get(target)
      if (previous?.left === snapped.left && previous?.top === snapped.top) return
      if (Number(target.left ?? 0) === snapped.left && Number(target.top ?? 0) === snapped.top) return

      target.set({ left: snapped.left, top: snapped.top })
      this.#lastMoveSnap.set(target, snapped)
    })

    this.#canvas.on('after:render', () => {
      this.moving = false
      this.#scheduleMeasurementOverlayRender()
    })

    this.#canvas.on('object:scaling', (options) => {
      const target = options.target as any
      if (!target) return

      const baseWidth = Math.abs(Number(target.width ?? 0))
      const baseHeight = Math.abs(Number(target.height ?? 0))
      if (!baseWidth || !baseHeight) return

      const rawWidth = baseWidth * Number(target.scaleX ?? 1)
      const rawHeight = baseHeight * Number(target.scaleY ?? 1)

      const snappedWidth = Math.max(this.gridSize, this.snap(Math.abs(rawWidth)))
      const snappedHeight = Math.max(this.gridSize, this.snap(Math.abs(rawHeight)))

      const nextScaleX = snappedWidth / baseWidth
      const nextScaleY = snappedHeight / baseHeight
      const prevScaleX = Number(target.scaleX ?? 1)
      const prevScaleY = Number(target.scaleY ?? 1)

      if (Math.abs(nextScaleX - prevScaleX) < 0.0001 && Math.abs(nextScaleY - prevScaleY) < 0.0001) return

      const originX = (target.originX ?? 'left') as any
      const originY = (target.originY ?? 'top') as any
      const originPoint = target.getPointByOrigin(originX, originY)

      target.set({ scaleX: nextScaleX, scaleY: nextScaleY })
      target.setPositionByOrigin(originPoint, originX, originY)
      target.setCoords()
    })

    this.#canvas.on('mouse:up', () => {
      this.#lastMoveSnap = new WeakMap()
      for (const obj of this.#canvas.getObjects()) {
        obj.setCoords()
      }
    })

    this.#canvas.on('object:added', () => this.#scheduleBindingLookupRefresh())
    this.#canvas.on('object:removed', () => this.#scheduleBindingLookupRefresh())
    this.#canvas.on('object:modified', () => this.#scheduleBindingLookupRefresh())

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
    this.#scheduleBindingLookupRefresh()
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

  #isWallObject(obj: any) {
    return obj?.type === 'CadleWall'
  }

  #isOpeningObject(obj: any) {
    return obj?.type === 'CadleDoor' || obj?.type === 'CadleWindow' || obj?.type === 'CadleGate'
  }

  #getWallBounds(wall: any) {
    const left = Number(wall?.left ?? 0)
    const top = Number(wall?.top ?? 0)
    const width = Math.abs(Number(wall?.width ?? 0) * Number(wall?.scaleX ?? 1))
    const height = Math.abs(Number(wall?.height ?? 0) * Number(wall?.scaleY ?? 1))
    return {
      left,
      top,
      width,
      height,
      horizontal: width >= height
    }
  }

  #clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
  }

  #findNearestWall(point: { left: number; top: number }, maxDistance = Math.max(24, this.gridSize * 2)) {
    const walls = this.canvas.getObjects().filter((obj: any) => this.#isWallObject(obj))
    let best: any = null

    for (const wall of walls) {
      const bounds = this.#getWallBounds(wall)
      if (!bounds.width || !bounds.height) continue

      let distance = Number.POSITIVE_INFINITY

      if (bounds.horizontal) {
        const centerY = bounds.top + bounds.height / 2
        const projectedX = this.#clamp(point.left, bounds.left, bounds.left + bounds.width)
        distance = Math.hypot(point.left - projectedX, point.top - centerY)
      } else {
        const centerX = bounds.left + bounds.width / 2
        const projectedY = this.#clamp(point.top, bounds.top, bounds.top + bounds.height)
        distance = Math.hypot(point.left - centerX, point.top - projectedY)
      }

      if (distance <= maxDistance && (!best || distance < best.distance)) {
        best = { wall, bounds, distance }
      }
    }

    return best
  }

  #projectPointToWall(point: { left: number; top: number }, wallSnap: any) {
    const { bounds } = wallSnap
    const snapAxis = (value: number) => {
      if (this.freeDraw) return value
      return this.snap(value)
    }

    if (bounds.horizontal) {
      const projectedLeft = this.#clamp(point.left, bounds.left, bounds.left + bounds.width)
      return {
        left: snapAxis(projectedLeft),
        top: bounds.top + bounds.height / 2
      }
    }

    const projectedTop = this.#clamp(point.top, bounds.top, bounds.top + bounds.height)
    return {
      left: bounds.left + bounds.width / 2,
      top: snapAxis(projectedTop)
    }
  }

  #getWallDrawLayout(startPoint: { left: number; top: number }, currentPoint: { left: number; top: number }) {
    const dx = currentPoint.left - startPoint.left
    const dy = currentPoint.top - startPoint.top
    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)
    const thickness = Math.max(2, this.gridSize)

    if (absDx >= absDy) {
      return {
        left: Math.min(startPoint.left, currentPoint.left),
        top: startPoint.top - thickness / 2,
        width: Math.max(this.gridSize, absDx),
        height: thickness
      }
    }

    return {
      left: startPoint.left - thickness / 2,
      top: Math.min(startPoint.top, currentPoint.top),
      width: thickness,
      height: Math.max(this.gridSize, absDy)
    }
  }

  #getOpeningWallLayout(
    startPoint: { left: number; top: number },
    currentPoint: { left: number; top: number },
    wallSnap: any
  ) {
    const { bounds } = wallSnap
    const snappedStart = this.#projectPointToWall(startPoint, wallSnap)
    const snappedCurrent = this.#projectPointToWall(currentPoint, wallSnap)

    if (bounds.horizontal) {
      const startX = this.#clamp(snappedStart.left, bounds.left, bounds.left + bounds.width)
      const currentX = this.#clamp(snappedCurrent.left, bounds.left, bounds.left + bounds.width)
      return {
        left: Math.min(startX, currentX),
        top: bounds.top,
        width: Math.max(this.gridSize, Math.abs(currentX - startX)),
        height: bounds.height,
        horizontal: true,
        wallThickness: bounds.height,
        dx: currentX - startX,
        dy: currentPoint.top - startPoint.top
      }
    }

    const startY = this.#clamp(snappedStart.top, bounds.top, bounds.top + bounds.height)
    const currentY = this.#clamp(snappedCurrent.top, bounds.top, bounds.top + bounds.height)
    return {
      left: bounds.left,
      top: Math.min(startY, currentY),
      width: bounds.width,
      height: Math.max(this.gridSize, Math.abs(currentY - startY)),
      horizontal: false,
      wallThickness: bounds.width,
      dx: currentPoint.left - startPoint.left,
      dy: currentY - startY
    }
  }

  #snapOpeningToWall(target: any, point: { left: number; top: number }, wallSnap: any) {
    const { bounds } = wallSnap
    const currentWidth = Math.abs(Number(target.width ?? 0) * Number(target.scaleX ?? 1)) || this.gridSize
    const currentHeight = Math.abs(Number(target.height ?? 0) * Number(target.scaleY ?? 1)) || this.gridSize
    const projected = this.#projectPointToWall(point, wallSnap)

    if (bounds.horizontal) {
      const left = this.#clamp(
        projected.left - currentWidth / 2,
        bounds.left,
        bounds.left + bounds.width - currentWidth
      )
      const updates: Record<string, any> = {
        left,
        top: bounds.top,
        width: currentWidth,
        height: bounds.height
      }

      if (target.type === 'CadleDoor') {
        updates.wallThickness = bounds.height
        if (target.doorSwingDirection !== 'up' && target.doorSwingDirection !== 'down')
          updates.doorSwingDirection = 'down'
        if (target.doorHingeSide !== 'left' && target.doorHingeSide !== 'right') updates.doorHingeSide = 'left'
      }

      target.set(updates)
      target.setCoords()
      return true
    }

    const top = this.#clamp(projected.top - currentHeight / 2, bounds.top, bounds.top + bounds.height - currentHeight)
    const updates: Record<string, any> = {
      left: bounds.left,
      top,
      width: bounds.width,
      height: currentHeight
    }

    if (target.type === 'CadleDoor') {
      updates.wallThickness = bounds.width
      if (target.doorSwingDirection !== 'left' && target.doorSwingDirection !== 'right')
        updates.doorSwingDirection = 'right'
      if (target.doorHingeSide !== 'top' && target.doorHingeSide !== 'bottom') updates.doorHingeSide = 'top'
    }

    target.set(updates)
    target.setCoords()
    return true
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
          this.canvas.selection = true
          this.#canvas.isDrawingMode = false
          return
        default:
          this.drawing = true
          const pointer = this.#extractPointer(e)
          const snappedPointer = this.snapToGrid({ left: pointer.x, top: pointer.y })
          this.#drawSnapWall = null
          this.#startPoints = snappedPointer

          if (this.action === 'draw-door' || this.action === 'draw-window' || this.action === 'draw-gate') {
            const wallSnap = this.#findNearestWall(snappedPointer)
            if (wallSnap) {
              this.#drawSnapWall = wallSnap
              this.#startPoints = this.#projectPointToWall(snappedPointer, wallSnap)
            }
          }
          const id = Math.random().toString(36).slice(-12)
          const index = this.canvas.getObjects().length

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
            const wallLayout = this.#getWallDrawLayout(this.#startPoints, snappedPointer)
            this._current = new CadleWall({
              ...sharedDrawOptions,
              left: wallLayout.left,
              top: wallLayout.top,
              width: wallLayout.width,
              height: wallLayout.height,
              strokeWidth: 0,
              fill: cadleShell._currentColor
            })
          } else if (this.action === 'draw-window') {
            const wallLayout = this.#drawSnapWall
              ? this.#getOpeningWallLayout(this.#startPoints, this.#startPoints, this.#drawSnapWall)
              : null
            this._current = new CadleWindow({
              ...sharedDrawOptions,
              left: wallLayout?.left ?? this.#startPoints.left,
              top: wallLayout?.top ?? this.#startPoints.top,
              width: wallLayout?.width ?? pointer.x - this.#startPoints.left,
              height: wallLayout?.height ?? pointer.y - this.#startPoints.top,
              strokeWidth: 1,
              strokeDashArray: [5, 5]
            })
          } else if (this.action === 'draw-door') {
            const wallLayout = this.#drawSnapWall
              ? this.#getOpeningWallLayout(this.#startPoints, this.#startPoints, this.#drawSnapWall)
              : null
            this._current = new CadleDoor({
              ...sharedDrawOptions,
              left: wallLayout?.left ?? this.#startPoints.left,
              top: wallLayout?.top ?? this.#startPoints.top,
              width: wallLayout?.width ?? pointer.x - this.#startPoints.left,
              height: wallLayout?.height ?? pointer.y - this.#startPoints.top,
              wallThickness: wallLayout?.wallThickness,
              strokeWidth: 1,
              strokeDashArray: [5, 5]
            })
          } else if (this.action === 'draw-gate') {
            const wallLayout = this.#drawSnapWall
              ? this.#getOpeningWallLayout(this.#startPoints, this.#startPoints, this.#drawSnapWall)
              : null
            this._current = new CadleGate({
              ...sharedDrawOptions,
              left: wallLayout?.left ?? this.#startPoints.left,
              top: wallLayout?.top ?? this.#startPoints.top,
              width: wallLayout?.width ?? pointer.x - this.#startPoints.left,
              height: wallLayout?.height ?? pointer.y - this.#startPoints.top,
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
    if (!this._selectionWasTrue && this.canvas.selection) this._selectionWasTrue = true
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

      this._current.set({ width: Math.max(this.gridSize, Math.abs(this.#startPoints.left - currentPoints.left)) })
      this._current.set({ height: Math.max(this.gridSize, Math.abs(this.#startPoints.top - currentPoints.top)) })
    } else if (this.action === 'draw-window') {
      if (this.#drawSnapWall) {
        const wallLayout = this.#getOpeningWallLayout(this.#startPoints, currentPoints, this.#drawSnapWall)
        this._current.set({
          left: wallLayout.left,
          top: wallLayout.top,
          width: wallLayout.width,
          height: wallLayout.height
        })
        return
      }

      if (this.#startPoints.left > currentPoints.left) {
        this._current.set({ left: Math.abs(currentPoints.left) })
      }
      if (this.#startPoints.top > currentPoints.top) {
        this._current.set({ top: Math.abs(currentPoints.top) })
      }

      this._current.set({ width: Math.max(this.gridSize, Math.abs(this.#startPoints.left - currentPoints.left)) })
      this._current.set({ height: Math.max(this.gridSize, Math.abs(this.#startPoints.top - currentPoints.top)) })
    } else if (this.action === 'draw-door') {
      if (this.#drawSnapWall) {
        const wallLayout = this.#getOpeningWallLayout(this.#startPoints, currentPoints, this.#drawSnapWall)
        this._current.set({
          left: wallLayout.left,
          top: wallLayout.top,
          width: wallLayout.width,
          height: wallLayout.height,
          wallThickness: wallLayout.wallThickness
        })

        if (wallLayout.horizontal) {
          this._current.set({
            doorHingeSide: wallLayout.dx >= 0 ? 'left' : 'right',
            doorSwingDirection: wallLayout.dy >= 0 ? 'down' : 'up'
          })
        } else {
          this._current.set({
            doorHingeSide: wallLayout.dy >= 0 ? 'top' : 'bottom',
            doorSwingDirection: wallLayout.dx >= 0 ? 'right' : 'left'
          })
        }
        return
      }

      if (this.#startPoints.left > currentPoints.left) {
        this._current.set({ left: Math.abs(currentPoints.left) })
      }
      if (this.#startPoints.top > currentPoints.top) {
        this._current.set({ top: Math.abs(currentPoints.top) })
      }

      this._current.set({ width: Math.max(this.gridSize, Math.abs(this.#startPoints.left - currentPoints.left)) })
      this._current.set({ height: Math.max(this.gridSize, Math.abs(this.#startPoints.top - currentPoints.top)) })

      const dx = currentPoints.left - this.#startPoints.left
      const dy = currentPoints.top - this.#startPoints.top

      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      const orientationThreshold = 1.15
      const previousHorizontal =
        this._current.doorSwingDirection === 'up' || this._current.doorSwingDirection === 'down'

      // Avoid jitter around diagonal drags by keeping previous orientation inside a deadzone.
      let isHorizontal = previousHorizontal
      if (absDx > absDy * orientationThreshold) {
        isHorizontal = true
      } else if (absDy > absDx * orientationThreshold) {
        isHorizontal = false
      }

      if (isHorizontal) {
        this._current.set({
          // Keep hinge on the side where the drag started for predictable placement.
          doorHingeSide: dx >= 0 ? 'left' : 'right',
          doorSwingDirection: dy >= 0 ? 'down' : 'up'
        })
      } else {
        this._current.set({
          // Keep hinge on the side where the drag started for predictable placement.
          doorHingeSide: dy >= 0 ? 'top' : 'bottom',
          doorSwingDirection: dx >= 0 ? 'right' : 'left'
        })
      }
    } else if (this.action === 'draw-gate') {
      if (this.#drawSnapWall) {
        const wallLayout = this.#getOpeningWallLayout(this.#startPoints, currentPoints, this.#drawSnapWall)
        this._current.set({
          left: wallLayout.left,
          top: wallLayout.top,
          width: wallLayout.width,
          height: wallLayout.height
        })
        return
      }

      if (this.#startPoints.left > currentPoints.left) {
        this._current.set({ left: Math.abs(currentPoints.left) })
      }
      if (this.#startPoints.top > currentPoints.top) {
        this._current.set({ top: Math.abs(currentPoints.top) })
      }

      this._current.set({ width: Math.abs(this.#startPoints.left - currentPoints.left) })
      this._current.set({ height: Math.abs(this.#startPoints.top - currentPoints.top) })
    } else if (this.action === 'draw-arc') {
      console.log(currentPoints.left)
      console.log(this.#startPoints.left)

      this._current.set({
        radius: Math.abs(this.#startPoints.top - currentPoints.top),

        endAngle: Math.abs((this.#startPoints.left - currentPoints.left) / (Math.PI / 5))
      })
      // this._current.set({ radius: Math.abs(this.#startPoints.top - currentPoints.top) });
    } else if (this.action === 'draw-wall') {
      const wallLayout = this.#getWallDrawLayout(this.#startPoints, currentPoints)
      this._current.set(wallLayout)
    } else if (this.action === 'draw-symbol') {
      this._current.set({ left: Math.abs(currentPoints.left) })
      this._current.set({ top: Math.abs(currentPoints.top) })
    } else if (this.action === 'draw-text') {
      this._current.set({ left: Math.abs(currentPoints.left) })
      this._current.set({ top: Math.abs(currentPoints.top) })
    }
  }

  _mousemove(e) {
    const pointer = this.#extractPointer(e)
    state.mouse.position = { x: pointer.x, y: pointer.y }

    if (this.action === 'draw') {
      return
    }

    if (e.target && !this.drawing) return
    if (!this.drawing) return
    if (!this._current) return

    const currentPoints = this.snapToGrid({ left: pointer.x, top: pointer.y })
    this.updateObjects(currentPoints)
    this.canvas.requestRenderAll()
  }

  _mouseenter(e) {
    const pointer = this.#extractPointer(e)
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
    const pointer = this.#extractPointer(e)
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

    this.#drawSnapWall = null
    this.canvas.selection = true
    this.#canvas.isDrawingMode = false

    this.canvas.renderAll()
  }

  _mouseup(e) {
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
      this.#drawSnapWall = null
      this.#canvas.isDrawingMode = false
      if (this.action === 'draw') {
        this.canvas.selection = true
        this.canvas.isDrawingMode = false
        this.action = undefined
      }
      if (this._selectionWasTrue) {
        this.canvas.selection = true
        this._selectionWasTrue = false
      }
      // this.canvas.renderAll()
    } else if (this.canvas.getActiveObjects().length > 1) {
      this._drawState = 'group'
      this._currentGroup = this.canvas.getActiveObjects()[0].group
      this.canvas.renderAll()
    }
  }

  toJSON() {
    const json = (this.#canvas as any).toJSON([
      'bindingId',
      'bindingRole',
      'symbolName',
      'symbolPath',
      'oneLineEligible',
      'situationElementType',
      'situationMetadata',
      'sourceObjectUuid'
    ])
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
        obj.type === 'door' ||
        obj.type === 'window' ||
        obj.type === 'gate' ||
        obj.type === 'CadleWall' ||
        obj.type === 'CadleWidth' ||
        obj.type === 'CadleDepth' ||
        obj.type === 'CadleWindow' ||
        obj.type === 'CadleDoor' ||
        obj.type === 'CadleGate'
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

      if (obj.type === 'wall') obj.type = 'CadleWall'
      if (obj.type === 'door') obj.type = 'CadleDoor'
      if (obj.type === 'window') obj.type = 'CadleWindow'
      if (obj.type === 'gate') obj.type = 'CadleGate'

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
      } else if (obj.type === 'CadleGate') {
        const gate = new CadleGate(obj)
        this.#canvas.add(gate as any)
      }
    }

    this.#canvas.renderAll()
    this.#scheduleBindingLookupRefresh()
    this.fitToContainer()
  }

  toDataURL() {
    return this.#canvas.toDataURL({ multiplier: 3, quality: 100, enableRetinaScaling: true })
  }

  resizeCanvas() {
    const stage = this.renderRoot.querySelector('.canvas-stage') as HTMLElement | null
    const container =
      stage?.getBoundingClientRect() ?? this.parentElement?.getBoundingClientRect() ?? this.getBoundingClientRect()

    // Skip if container doesn't have valid dimensions yet
    if (!container.width || !container.height || container.width < 200 || container.height < 200) {
      return
    }

    // A4 landscape aspect ratio
    const aspectRatio = this.#a4LandscapeAspect

    // Calculate new canvas size from available viewport space
    const stagePadding = 24
    const availableWidth = Math.max(200, container.width - stagePadding)
    const availableHeight = Math.max(200, container.height - stagePadding)

    let canvasWidth = availableWidth
    let canvasHeight = availableHeight

    if (canvasWidth / canvasHeight > aspectRatio) {
      canvasWidth = canvasHeight * aspectRatio
    } else {
      canvasHeight = canvasWidth / aspectRatio
    }

    canvasWidth = Math.floor(canvasWidth)
    canvasHeight = Math.floor(canvasHeight)

    const widthChanged = Math.abs(this.#width - canvasWidth) > 1
    const heightChanged = Math.abs(this.#height - canvasHeight) > 1
    if (!widthChanged && !heightChanged) return

    this.#width = canvasWidth
    this.#height = canvasHeight
    this.#canvas.setDimensions({ width: canvasWidth, height: canvasHeight })
    this.fitToContainer()
    this.#canvas.renderAll()
  }

  #fitContentInCanvas() {
    const objects = this.#canvas.getObjects().filter((obj: any) => obj.visible !== false)

    if (objects.length === 0) {
      this.zoomLevel = 1
      this.#canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
      return
    }

    let minLeft = Number.POSITIVE_INFINITY
    let minTop = Number.POSITIVE_INFINITY
    let maxRight = Number.NEGATIVE_INFINITY
    let maxBottom = Number.NEGATIVE_INFINITY

    for (const obj of objects) {
      const bounds = obj.getBoundingRect(true, true)
      minLeft = Math.min(minLeft, Number(bounds.left ?? 0))
      minTop = Math.min(minTop, Number(bounds.top ?? 0))
      maxRight = Math.max(maxRight, Number(bounds.left ?? 0) + Number(bounds.width ?? 0))
      maxBottom = Math.max(maxBottom, Number(bounds.top ?? 0) + Number(bounds.height ?? 0))
    }

    const contentWidth = Math.max(1, maxRight - minLeft)
    const contentHeight = Math.max(1, maxBottom - minTop)
    const margin = 28
    const availableWidth = Math.max(1, this.#width - margin * 2)
    const availableHeight = Math.max(1, this.#height - margin * 2)
    const fitZoom = Math.max(0.1, Math.min(3, Math.min(availableWidth / contentWidth, availableHeight / contentHeight)))

    this.zoomLevel = fitZoom

    const translateX = this.#width / 2 - (minLeft + contentWidth / 2) * fitZoom
    const translateY = this.#height / 2 - (minTop + contentHeight / 2) * fitZoom

    this.#canvas.setViewportTransform([fitZoom, 0, 0, fitZoom, translateX, translateY])
  }

  fitToContainer() {
    this.#fitContentInCanvas()
    this.#canvas.renderAll()
    this.requestUpdate()
  }

  setZoom(zoom: number) {
    // Clamp zoom between 0.1 and 3
    const newZoom = Math.max(0.1, Math.min(3, zoom))
    if (this.zoomLevel !== newZoom) {
      const center = { x: this.#width / 2, y: this.#height / 2 }
      this.zoomLevel = newZoom
      this.#canvas.zoomToPoint(center as any, this.zoomLevel)
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

  toggleMeasurements() {
    const next = !this.showMeasurements
    this.showMeasurements = next
    cadleShell.showMeasurements = next
    this.requestUpdate()
    this.#canvas.requestRenderAll()
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
          background: transparent;
          overflow: hidden;
          --grid-size: ${this.gridSize || 10}px;
          --grid-line-color: color-mix(in srgb, var(--md-sys-color-outline-light, #79747e) 55%, transparent);
          --grid-major-line-color: color-mix(in srgb, var(--md-sys-color-outline-light, #79747e) 80%, transparent);
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
          background-color: transparent;
          background-image:
            linear-gradient(to right, var(--grid-line-color) 1px, transparent 1px),
            linear-gradient(to bottom, var(--grid-line-color) 1px, transparent 1px),
            linear-gradient(to right, var(--grid-major-line-color) 1px, transparent 1px),
            linear-gradient(to bottom, var(--grid-major-line-color) 1px, transparent 1px);
          background-size:
            var(--grid-size) var(--grid-size),
            var(--grid-size) var(--grid-size),
            calc(var(--grid-size) * 5) calc(var(--grid-size) * 5),
            calc(var(--grid-size) * 5) calc(var(--grid-size) * 5);
          background-position:
            0 0,
            0 0,
            0 0,
            0 0;
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
          background: transparent !important;
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

        .zoom-buttons {
          display: flex;
          gap: 6px;
        }

        .canvas-button {
          border: 1px solid rgba(0, 0, 0, 0.14);
          background: var(--md-sys-color-surface-container-high, #fff);
          color: var(--md-sys-color-on-surface, #222);
          border-radius: 6px;
          padding: 4px 8px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }

        .canvas-button.active {
          border-color: #a85427;
          color: #a85427;
          background: rgba(168, 84, 39, 0.08);
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
        <button
          class="canvas-button ${this.showMeasurements ? 'active' : ''}"
          @click=${() => this.toggleMeasurements()}>
          Measure ${this.showMeasurements ? 'On' : 'Off'}
        </button>
        <div class="zoom-buttons">
          <button
            class="canvas-button"
            title="Zoom out"
            @click=${() => this.zoomOut()}>
            -
          </button>
          <button
            class="canvas-button"
            title="Reset zoom"
            @click=${() => this.resetZoom()}>
            1:1
          </button>
          <button
            class="canvas-button"
            title="Zoom in"
            @click=${() => this.zoomIn()}>
            +
          </button>
        </div>
        <div class="zoom-level">${Math.round(this.zoomLevel * 100)}%</div>
      </div>`
  }
}
