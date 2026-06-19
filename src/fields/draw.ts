import { LiteElement, html, css, property, customElement, query } from '@vandeurenglenn/lite'
import { Canvas, Circle, Line, Textbox, PencilBrush } from './../fabric-imports.js'
import type { FabricObject } from 'fabric'
import type { JsonValue, HistoryAction } from '../types.js'
import { AppShell } from '../shell.js'
import type { Project } from '../types.js'
import Rect from './../symbols/rectangle.js'
import state from '../state.js'
import './../contextmenu.js'
import CadleWindow from '../symbols/window.js'
import CadleWall from './../symbols/wall.js'
import CadleDoor from '../symbols/door.js'
import CadleGate from '../symbols/gate.js'
import {
  getBoundOneLineCatalogSymbols,
  normalizeBindingId,
  getBindingGroups,
  getBindingGroupCatalogSymbols,
  getBindingValidationReport,
  buildAutoOneWireSchema
} from './draw/binding-utils.js'
import {
  findNearestWall,
  isOpeningObject,
  isWallObject,
  getWallBounds,
  getWallEndpoints,
  projectPointToWall,
  getWallDrawLayout,
  getWallDrawLayoutFree,
  getOpeningWallLayout,
  getCenteredOpeningLayout,
  snapOpeningToWall,
  snapWallEndpoint,
  applyWallEndpoint,
  LeftTop,
  type WallObject,
  type WallSnap
} from './draw/wall-snap.js'
import { WallSketchSession } from './draw/wall-sketch.js'
import { collectWallNodes, findWallNodeAt, wallsForNode, type WallNode } from './draw/wall-nodes.js'
import { anchorPointOnWall, buildOpeningAnchor, readOpeningAnchor } from './draw/opening-anchor.js'
import { OpeningHoverGhost } from './draw/opening-placement.js'
import { sceneToViewport } from './draw/overlay-geometry.js'
import { BindingOverlay } from './draw/binding-overlay.js'
import { renderArchitecturalMeasurements, getMeasurementOverlayContext } from './draw/measurement-utils.js'
import { canvasInk, canvasSurface, canvasWallFill, invertColor } from '../symbols/canvas-tokens.js'
import {
  BINDING_AND_SYMBOL_PROPS,
  instantiateSpecials,
  partitionRawObjects,
  reapplyBindingProps,
  type SerializedObject
} from './draw/json-io.js'
import pubsub from '../pubsub.js'
import { ZoomController } from './draw/zoom-controller.js'
import { group } from '../controllers/keyboard/commands/group.js'
import { ungroup } from '../controllers/keyboard/commands/ungroup.js'
import { getStoredCustomSymbols, setStoredCustomSymbols } from '../shell/custom-symbols.js'
import { ProtectionSymbolClassifier } from '../helpers/protection-symbol.js'
// import 'fabric-history';

type ContextMenuTarget = { type?: string; localName?: string }
type ContextMenuElement = HTMLElement & {
  open?: boolean
  showAt?: (clientX: number, clientY: number, target?: ContextMenuTarget | null, selectedCount?: number) => void
  currentTarget?: ContextMenuTarget | null
  selectedCount?: number
}

declare global {
  interface HTMLElementTagNameMap {
    'draw-field': DrawField
  }
}

type DrawFabricObject = FabricObject & Record<string, JsonValue>
type EditableTextFabricObject = FabricObject & {
  type?: string
  editable?: boolean
  isType?: (type: string) => boolean
  enterEditing?: () => void
  selectAll?: () => void
}

type DblClickInput = {
  target?: FabricObject | null
  subTargets?: FabricObject[] | null
}

type OneWirePortSide = 'left' | 'right' | 'top' | 'bottom' | 'center'
type OneWirePortPoint = { left: number; top: number }
type OneWireSnapObject = FabricObject & {
  oneWireSnap?: boolean
  oneWireSnapPorts?: string
  getBoundingRect?: () => { left: number; top: number; width: number; height: number }
  left?: number
  top?: number
  width?: number
  height?: number
  scaleX?: number
  scaleY?: number
}

type OpeningSnapTarget = FabricObject & {
  situationMetadata?: JsonValue
  width?: number
  height?: number
  scaleX?: number
  scaleY?: number
  set: (properties: Record<string, unknown>) => FabricObject
  setCoords?: () => void
}

type PointerInput = {
  scenePoint?: { x?: number; y?: number }
  e?: PointerEvent
  pointer?: { x?: number; y?: number }
}

type CableLineObject = FabricObject & {
  x1?: number
  y1?: number
  x2?: number
  y2?: number
  bindingId?: string
  bindingRole?: string
  bindingGroupCableLengthMeters?: number
}

@customElement('draw-field')
export class DrawField extends LiteElement {
  #canvas: Canvas
  #height = 0
  #width = 0
  readonly #a4LandscapeWidth = 1123
  readonly #a4LandscapeHeight = 794
  readonly #a4LandscapeAspect = this.#a4LandscapeWidth / this.#a4LandscapeHeight
  #startPoints: { left: number; top: number } = { left: 0, top: 0 }
  #drawSnapWall: WallSnap | null = null
  #openingHoverGhost = new OpeningHoverGhost()
  #lastMoveSnap = new WeakMap<FabricObject, { left: number; top: number }>()
  #overlayPointer: LeftTop | null = null
  #keydownListener = (event: KeyboardEvent) => this._keydown(event)
  #bindingLookup = new Map<string, DrawFabricObject[]>()
  #bindingLookupVersion = 0
  #bindingLookupScheduled = false
  #measurementOverlayScheduled = false
  #bindingOverlayRenderer = new BindingOverlay({
    normalizeId: (raw) => this.#normalizeBindingId(raw),
    onLookupUpdated: () => {
      // Label overlay rendering does not depend on lookup dispatch here.
    }
  })

  #zoomController?: ZoomController
  #wallSketch = new WallSketchSession()
  #wallDrawFreeMode = false
  #draggingWallNode: WallNode | null = null
  #wallNodeDragMoved = false
  #selectedWallNode: WallNode | null = null
  // Other vertices the dragged corner can merge into, and the one currently
  // under the cursor (drop-to-weld snapping).
  #wallNodeWeldTargets: WallNode[] = []
  #wallNodeWeldActive: WallNode | null = null

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
  _currentGroup: FabricObject | null = null

  @property({ type: Number })
  accessor gridSize: number

  @property({ type: Number })
  accessor zoomLevel: number = 1

  @property({ attribute: false, consumes: 'project' })
  accessor project: Project | null = null

  @property({ attribute: false, consumes: 'loadedPage' })
  accessor loadedPage = ''

  @property({ type: Boolean })
  accessor showMeasurements: boolean = false

  @property({ type: Array })
  accessor remoteCursors: Array<{ id: string; name: string; color: string; x: number; y: number }> = []

  @query('context-menu')
  accessor contextMenu!: ContextMenuElement | null

  @query('.canvas-container')
  accessor canvasContainer!: HTMLElement | null

  _current: FabricObject | null = null
  _selectedSymbolPrototype: FabricObject | null = null
  #contextTargetObject: FabricObject | null = null
  #contextSelection: FabricObject[] = []
  #lastPointerTarget: FabricObject | null = null

  #historyEntries: Array<{ id: string; label: string; timestamp: number; json: JsonValue }> = []
  #historyRecordingEnabled = true
  #historySnapshotCounter = 0

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
        --grid-size: 10px;
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
        display: none;
      }
    `
  ]

  snap(value) {
    return Math.round(value / this.gridSize) * this.gridSize
  }

  #isOneWireSnapObject(object: FabricObject | null | undefined): object is OneWireSnapObject {
    if (!object) return false
    const candidate = object as OneWireSnapObject
    return candidate.oneWireSnap === true && typeof candidate.oneWireSnapPorts === 'string'
  }

  #resolveOneWirePortPoints(object: OneWireSnapObject): OneWirePortPoint[] {
    const rawPorts = String(object.oneWireSnapPorts ?? '')
    const ports = rawPorts
      .split(',')
      .map((port) => port.trim().toLowerCase() as OneWirePortSide)
      .filter(
        (port): port is OneWirePortSide =>
          port === 'left' || port === 'right' || port === 'top' || port === 'bottom' || port === 'center'
      )
    if (!ports.length) return []

    const bounds = object.getBoundingRect?.()
    const left = Number(bounds?.left ?? object.left ?? 0)
    const top = Number(bounds?.top ?? object.top ?? 0)
    const width = Number(bounds?.width ?? Math.abs(Number(object.width ?? 0) * Number(object.scaleX ?? 1)))
    const height = Number(bounds?.height ?? Math.abs(Number(object.height ?? 0) * Number(object.scaleY ?? 1)))
    if (!Number.isFinite(left) || !Number.isFinite(top) || width <= 0 || height <= 0) return []

    const centerX = left + width / 2
    const centerY = top + height / 2
    const points: OneWirePortPoint[] = []

    for (const port of ports) {
      if (port === 'left') points.push({ left, top: centerY })
      else if (port === 'right') points.push({ left: left + width, top: centerY })
      else if (port === 'top') points.push({ left: centerX, top })
      else if (port === 'bottom') points.push({ left: centerX, top: top + height })
      else points.push({ left: centerX, top: centerY })
    }
    return points
  }

  #snapLinePointToOneWirePort(point: OneWirePortPoint, excludeObject?: FabricObject | null): OneWirePortPoint {
    const threshold = Math.max(18, this.gridSize * 2)
    const thresholdSquared = threshold * threshold
    let closest: OneWirePortPoint | null = null
    let bestDistanceSquared = Number.POSITIVE_INFINITY

    for (const object of this.#canvas.getObjects() as FabricObject[]) {
      if (excludeObject && object === excludeObject) continue
      if (!this.#isOneWireSnapObject(object)) continue

      const ports = this.#resolveOneWirePortPoints(object)
      for (const port of ports) {
        const dx = port.left - point.left
        const dy = port.top - point.top
        const distanceSquared = dx * dx + dy * dy
        if (distanceSquared > thresholdSquared || distanceSquared >= bestDistanceSquared) continue
        bestDistanceSquared = distanceSquared
        closest = port
      }
    }

    if (!closest) return point
    return { left: this.snap(closest.left), top: this.snap(closest.top) }
  }

  #extractPointer(input: PointerInput) {
    if (input?.scenePoint) {
      return {
        x: Number(input.scenePoint.x ?? 0),
        y: Number(input.scenePoint.y ?? 0)
      }
    }

    const rawEvent = (input?.e ?? input) as PointerEvent | null
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

  isWallChainActive() {
    return this.action === 'draw-wall' && this.#wallSketch.isActive
  }

  #openingLength(target: OpeningSnapTarget) {
    const width = Math.abs(Number(target.width ?? 0) * Number(target.scaleX ?? 1))
    const height = Math.abs(Number(target.height ?? 0) * Number(target.scaleY ?? 1))
    return Math.max(this.gridSize, width, height)
  }

  #writeOpeningAnchor(target: OpeningSnapTarget, wall: WallObject) {
    const center = {
      left: Number(target.left ?? 0) + Math.abs(Number(target.width ?? 0) * Number(target.scaleX ?? 1)) / 2,
      top: Number(target.top ?? 0) + Math.abs(Number(target.height ?? 0) * Number(target.scaleY ?? 1)) / 2
    }
    const anchor = buildOpeningAnchor(wall, center, this.#openingLength(target))
    if (!anchor) return

    const metadata =
      target.situationMetadata &&
      typeof target.situationMetadata === 'object' &&
      !Array.isArray(target.situationMetadata)
        ? (target.situationMetadata as Record<string, JsonValue>)
        : {}
    target.set({
      situationMetadata: {
        ...metadata,
        wallUuid: anchor.wallUuid,
        offsetRatio: anchor.offsetRatio,
        openingLength: anchor.openingLength
      }
    })
  }

  #reflowAnchoredOpeningsForWall(wall: WallObject) {
    const wallUuid =
      typeof (wall as { uuid?: unknown }).uuid === 'string' ? String((wall as { uuid?: string }).uuid) : ''
    if (!wallUuid) return

    const wallSnap = { wall, bounds: getWallBounds(wall) }
    for (const object of this.#canvas.getObjects() as FabricObject[]) {
      if (!isOpeningObject(object)) continue
      const opening = object as OpeningSnapTarget
      const anchor = readOpeningAnchor(opening.situationMetadata)
      if (!anchor || anchor.wallUuid !== wallUuid) continue

      const anchorPoint = anchorPointOnWall(wall, anchor)
      const snapped = snapOpeningToWall(opening, anchorPoint, wallSnap, this.gridSize, {
        freeDraw: this.freeDraw,
        snap: (value: number) => this.snap(value)
      })
      if (!snapped) continue

      this.#writeOpeningAnchor(opening, wall)
      opening.setCoords?.()
    }
  }

  #buildWallPreviewAt(start: LeftTop) {
    const previewLayout = this.#wallDrawFreeMode
      ? getWallDrawLayoutFree(this.canvas, start, start, this.gridSize)
      : getWallDrawLayout(this.canvas, start, start, this.gridSize)
    const previewPoints = this.#wallSketch.isActive ? this.#wallSketch.getPreviewPoints(start) : [start, start]
    const xs = previewPoints.map((point) => point.left)
    const ys = previewPoints.map((point) => point.top)
    const left = Math.min(...xs)
    const top = Math.min(...ys)
    const width = Math.max(1, Math.max(...xs) - left)
    const height = Math.max(1, Math.max(...ys) - top)
    return new CadleWall({
      left,
      top,
      width,
      height,
      angle: 0,
      originX: 'left',
      originY: 'top',
      strokeWidth: 1.5,
      stroke: canvasInk(),
      strokeDashArray: [10, 6],
      fill: canvasSurface(),
      opacity: 0.72,
      wallThickness: Math.min(previewLayout.width, previewLayout.height),
      wallPoints: previewPoints.map((point) => ({ x: point.left - left, y: point.top - top }))
    })
  }

  #updateWallPreview(currentPoint: LeftTop) {
    if (!this._current) return

    const wallFreeMode = this.freeDraw || this.#wallDrawFreeMode
    const snappedPointer = wallFreeMode ? currentPoint : this.snapToGrid(currentPoint)
    const snap = snapWallEndpoint(
      this.canvas,
      snappedPointer,
      this._current as WallObject | null,
      this.gridSize,
      false,
      wallFreeMode
    )
    const endPoint = { left: snap.left, top: snap.top }
    const previewLayout = wallFreeMode
      ? getWallDrawLayoutFree(
          this.canvas,
          this.#startPoints,
          endPoint,
          this.gridSize,
          this._current as WallObject | null
        )
      : getWallDrawLayout(this.canvas, this.#startPoints, endPoint, this.gridSize, this._current as WallObject | null)
    const previewPoints = this.#wallSketch.getPreviewPoints(endPoint)
    const xs = previewPoints.map((point) => point.left)
    const ys = previewPoints.map((point) => point.top)
    const left = Math.min(...xs)
    const top = Math.min(...ys)
    const width = Math.max(1, Math.max(...xs) - left)
    const height = Math.max(1, Math.max(...ys) - top)

    this._current.set({
      left,
      top,
      width,
      height,
      angle: 0,
      originX: 'left',
      originY: 'top',
      wallThickness: Math.min(previewLayout.width, previewLayout.height),
      wallPoints: previewPoints.map((point) => ({ x: point.left - left, y: point.top - top }))
    })
  }

  #commitWallSegment(pointer: LeftTop): boolean {
    if (!this._current) return false

    const wallFreeMode = this.freeDraw || this.#wallDrawFreeMode
    const snappedPointer = wallFreeMode ? pointer : this.snapToGrid(pointer)
    const snap = snapWallEndpoint(
      this.canvas,
      snappedPointer,
      this._current as WallObject | null,
      this.gridSize,
      false,
      wallFreeMode
    )
    const endPoint = { left: snap.left, top: snap.top }
    if (Math.hypot(endPoint.left - this.#startPoints.left, endPoint.top - this.#startPoints.top) < 0.5) {
      return false
    }

    const wallLayout = wallFreeMode
      ? getWallDrawLayoutFree(
          this.canvas,
          this.#startPoints,
          endPoint,
          this.gridSize,
          this._current as WallObject | null
        )
      : getWallDrawLayout(this.canvas, this.#startPoints, endPoint, this.gridSize, this._current as WallObject | null)
    this._current.set(wallLayout)
    this._current.set({
      fill: canvasWallFill(),
      stroke: null,
      strokeWidth: 0,
      strokeDashArray: null,
      opacity: 1
    })
    this._current.setCoords?.()

    const committedWall = this._current as WallObject
    this.#wallSketch.registerSegment(this.#startPoints, endPoint, committedWall)
    this.canvas.remove(committedWall as unknown as FabricObject)

    this.#startPoints = { left: endPoint.left, top: endPoint.top }
    this._current = this.#buildWallPreviewAt(this.#startPoints)
    this.#ensureCurrentOnCanvas()
    this.drawing = true
    this.canvas.selection = false
    this.#drawSnapWall = null
    this.#overlayPointer = { left: endPoint.left, top: endPoint.top }
    this.canvas.requestRenderAll()
    return true
  }

  #finishWallSketch() {
    if (this._current) {
      this.canvas.remove(this._current)
      this._current = undefined
    }

    const committedSegments = this.#wallSketch.getCommittedSegments()
    const chainPoints = this.#wallSketch.getChainPoints()
    if (committedSegments.length > 0 && chainPoints.length >= 2) {
      const xs = chainPoints.map((point) => point.left)
      const ys = chainPoints.map((point) => point.top)
      const left = Math.min(...xs)
      const top = Math.min(...ys)
      const width = Math.max(1, Math.max(...xs) - left)
      const height = Math.max(1, Math.max(...ys) - top)
      const firstWall = committedSegments[0].wall
      const wallThickness =
        Number((firstWall as { wallThickness?: number }).wallThickness ?? 0) ||
        Math.max(1, Math.min(Number(firstWall.width ?? 0), Number(firstWall.height ?? 0)))

      for (const segment of committedSegments) {
        this.canvas.remove(segment.wall as FabricObject)
      }

      const polyWall = new CadleWall({
        left,
        top,
        width,
        height,
        originX: 'left',
        originY: 'top',
        angle: 0,
        fill: canvasWallFill(),
        stroke: null,
        strokeWidth: 0,
        opacity: 1,
        wallThickness,
        wallPoints: chainPoints.map((point) => ({ x: point.left - left, y: point.top - top }))
      })
      this.canvas.add(polyWall as unknown as FabricObject)
      ;(this.canvas as unknown as { sendToBack?: (object: FabricObject) => void }).sendToBack?.(
        polyWall as unknown as FabricObject
      )
    }

    this.#wallSketch.finish()
    this.#wallDrawFreeMode = false
    this.drawing = false
    this.canvas.selection = true
    this.#drawSnapWall = null
    this.#overlayPointer = null
    this.#scheduleMeasurementOverlayRender()
    this.canvas.requestRenderAll()
  }

  popWallChainSegment() {
    if (!this.#canvas) return
    const hadPreview = this._current && this.action === 'draw-wall'
    if (hadPreview && this._current) {
      this.canvas.remove(this._current)
      this._current = undefined
    }

    const removed = this.#wallSketch.undoLastSegment(this.#canvas)
    if (!removed) {
      this.#finishWallSketch()
      return
    }

    const start = this.#wallSketch.currentStart()
    if (!start) {
      this.#finishWallSketch()
      return
    }

    this.#startPoints = start
    this._current = this.#buildWallPreviewAt(start)
    this.#ensureCurrentOnCanvas()
    this.drawing = true
    this.canvas.selection = false
    this.#overlayPointer = { left: start.left, top: start.top }
    this.canvas.requestRenderAll()
  }

  #normalizeBindingId(value) {
    return normalizeBindingId(value)
  }

  getBindingGroups() {
    return getBindingGroups(this as unknown as BindingOverlay, this.#canvas)
  }

  getBindingGroupCatalogSymbols() {
    return getBindingGroupCatalogSymbols(this as unknown as BindingOverlay, this.#canvas)
  }

  getBindingValidationReport() {
    return getBindingValidationReport(this.getBindingGroups())
  }

  async #promptBindingForObject(object: FabricObject) {
    const bindingObject = object as FabricObject & { bindingId?: string; bindingLabel?: string }
    const defaultBindingId = this.#normalizeBindingId(String(bindingObject.bindingId ?? ''))
    const defaultLabel = String(bindingObject.bindingLabel ?? bindingObject.bindingId ?? '')
    const suggestions = this.#buildBindingIdSuggestions(defaultBindingId)
    const dialog = document.createElement('dialog')
    dialog.style.padding = '0'
    dialog.style.border = 'none'
    dialog.style.borderRadius = '18px'
    dialog.style.overflow = 'hidden'
    dialog.style.minWidth = '320px'
    dialog.innerHTML = `
      <form id="binding-form" method="dialog" style="display:flex;flex-direction:column;gap:1rem;padding:1.5rem;background:var(--md-sys-surface);color:var(--md-sys-on-surface);font:inherit;">
        <div style="display:flex;flex-direction:column;gap:0.5rem;">
          <strong>Assign binding</strong>
          <span style="color:var(--md-sys-on-surface-disabled);font-size:0.9rem;">Enter a binding ID and optional label for this object.</span>
        </div>
        <label style="display:flex;flex-direction:column;gap:0.25rem;">
          <span>Binding ID</span>
          <input id="binding-id" list="binding-suggestions" value="${defaultBindingId}" style="padding:0.75rem 0.9rem;border:1px solid var(--md-sys-outline);border-radius:12px;outline:none;font:inherit;" autocomplete="off" />
          <datalist id="binding-suggestions">
            ${suggestions.map((suggestion) => `<option value="${suggestion}"></option>`).join('')}
          </datalist>
        </label>
        <label style="display:flex;flex-direction:column;gap:0.25rem;">
          <span>Label</span>
          <input id="binding-label" value="${defaultLabel}" style="padding:0.75rem 0.9rem;border:1px solid var(--md-sys-outline);border-radius:12px;outline:none;font:inherit;" />
        </label>
        <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
          <button type="submit" value="cancel" style="padding:0.75rem 1rem;border:none;border-radius:12px;background:transparent;color:var(--md-sys-primary);cursor:pointer;">Cancel</button>
          <button type="submit" value="save" style="padding:0.75rem 1rem;border:none;border-radius:12px;background:var(--md-sys-primary);color:var(--md-sys-on-primary);cursor:pointer;">Save</button>
        </div>
      </form>
    `
    document.body.appendChild(dialog)
    return new Promise<void>((resolve) => {
      const onClose = () => {
        const form = dialog.querySelector('#binding-form') as HTMLFormElement | null
        const returnValue = dialog.returnValue
        if (returnValue === 'save' && form) {
          const bindingInput = dialog.querySelector('#binding-id') as HTMLInputElement | null
          const labelInput = dialog.querySelector('#binding-label') as HTMLInputElement | null
          const bindingId = this.#normalizeBindingId(bindingInput?.value ?? '')
          const bindingLabel = (labelInput?.value?.trim() || bindingId).trim()
          object.set({
            bindingId: bindingId || undefined,
            bindingLabel: bindingLabel || undefined
          })
          this.canvas.requestRenderAll()
        }

        dialog.removeEventListener('close', onClose)
        dialog.remove()
        resolve()
      }

      dialog.addEventListener('close', onClose)

      dialog.showModal()
      const input = dialog.querySelector('#binding-id') as HTMLInputElement | null
      input?.focus()
      input?.select()
    })
  }

  #isBreakerSymbol(object: FabricObject) {
    return ProtectionSymbolClassifier.isProtectionSymbol(object)
  }

  #collectNestedFabricObjects(object: FabricObject) {
    const group = object as FabricObject & {
      _objects?: FabricObject[]
      objects?: FabricObject[]
    }
    const nested: FabricObject[] = []
    if (Array.isArray(group._objects)) nested.push(...group._objects)
    if (Array.isArray(group.objects)) nested.push(...group.objects)
    return nested
  }

  #applyBreakerVisualState(object: FabricObject, amperage: number, poles: number, curve: string) {
    const textLikeObject = object as FabricObject & {
      text?: string
      set: (key: string, value: string) => void
    }
    const nested = this.#collectNestedFabricObjects(object)
    let replacedAmperage = false
    let replacedPoles = false
    let replacedCurve = false

    for (const child of nested) {
      this.#applyBreakerVisualState(child, amperage, poles, curve)
      const typedChild = child as FabricObject & {
        text?: string
        set: (key: string, value: string) => void
      }
      const childText = String(typedChild.text ?? '').trim()
      if (!childText) continue
      const normalized = childText.toLowerCase()

      if (!replacedPoles && (normalized === 'np' || normalized.endsWith('p'))) {
        typedChild.set('text', `${poles}P`)
        replacedPoles = true
        continue
      }

      if (!replacedAmperage && /\d+\s*a/i.test(normalized)) {
        typedChild.set('text', `${amperage}A`)
        replacedAmperage = true
        continue
      }

      if (!replacedCurve && (normalized === 'n' || normalized === 'b' || normalized === 'c' || normalized === 'd')) {
        typedChild.set('text', curve)
        replacedCurve = true
      }
    }

    if (!nested.length && typeof textLikeObject.text === 'string') {
      const normalized = textLikeObject.text.trim().toLowerCase()
      if (normalized === 'np' || normalized.endsWith('p')) {
        textLikeObject.set('text', `${poles}P`)
      } else if (/\d+\s*a/i.test(normalized)) {
        textLikeObject.set('text', `${amperage}A`)
      } else if (normalized === 'n' || normalized === 'b' || normalized === 'c' || normalized === 'd') {
        textLikeObject.set('text', curve)
      }
    }
  }

  async #promptBreakerForObject(object: FabricObject) {
    const breakerObject = object as FabricObject & {
      breakerAmperageA?: number
      breakerShortCircuitKA?: number
      breakerCurve?: string
      breakerPoles?: number
      breakerLabel?: string
      bindingGroupBreakerAmperage?: number
    }
    const defaultAmperage = Number(breakerObject.breakerAmperageA ?? breakerObject.bindingGroupBreakerAmperage ?? 16)
    const defaultShortCircuit = Number(breakerObject.breakerShortCircuitKA ?? 6)
    const defaultCurve = String(breakerObject.breakerCurve ?? 'C').toUpperCase()
    const defaultPoles = Number(breakerObject.breakerPoles ?? 2)
    const defaultLabel = String(
      breakerObject.breakerLabel ?? `${defaultCurve}${defaultAmperage}A / ${defaultShortCircuit}kA`
    ).trim()

    const dialog = document.createElement('dialog')
    dialog.style.padding = '0'
    dialog.style.border = 'none'
    dialog.style.borderRadius = '18px'
    dialog.style.overflow = 'hidden'
    dialog.style.minWidth = '360px'
    dialog.innerHTML = `
      <form id="breaker-form" method="dialog" style="display:flex;flex-direction:column;gap:1rem;padding:1.5rem;background:var(--md-sys-surface);color:var(--md-sys-on-surface);font:inherit;">
        <div style="display:flex;flex-direction:column;gap:0.5rem;">
          <strong>Automaat instellingen</strong>
          <span style="color:var(--md-sys-on-surface-disabled);font-size:0.9rem;">Vul nominale stroom, kortsluitstroom en karakteristiek in.</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0.75rem;">
          <label style="display:flex;flex-direction:column;gap:0.25rem;">
            <span>Stroom (A)</span>
            <input id="breaker-amperage" type="number" min="1" step="1" value="${Number.isFinite(defaultAmperage) ? defaultAmperage : 16}" style="padding:0.75rem 0.9rem;border:1px solid var(--md-sys-outline);border-radius:12px;outline:none;font:inherit;" />
          </label>
          <label style="display:flex;flex-direction:column;gap:0.25rem;">
            <span>Kortsluitstroom (kA)</span>
            <input id="breaker-short-circuit" type="number" min="1" step="0.5" value="${Number.isFinite(defaultShortCircuit) ? defaultShortCircuit : 6}" style="padding:0.75rem 0.9rem;border:1px solid var(--md-sys-outline);border-radius:12px;outline:none;font:inherit;" />
          </label>
          <label style="display:flex;flex-direction:column;gap:0.25rem;">
            <span>Curve</span>
            <input id="breaker-curve" list="breaker-curve-options" value="${defaultCurve}" style="padding:0.75rem 0.9rem;border:1px solid var(--md-sys-outline);border-radius:12px;outline:none;font:inherit;" />
            <datalist id="breaker-curve-options">
              <option value="B"></option>
              <option value="C"></option>
              <option value="D"></option>
              <option value="K"></option>
              <option value="Z"></option>
            </datalist>
          </label>
          <label style="display:flex;flex-direction:column;gap:0.25rem;">
            <span>Polen</span>
            <input id="breaker-poles" type="number" min="1" max="4" step="1" value="${Number.isFinite(defaultPoles) ? defaultPoles : 2}" style="padding:0.75rem 0.9rem;border:1px solid var(--md-sys-outline);border-radius:12px;outline:none;font:inherit;" />
          </label>
        </div>
        <label style="display:flex;flex-direction:column;gap:0.25rem;">
          <span>Label</span>
          <input id="breaker-label" value="${defaultLabel}" style="padding:0.75rem 0.9rem;border:1px solid var(--md-sys-outline);border-radius:12px;outline:none;font:inherit;" />
        </label>
        <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
          <button type="submit" value="cancel" style="padding:0.75rem 1rem;border:none;border-radius:12px;background:transparent;color:var(--md-sys-primary);cursor:pointer;">Cancel</button>
          <button type="submit" value="save" style="padding:0.75rem 1rem;border:none;border-radius:12px;background:var(--md-sys-primary);color:var(--md-sys-on-primary);cursor:pointer;">Save</button>
        </div>
      </form>
    `
    document.body.appendChild(dialog)
    return new Promise<void>((resolve) => {
      const onClose = () => {
        const returnValue = dialog.returnValue
        if (returnValue === 'save') {
          const amperageInput = dialog.querySelector('#breaker-amperage') as HTMLInputElement | null
          const shortCircuitInput = dialog.querySelector('#breaker-short-circuit') as HTMLInputElement | null
          const curveInput = dialog.querySelector('#breaker-curve') as HTMLInputElement | null
          const polesInput = dialog.querySelector('#breaker-poles') as HTMLInputElement | null
          const labelInput = dialog.querySelector('#breaker-label') as HTMLInputElement | null

          const amperageValue = Number(amperageInput?.value ?? defaultAmperage)
          const shortCircuitValue = Number(shortCircuitInput?.value ?? defaultShortCircuit)
          const curveValue = String(curveInput?.value ?? defaultCurve)
          const polesValue = Number(polesInput?.value ?? defaultPoles)

          const amperage = Math.max(1, Math.round(Number.isFinite(amperageValue) ? amperageValue : 16))
          const shortCircuit = Math.max(1, Number.isFinite(shortCircuitValue) ? shortCircuitValue : 6)
          const curve = curveValue.trim().toUpperCase().slice(0, 2) || 'C'
          const poles = Math.max(1, Math.min(4, Math.round(Number.isFinite(polesValue) ? polesValue : 2)))
          const label = String(labelInput?.value ?? '').trim() || `${curve}${amperage}A / ${shortCircuit}kA`

          object.set({
            breakerAmperageA: amperage,
            breakerShortCircuitKA: shortCircuit,
            breakerCurve: curve,
            breakerPoles: poles,
            breakerLabel: label,
            bindingGroupBreakerAmperage: amperage
          })
          this.#applyBreakerVisualState(object, amperage, poles, curve)
          this.canvas.requestRenderAll()
        }

        dialog.removeEventListener('close', onClose)
        dialog.remove()
        resolve()
      }

      dialog.addEventListener('close', onClose)
      dialog.showModal()
      const input = dialog.querySelector('#breaker-amperage') as HTMLInputElement | null
      input?.focus()
      input?.select()
    })
  }

  #buildBindingIdSuggestions(currentId: string) {
    const groups = this.getBindingGroups()
    const existing = new Set(groups.map((group) => this.#normalizeBindingId(group.bindingId)))
    const suggestions: string[] = []
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      for (let number = 1; number <= 12; number += 1) {
        const candidate = `${letter}${number}`
        if (!existing.has(candidate)) {
          suggestions.push(candidate)
          if (suggestions.length >= 8) return suggestions
        }
      }
    }

    if (currentId && !suggestions.includes(currentId)) {
      suggestions.unshift(currentId)
    }
    return suggestions
  }

  #isLineLikeAction(action: string | null | undefined) {
    return action === 'draw-line' || action === 'draw-cable'
  }

  #lineLengthMeters(line: CableLineObject) {
    const x1 = Number(line.x1 ?? 0)
    const y1 = Number(line.y1 ?? 0)
    const x2 = Number(line.x2 ?? 0)
    const y2 = Number(line.y2 ?? 0)
    const pixels = Math.hypot(x2 - x1, y2 - y1)
    const meters = pixels / 50
    return Math.round(meters * 100) / 100
  }

  #persistCableLengthForBinding(bindingId: string, lengthMeters: number) {
    for (const object of this.#canvas.getObjects() as CableLineObject[]) {
      if (this.#normalizeBindingId(String(object.bindingId ?? '')) !== bindingId) continue
      object.set({ bindingGroupCableLengthMeters: lengthMeters })
    }

    this.#scheduleBindingLookupRefresh()
  }

  #promptCableBindingAndPersist(lineObject: CableLineObject) {
    const measuredLength = this.#lineLengthMeters(lineObject)
    const fallbackLength = measuredLength > 0 ? measuredLength : 1
    const suggestedLength = String(lineObject.bindingGroupCableLengthMeters ?? fallbackLength)
    const lengthInput = globalThis.prompt('Cable length in meters', suggestedLength)
    if (lengthInput === null) return
    const parsedLength = Number(lengthInput)
    const lengthMeters = Number.isFinite(parsedLength) && parsedLength > 0 ? parsedLength : fallbackLength

    const defaultBindingId = this.#normalizeBindingId(String(lineObject.bindingId ?? ''))
    const input = globalThis.prompt('Binding ID for this cable route (e.g. A1)', defaultBindingId)
    if (input === null) return

    const bindingId = this.#normalizeBindingId(input)
    lineObject.set({
      bindingId: bindingId || undefined,
      bindingRole: 'neutral',
      bindingGroupCableLengthMeters: lengthMeters,
      oneLineEligible: false,
      situationElementType: 'cable-route'
    })

    if (bindingId) {
      this.#persistCableLengthForBinding(bindingId, lengthMeters)
    } else {
      this.#scheduleBindingLookupRefresh()
    }

    this.#canvas.requestRenderAll()
  }

  buildAutoOneWireSchema() {
    return buildAutoOneWireSchema(this.getBindingValidationReport(), this.#canvas, this.gridSize)
  }

  getHistoryEntries() {
    return this.#historyEntries.map(({ id, label, timestamp }) => ({ id, label, timestamp }))
  }

  async restoreHistoryEntry(id: string) {
    const entry = this.#historyEntries.find((item) => item.id === id)
    if (!entry) return
    await this.fromJSON(entry.json as { objects?: JsonValue[]; version: string })
  }

  refreshLookup(canvas: Canvas) {
    if (canvas === this.#canvas) {
      this.#refreshBindingLookup()
    }
  }

  getLookup() {
    return this.#bindingLookup
  }

  #recordHistorySnapshot(label = 'Change') {
    if (!this.#historyRecordingEnabled || !this.#canvas) return

    requestAnimationFrame(() => {
      try {
        const snapshot = this.toJSON()
        if (!snapshot || !Array.isArray((snapshot as { objects?: JsonValue[] }).objects)) return

        this.#historySnapshotCounter += 1
        this.#historyEntries.unshift({
          id: crypto.randomUUID(),
          label: `${label} #${this.#historySnapshotCounter}`,
          timestamp: Date.now(),
          json: snapshot
        })
        this.#historyEntries = this.#historyEntries.slice(0, 30)
        this.dispatchEvent(
          new CustomEvent('canvas-history-updated', {
            bubbles: true,
            composed: true,
            detail: { entries: this.getHistoryEntries() }
          })
        )
      } catch (error) {
        console.warn('Unable to record history snapshot', error)
      }
    })
  }

  getBoundOneLineCatalogSymbols() {
    return getBoundOneLineCatalogSymbols(this.#bindingLookup)
  }

  #refreshBindingLookup() {
    this.#bindingLookup.clear()

    for (const obj of this.#canvas.getObjects() as DrawFabricObject[]) {
      const bindingId = this.#normalizeBindingId(obj.bindingId)
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

  #formatAngleLabel(angleDeg: number) {
    const normalized = ((angleDeg % 360) + 360) % 360
    const rounded = Math.round(normalized * 10) / 10
    return Number.isInteger(rounded) ? `${rounded} deg` : `${rounded.toFixed(1)} deg`
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

  #scheduleMeasurementOverlayRender() {
    if (this.#measurementOverlayScheduled) return
    this.#measurementOverlayScheduled = true

    requestAnimationFrame(() => {
      this.#measurementOverlayScheduled = false
      this.#renderOverlay()
    })
  }

  #renderOverlay() {
    const ctx = getMeasurementOverlayContext(this.#canvas)
    if (!ctx) return

    this.#bindingOverlayRenderer.drawLabels(ctx, this.#canvas)

    this.#drawWallMarkers(ctx)

    this.#drawWallSelectedSegment(ctx)

    this.#drawWallNodes(ctx)

    this.#drawWallSnapGhost(ctx, this.#overlayPointer)

    if (this.#openingHoverGhost.hasGhost()) {
      this.#openingHoverGhost.draw(ctx, (point) => sceneToViewport(this.#canvas, point))
    }

    this.#drawWallPreviewDimensions(ctx, this.#overlayPointer)
    this.#drawWallDrawHint(ctx, this.#overlayPointer)

    if (this.showMeasurements) {
      renderArchitecturalMeasurements(this.#canvas, this.showMeasurements, ctx)
    }
  }

  #drawWallDrawHint(ctx: CanvasRenderingContext2D, currentPoints: LeftTop | null) {
    if (this.action !== 'draw-wall' || !this.drawing || !currentPoints) return

    const lines = []
    if (this.freeDraw) {
      lines.push('Free wall drawing')
    } else {
      lines.push(this.#wallDrawFreeMode ? 'Diagonal: on (Shift)' : 'Hold Shift for diagonal')
    }

    lines.push('Click or drag to place a wall segment')
    lines.push('Press Enter to finish')

    const anchor = sceneToViewport(this.#canvas, { x: currentPoints.left, y: currentPoints.top })
    const x = anchor.x + 16
    const y = anchor.y + 30

    ctx.save()
    ctx.font = '600 11px "IBM Plex Sans", "Segoe UI", sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'

    const textWidth = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0)
    const padX = 8
    const lineHeight = 18
    const boxWidth = textWidth + padX * 2
    const boxHeight = lines.length * lineHeight + 10
    const boxX = x
    const boxY = y - boxHeight / 2

    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)'
    ctx.strokeStyle = this.#wallDrawFreeMode ? 'rgba(41, 98, 255, 0.55)' : 'rgba(0, 0, 0, 0.2)'
    ctx.lineWidth = 1
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight)
    ctx.strokeRect(boxX, boxY, boxWidth, boxHeight)

    ctx.fillStyle = this.#wallDrawFreeMode ? '#1a47c7' : '#3d2f25'
    for (let index = 0; index < lines.length; index += 1) {
      ctx.fillText(lines[index], boxX + padX, y + index * lineHeight - (lines.length - 1) * 6)
    }

    ctx.restore()
  }

  #drawWallSelectedSegment(ctx: CanvasRenderingContext2D) {
    if (!this.#hasSelectedWall()) return

    const activeObjects = this.#canvas.getActiveObjects?.() ?? []
    for (const object of activeObjects) {
      if (!isWallObject(object as WallObject)) continue
      type SegmentWall = WallObject & {
        wallPoints?: { x: number; y: number }[]
        wallSelectedSegmentStartIndex?: number
      }
      const wall = object as SegmentWall
      const wallPoints = Array.isArray(wall.wallPoints) ? wall.wallPoints : null
      const segmentStart = wall.wallSelectedSegmentStartIndex
      if (!wallPoints || wallPoints.length < 2 || !Number.isInteger(segmentStart)) continue
      if (segmentStart < 0 || segmentStart >= wallPoints.length - 1) continue

      const wallLeft = Number(wall.left ?? 0)
      const wallTop = Number(wall.top ?? 0)
      const pa = { x: wallLeft + wallPoints[segmentStart].x, y: wallTop + wallPoints[segmentStart].y }
      const pb = { x: wallLeft + wallPoints[segmentStart + 1].x, y: wallTop + wallPoints[segmentStart + 1].y }
      const a = sceneToViewport(this.#canvas, pa)
      const b = sceneToViewport(this.#canvas, pb)

      ctx.save()
      ctx.strokeStyle = 'rgba(220, 50, 50, 0.85)'
      ctx.lineWidth = 4
      ctx.lineCap = 'round'
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      ctx.setLineDash([])

      // Endpoint dots to clearly show A and B
      for (const point of [a, b]) {
        ctx.beginPath()
        ctx.arc(point.x, point.y, 5, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(220, 50, 50, 0.85)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = 1.5
        ctx.setLineDash([])
        ctx.stroke()
      }

      // Label in the middle of the segment
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const label = 'Delete segment'
      ctx.font = '600 11px "IBM Plex Sans", "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const tw = ctx.measureText(label).width
      const padX = 6
      const padY = 4
      const bw = tw + padX * 2
      const bh = 18
      ctx.fillStyle = 'rgba(220, 50, 50, 0.9)'
      ctx.fillRect(mx - bw / 2, my - bh / 2 - 14, bw, bh)
      ctx.fillStyle = '#fff'
      ctx.fillText(label, mx, my - 14 + padY)
      ctx.restore()
    }
  }

  #drawWallSnapGhost(ctx: CanvasRenderingContext2D, currentPoints: LeftTop | null) {
    if (!this.drawing || this.action !== 'draw-wall' || !currentPoints) return

    const snap = snapWallEndpoint(
      this.canvas,
      currentPoints,
      this._current as WallObject | null,
      this.gridSize,
      true,
      this.#wallDrawFreeMode
    )
    if (!snap) return

    const point = sceneToViewport(this.#canvas, { x: snap.left, y: snap.top })
    const radius = snap.type === 'midpoint' ? 6 : 5
    const inkColor = canvasInk() || '#000'
    ctx.save()
    ctx.globalAlpha = 0.18
    ctx.fillStyle = inkColor
    ctx.strokeStyle = inkColor
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    if (snap.type === 'midpoint') {
      ctx.beginPath()
      ctx.globalAlpha = 0.45
      ctx.moveTo(point.x - radius * 0.8, point.y)
      ctx.lineTo(point.x + radius * 0.8, point.y)
      ctx.moveTo(point.x, point.y - radius * 0.8)
      ctx.lineTo(point.x, point.y + radius * 0.8)
      ctx.stroke()
    }

    ctx.restore()

    const label =
      snap.type === 'midpoint'
        ? 'midpoint'
        : snap.type === 'endpoint' || snap.type === 'preview-endpoint'
          ? 'endpoint'
          : 'axis'
    const labelPadding = 4
    ctx.save()
    ctx.font = '600 11px "IBM Plex Sans", "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    const textWidth = ctx.measureText(label).width
    const boxWidth = textWidth + labelPadding * 2
    const boxHeight = 18
    const labelX = point.x
    const labelY = point.y - radius - 8

    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.fillRect(labelX - boxWidth / 2, labelY - boxHeight, boxWidth, boxHeight)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)'
    ctx.lineWidth = 1
    ctx.strokeRect(labelX - boxWidth / 2, labelY - boxHeight, boxWidth, boxHeight)
    ctx.fillStyle = inkColor
    ctx.fillText(label, labelX, labelY - 4)
    ctx.restore()
  }

  #drawWallPreviewDimensions(ctx: CanvasRenderingContext2D, currentPoints: LeftTop | null) {
    if (!this.drawing || this.action !== 'draw-wall' || !currentPoints) return

    const wallLayout = this.#wallDrawFreeMode
      ? getWallDrawLayoutFree(
          this.canvas,
          this.#startPoints,
          currentPoints,
          this.gridSize,
          this._current as WallObject | null
        )
      : getWallDrawLayout(
          this.canvas,
          this.#startPoints,
          currentPoints,
          this.gridSize,
          this._current as WallObject | null
        )
    if (!wallLayout) return

    const label = this.#formatDimensionLabel(
      wallLayout.width >= wallLayout.height ? wallLayout.width : wallLayout.height
    )
    const angleLabel = this.#formatAngleLabel(
      typeof wallLayout.angle === 'number' ? wallLayout.angle : wallLayout.width >= wallLayout.height ? 0 : 90
    )
    const thicknessLabel = this.#formatDimensionLabel(Math.min(wallLayout.width, wallLayout.height))
    const infoLabel = `${angleLabel} • t ${thicknessLabel}`
    const center = {
      x: wallLayout.left + wallLayout.width / 2,
      y: wallLayout.top + wallLayout.height / 2
    }
    const screenCenter = sceneToViewport(this.#canvas, center)

    ctx.save()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)'
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
    ctx.lineWidth = 1

    if (wallLayout.width >= wallLayout.height) {
      const start = sceneToViewport(this.#canvas, { x: wallLayout.left, y: center.y })
      const end = sceneToViewport(this.#canvas, { x: wallLayout.left + wallLayout.width, y: center.y })
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(start.x, start.y - 10)
      ctx.lineTo(start.x, start.y + 10)
      ctx.moveTo(end.x, end.y - 10)
      ctx.lineTo(end.x, end.y + 10)
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()
      ctx.setLineDash([])
      this.#drawDimensionLabel(ctx, screenCenter.x, screenCenter.y - 12, label)
      this.#drawDimensionLabel(ctx, screenCenter.x, screenCenter.y + 14, infoLabel)
    } else {
      const start = sceneToViewport(this.#canvas, { x: center.x, y: wallLayout.top })
      const end = sceneToViewport(this.#canvas, { x: center.x, y: wallLayout.top + wallLayout.height })
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(start.x - 10, start.y)
      ctx.lineTo(start.x + 10, start.y)
      ctx.moveTo(end.x - 10, end.y)
      ctx.lineTo(end.x + 10, end.y)
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()
      ctx.setLineDash([])
      this.#drawDimensionLabel(ctx, screenCenter.x + 12, screenCenter.y, label, true)
      this.#drawDimensionLabel(ctx, screenCenter.x - 14, screenCenter.y, infoLabel, true)
    }

    ctx.restore()
  }

  #drawWallMarkers(ctx: CanvasRenderingContext2D) {
    if (this.action !== 'draw-wall') return

    const walls = this.#canvas.getObjects().filter((obj): obj is WallObject => isWallObject(obj))
    const inkColor = canvasInk() || '#000'
    ctx.save()
    ctx.font = '600 11px "IBM Plex Sans", "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.lineWidth = 1.5

    for (const wall of walls) {
      const endpoints = getWallEndpoints(wall)
      const midpoint = {
        x: (endpoints[0].x + endpoints[1].x) / 2,
        y: (endpoints[0].y + endpoints[1].y) / 2
      }

      // Endpoints are drawn by #drawWallNodes (clustered, colored, draggable);
      // here we only mark the unique midpoint snap target to avoid duplicates.
      const midPoint = sceneToViewport(this.#canvas, midpoint)
      ctx.save()
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
      ctx.strokeStyle = inkColor
      ctx.beginPath()
      ctx.arc(midPoint.x, midPoint.y, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = inkColor
      ctx.fillText('mid', midPoint.x, midPoint.y - 6)
      ctx.restore()
    }

    ctx.restore()
  }

  // Collect the shared corner vertices of every wall on the canvas. Nodes are
  // derived (not persisted): a corner is simply where wall endpoints coincide.
  #collectWallNodesForCanvas(): WallNode[] {
    const walls = this.#canvas.getObjects().filter((object): object is WallObject => isWallObject(object))
    if (walls.length === 0) return []
    return collectWallNodes(walls, 4)
  }

  #hasSelectedWall(): boolean {
    if (!this.#canvas) return false
    const activeObjects = this.#canvas.getActiveObjects?.() ?? []
    return activeObjects.some((object) => isWallObject(object as WallObject))
  }

  #updateSelectionControls() {
    if (!this.#canvas) return
    const resizeMode = this.action === 'resize'
    const activeObjects = this.#canvas.getActiveObjects?.() ?? []
    for (const object of activeObjects) {
      if (!object || typeof object.set !== 'function') continue
      object.set({ hasControls: resizeMode })
      object.setCoords?.()
    }

    if (activeObjects.length) {
      this.canvas.requestRenderAll()
    }
  }

  #onShellAction = (action: string) => {
    this.#updateSelectionControls()
    if (action === 'draw-wall' || this.#hasSelectedWall() || this.moving) {
      this.#scheduleMeasurementOverlayRender()
    }
  }

  // Draw the draggable corner handles while the wall tool is active. Joined
  // vertices use the brand accent so the user can tell which corners move both
  // walls.
  #drawWallNodes(ctx: CanvasRenderingContext2D) {
    const showNodes =
      this.action === 'draw-wall' || this.moving || this.#hasSelectedWall() || this.#selectedWallNode !== null
    if (!showNodes) return

    const nodes = this.#collectWallNodesForCanvas()
    if (nodes.length === 0) return

    const accent = canvasInk() || '#000'
    const selectedNode = this.#selectedWallNode
    ctx.save()
    ctx.lineWidth = 1.5

    for (const node of nodes) {
      const point = sceneToViewport(this.#canvas, { x: node.x, y: node.y })
      const isJoined = wallsForNode(node).length >= 2
      const isSelected = selectedNode !== null && Math.hypot(node.x - selectedNode.x, node.y - selectedNode.y) < 2
      const radius = isSelected ? 6 : isJoined ? 5 : 4

      ctx.beginPath()
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = isSelected
        ? 'rgba(220, 50, 50, 0.95)'
        : isJoined
          ? 'rgba(168, 84, 39, 0.95)'
          : 'rgba(255, 255, 255, 0.92)'
      ctx.strokeStyle = isSelected ? 'rgba(255,255,255,0.9)' : isJoined ? 'rgba(255, 255, 255, 0.9)' : accent
      ctx.fill()
      ctx.stroke()
    }

    // Ring the vertex the dragged corner will weld onto, as drop feedback.
    const weld = this.#wallNodeWeldActive
    if (weld) {
      const weldPoint = sceneToViewport(this.#canvas, { x: weld.x, y: weld.y })
      ctx.beginPath()
      ctx.arc(weldPoint.x, weldPoint.y, 9, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(168, 84, 39, 0.95)'
      ctx.lineWidth = 2
      ctx.stroke()
    }

    ctx.restore()
  }

  // Grab a corner node on pointer-down (capture phase) before Fabric selects
  // the wall. Active while the wall tool is selected, or when a wall is selected
  // or currently moving. In-progress wall sketches are still ignored.
  #onWallNodePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.drawing || !this.#canvas) return
    if (this.action === 'draw-wall') return
    const activeWallSelected = this.#hasSelectedWall()
    if (!activeWallSelected && !this.moving && this.#selectedWallNode === null) return

    const scenePoint = this.#canvas.getScenePoint(event)
    const point = { x: Number(scenePoint.x ?? 0), y: Number(scenePoint.y ?? 0) }
    const nodes = this.#collectWallNodesForCanvas()
    if (nodes.length === 0) return

    const zoom = typeof this.#canvas.getZoom === 'function' ? this.#canvas.getZoom() : 1
    const grabTolerance = Math.max(8, 12 / Math.max(zoom, 0.01))
    const node = findWallNodeAt(nodes, point, grabTolerance)
    if (!node) {
      const wallSnap = findNearestWall(
        this.#canvas,
        { left: point.x, top: point.y },
        Math.max(32, 24 / Math.max(zoom, 0.01))
      )
      if (!wallSnap) {
        this.#selectedWallNode = null
        this.#scheduleMeasurementOverlayRender()
      }
      return
    }

    if (activeWallSelected && this.action !== 'draw-wall' && !this.moving) {
      const selectedWalls = new Set(
        (this.#canvas.getActiveObjects?.() ?? []).filter((object) => isWallObject(object as WallObject)) as WallObject[]
      )
      if (!node.refs.some((ref) => selectedWalls.has(ref.wall))) return
    }

    const wallSnap = findNearestWall(
      this.#canvas,
      { left: point.x, top: point.y },
      Math.max(32, 24 / Math.max(zoom, 0.01))
    )
    if (wallSnap) {
      const wallNodes = nodes.filter((candidate) => candidate.refs.some((ref) => ref.wall === wallSnap.wall))
      const selected = findWallNodeAt(wallNodes, point, Math.max(64, 48 / Math.max(zoom, 0.01)))
      if (selected) {
        this.#selectedWallNode = selected
      }

      this.#canvas.setActiveObject?.(wallSnap.wall as unknown as FabricObject)
      this.#scheduleMeasurementOverlayRender()
    }

    event.preventDefault()
    event.stopImmediatePropagation()

    this.#draggingWallNode = node
    this.#wallNodeDragMoved = false
    // Vertices this corner can weld onto: every other node that does not share
    // a wall with it (welding to a shared wall would collapse that wall).
    const draggedWalls = new Set(node.refs.map((ref) => ref.wall))
    this.#wallNodeWeldTargets = nodes.filter((candidate) => !candidate.refs.some((ref) => draggedWalls.has(ref.wall)))
    this.#wallNodeWeldActive = null
    this.canvas.selection = false
    this.#canvas.requestRenderAll()

    window.addEventListener('pointermove', this.#onWallNodePointerMove, true)
    window.addEventListener('pointerup', this.#onWallNodePointerUp, true)
  }

  // Move every wall endpoint that meets at the grabbed node to the same point,
  // so connected walls redraw together and the corner stays a perfect V.
  #onWallNodePointerMove = (event: PointerEvent): void => {
    const node = this.#draggingWallNode
    if (!node || !this.#canvas) return

    const scenePoint = this.#canvas.getScenePoint(event)
    const raw = { left: Number(scenePoint.x ?? 0), top: Number(scenePoint.y ?? 0) }
    const freeMode = this.freeDraw || event.shiftKey

    // Prefer welding onto a nearby vertex; it overrides grid snapping so two
    // corners merge into a shared node when one is dropped onto the other.
    const zoom = typeof this.#canvas.getZoom === 'function' ? this.#canvas.getZoom() : 1
    const weldTolerance = Math.max(8, 12 / Math.max(zoom, 0.01))
    const weld = findWallNodeAt(this.#wallNodeWeldTargets, { x: raw.left, y: raw.top }, weldTolerance)
    this.#wallNodeWeldActive = weld

    const target = weld ? { left: weld.x, top: weld.y } : freeMode ? raw : this.snapToGrid(raw)
    this.#wallNodeDragMoved = true

    for (const ref of node.refs) {
      applyWallEndpoint(ref.wall, ref.endIndex, { x: target.left, y: target.top }, this.gridSize)
    }

    node.x = target.left
    node.y = target.top

    for (const wall of wallsForNode(node)) {
      this.#reflowAnchoredOpeningsForWall(wall)
    }

    this.#canvas.requestRenderAll()
    this.#scheduleMeasurementOverlayRender()
  }

  // Finish a corner drag: commit coords, refresh derived state and record a
  // single history entry for the whole gesture.
  #onWallNodePointerUp = (): void => {
    window.removeEventListener('pointermove', this.#onWallNodePointerMove, true)
    window.removeEventListener('pointerup', this.#onWallNodePointerUp, true)
    this.#draggingWallNode = null
    this.#wallNodeDragMoved = false
    this.#wallNodeWeldActive = null
  }

  firstRender() {
    // Start with default A4 landscape dimensions
    const defaultWidth = this.#a4LandscapeWidth
    const defaultHeight = this.#a4LandscapeHeight

    this.#width = defaultWidth
    this.#height = defaultHeight

    const canvasElement = this.shadowRoot?.querySelector('canvas') as HTMLCanvasElement | null
    if (!canvasElement) return

    this.#canvas = new Canvas(canvasElement, {
      selection: true,
      selectionKey: 'shiftKey',
      evented: true,
      width: defaultWidth,
      height: defaultHeight,
      preserveObjectStacking: true
    })
    ;(this.#canvas as unknown as { history: HistoryAction[] }).history = []

    this.gridSize = state.gridSize

    // Set initial zoom to 1 (100%)
    this.zoomLevel = 1
    this.#canvas.setZoom(1)
    this.#zoomController = new ZoomController({
      getCanvas: () => this.#canvas,
      getWidth: () => this.#width,
      getHeight: () => this.#height,
      onChange: (zoom) => {
        this.zoomLevel = zoom
        this.requestRender()
      }
    })
    this.#zoomController.loadInitial()

    // Resize canvas to fit container after layout is complete
    // Use setTimeout to ensure layout is fully settled
    setTimeout(() => {
      this.resizeCanvas()
    }, 100)

    this.#canvas.on('object:moving', (options) => {
      this.moving = true
      const target = options.target as FabricObject | null
      if (!target) return

      if (isWallObject(target as WallObject)) {
        this.#reflowAnchoredOpeningsForWall(target as WallObject)
      }

      if (isOpeningObject(target)) {
        const centerPoint = {
          left: Number(target.left ?? 0) + Math.abs(Number(target.width ?? 0) * Number(target.scaleX ?? 1)) / 2,
          top: Number(target.top ?? 0) + Math.abs(Number(target.height ?? 0) * Number(target.scaleY ?? 1)) / 2
        }
        const wallSnap = findNearestWall(this.#canvas, centerPoint, Math.max(24, this.gridSize * 2))

        if (wallSnap) {
          snapOpeningToWall(target, centerPoint, wallSnap, this.gridSize, {
            freeDraw: this.freeDraw,
            snap: (value: number) => this.snap(value)
          })
          if (wallSnap.wall) this.#writeOpeningAnchor(target as OpeningSnapTarget, wallSnap.wall)
          return
        }
      }

      const snapped = this.snapToGrid({ left: target.left, top: target.top })
      if (Number(target.left ?? 0) === snapped.left && Number(target.top ?? 0) === snapped.top) return

      target.set({ left: snapped.left, top: snapped.top })
      this.#lastMoveSnap.set(target, snapped)
    })

    this.#canvas.on('after:render', () => {
      this.moving = false
      this.#updateGridBackground()
      this.#scheduleMeasurementOverlayRender()
    })

    this.#canvas.on('object:scaling', (options) => {
      const target = options.target as FabricObject | null
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

      const originX = String(target.originX ?? 'left') as 'left' | 'center' | 'right'
      const originY = String(target.originY ?? 'top') as 'top' | 'center' | 'bottom'
      const originPoint = target.getPointByOrigin(originX, originY)

      target.set({ scaleX: nextScaleX, scaleY: nextScaleY })
      target.setPositionByOrigin(originPoint, originX, originY)
      target.setCoords()
    })

    this.#canvas.on('mouse:up', () => {
      this.#lastMoveSnap = new WeakMap()
      for (const obj of this.#canvas.getObjects()) {
        if (!obj || typeof obj.setCoords !== 'function') continue
        obj.setCoords()
      }
    })

    this.#canvas.on('object:added', () => {
      this.#scheduleBindingLookupRefresh()
      this.#recordHistorySnapshot('Object added')
    })
    this.#canvas.on('object:removed', () => {
      this.#scheduleBindingLookupRefresh()
      this.#recordHistorySnapshot('Object removed')
    })
    this.#canvas.on('object:modified', (options) => {
      const target = options?.target as FabricObject | null
      if (target && isWallObject(target as WallObject)) {
        this.#reflowAnchoredOpeningsForWall(target as WallObject)
      }

      this.#scheduleBindingLookupRefresh()
      this.#recordHistorySnapshot('Object modified')
    })

    this.#canvas.on('selection:created', () => {
      this.#updateSelectionControls()
      this.#scheduleMeasurementOverlayRender()
    })
    this.#canvas.on('selection:updated', () => {
      this.#updateSelectionControls()
      this.#scheduleMeasurementOverlayRender()
    })
    this.#canvas.on('selection:cleared', () => {
      this.#updateSelectionControls()
      // Clear any lingering segment selection so the highlight disappears
      // when the wall is deselected.
      for (const obj of this.#canvas.getObjects()) {
        const wall = obj as WallObject & { wallSelectedSegmentStartIndex?: number }
        if (isWallObject(wall)) wall.wallSelectedSegmentStartIndex = undefined
      }

      this.#scheduleMeasurementOverlayRender()
    })

    pubsub.subscribe('shell.action', this.#onShellAction)

    this.#canvas.on('mouse:down', this._mousedown.bind(this))
    this.#canvas.on('mouse:up', this._mouseup.bind(this))
    this.addEventListener('mouseenter', this._mouseenter.bind(this))
    this.addEventListener('mouseleave', this._mouseleave.bind(this))
    this.#canvas.on('mouse:dblclick', this._dblclick.bind(this))
    // this.shadowRoot.addEventListener('mousemove', this._mousemove.bind(this))
    this.#canvas.on('mouse:move', this._mousemove.bind(this))
    this.shadowRoot.addEventListener('drop', this._drop.bind(this))
    window.addEventListener('keydown', this.#keydownListener)

    this.addEventListener('contextmenu', this.#contextmenu)
    const upperCanvas = (this.#canvas as Canvas & { upperCanvasEl?: HTMLCanvasElement }).upperCanvasEl
    upperCanvas?.addEventListener('contextmenu', this.#contextmenu as EventListener)
    this.contextMenu?.addEventListener('selected', this.#onContextMenuSelected as EventListener)

    // Capture-phase grab of wall corner nodes so editing a shared vertex wins
    // over Fabric's own selection/drag of the wall underneath the cursor.
    const nodeGrabTarget = this.canvasContainer ?? upperCanvas
    nodeGrabTarget?.addEventListener('pointerdown', this.#onWallNodePointerDown, true)

    // Use ResizeObserver to handle container size changes
    const resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas()
    })
    resizeObserver.observe(this)

    // this.#canvas
    this.#scheduleBindingLookupRefresh()
    this.#recordHistorySnapshot('Initial canvas state')
  }

  async #addObjectToCatalog(object: FabricObject) {
    const exported = await this.#buildObjectSymbolExportData(object)
    if (!exported) return

    const { fallbackName, bindingRole, situationElementType, markup } = exported
    const name = globalThis.prompt('Symbol name', fallbackName || 'Custom Symbol')?.trim()
    if (!name) return
    const folder = globalThis.prompt('Catalog folder (optional)', '')?.trim() || undefined
    const category = globalThis.prompt('Catalog category', 'My Symbols')?.trim() || 'My Symbols'
    const path = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
    const symbols = getStoredCustomSymbols()
    symbols.push({
      folder,
      category,
      name,
      path,
      metadata: {
        bindingRole,
        situationElementType,
        customSymbol: true,
        importedAt: Date.now()
      }
    })
    await setStoredCustomSymbols(symbols)
    this.#scheduleBindingLookupRefresh()
    this.#shell.projectPane?.select?.('symbols')
  }

  async #buildObjectSymbolExportData(object: FabricObject) {
    const cloned = await object.clone()
    if (!cloned) return null

    const normalized = cloned as FabricObject & {
      bindingRole?: JsonValue
      situationElementType?: JsonValue
      name?: JsonValue
      label?: JsonValue
    }

    normalized.set({
      left: 24,
      top: 24,
      originX: 'left',
      originY: 'top',
      angle: 0,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      flipY: false
    })
    normalized.setCoords?.()

    const bounds = normalized.getBoundingRect()
    const width = Math.max(48, Math.ceil(Number(bounds.width ?? 0) + 48))
    const height = Math.max(48, Math.ceil(Number(bounds.height ?? 0) + 48))
    const objectSvg = normalized.toSVG()
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${objectSvg}</svg>`

    const fallbackName = String(
      (normalized.name as string) || (normalized.label as string) || normalized.type || 'Custom Symbol'
    )
      .replace(/^Cadle/i, '')
      .trim()
    return {
      fallbackName,
      bindingRole: String(normalized.bindingRole ?? 'neutral').toLowerCase(),
      situationElementType: String(normalized.situationElementType ?? '').trim() || undefined,
      markup
    }
  }

  async #exportObjectAsSymbolFile(object: FabricObject) {
    const exported = await this.#buildObjectSymbolExportData(object)
    if (!exported) return
    const suggestedName = exported.fallbackName || 'custom-symbol'
    const fileName =
      globalThis.prompt('Export symbol filename', suggestedName)?.trim().replace(/\s+/g, '-') || suggestedName
    const blob = new Blob([exported.markup], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${fileName}.svg`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async addActiveObjectToCatalog() {
    const activeObject = this.#canvas.getActiveObject() as FabricObject | null
    if (!activeObject) {
      globalThis.alert('Please select an object first.')
      return
    }

    await this.#addObjectToCatalog(activeObject)
  }

  async exportActiveObjectAsSymbol() {
    const activeObject = this.#canvas.getActiveObject() as FabricObject | null
    if (!activeObject) {
      globalThis.alert('Please select an object first.')
      return
    }

    await this.#exportObjectAsSymbolFile(activeObject)
  }

  async #cloneObjectWithOffset(object: FabricObject) {
    const cloned = await object.clone()
    if (!cloned) return
    const step = this.freeDraw ? 10 : this.gridSize
    cloned.set({
      left: Number(cloned.left ?? object.left ?? 0) + step,
      top: Number(cloned.top ?? object.top ?? 0) + step
    })
    cloned.setCoords?.()
    this.#canvas.discardActiveObject()
    this.#canvas.add(cloned)
    this.#canvas.setActiveObject(cloned)
    this.#canvas.requestRenderAll()
  }

  #toggleFlip(object: FabricObject, axis: 'x' | 'y') {
    const target = object as FabricObject & {
      set?: (props: Record<string, unknown>) => void
      flipX?: boolean
      flipY?: boolean
      setCoords?: () => void
    }
    if (typeof target.set !== 'function') return

    if (axis === 'x') {
      target.set({ flipX: !Boolean(target.flipX) })
    } else {
      target.set({ flipY: !Boolean(target.flipY) })
    }

    target.setCoords?.()
    this.#canvas.requestRenderAll()
  }

  #rotateObject(object: FabricObject, delta: number) {
    const target = object as FabricObject & {
      rotate?: (angle: number) => void
      angle?: number
      setCoords?: () => void
    }
    if (typeof target.rotate !== 'function') return

    const current = Number(target.angle ?? 0)
    target.rotate(current + delta)
    target.setCoords?.()
    this.#canvas.requestRenderAll()
  }

  #onContextMenuSelected = async (event: CustomEvent) => {
    const detail = event.detail as Element | null
    const action = detail?.getAttribute?.('action')
    if (!action) return

    const object = this.#contextTargetObject ?? (this.#canvas.getActiveObject() as FabricObject | null)
    if (!object) return

    if (action === 'group') {
      await group()
    } else if (action === 'ungroup') {
      await ungroup()
    } else if (action === 'add-to-catalog') {
      await this.#addObjectToCatalog(object)
    } else if (action === 'export-symbol') {
      await this.#exportObjectAsSymbolFile(object)
    } else if (action === 'clone-object') {
      await this.#cloneObjectWithOffset(object)
    } else if (action === 'flip-horizontal') {
      this.#toggleFlip(object, 'x')
    } else if (action === 'flip-vertical') {
      this.#toggleFlip(object, 'y')
    } else if (action === 'rotate-left') {
      this.#rotateObject(object, -90)
    } else if (action === 'rotate-right') {
      this.#rotateObject(object, 90)
    } else if (action === 'bring-to-front') {
      this.#canvas.bringObjectToFront(object)
      this.#canvas.requestRenderAll()
    } else if (action === 'send-to-back') {
      this.#canvas.sendObjectToBack(object)
      this.#canvas.requestRenderAll()
    } else if (action === 'delete-object') {
      this.#canvas.discardActiveObject()
      this.#canvas.remove(object)
      this.#canvas.requestRenderAll()
    }

    if (this.contextMenu) this.contextMenu.open = false
  }

  #openObjectContextMenu(target: FabricObject | null, clientX: number, clientY: number) {
    if (!target) return
    if (!this.contextMenu) return
    const menuTarget = target as FabricObject & {
      set?: (props: Record<string, unknown>) => void
      onSelect?: () => boolean
    }
    if (typeof menuTarget.set !== 'function') return

    this.#contextTargetObject = menuTarget
    this.#contextSelection = this.#canvas.getActiveObjects().slice() as FabricObject[]
    const selectedCount = this.#contextSelection.length
    if (selectedCount <= 1 && typeof menuTarget.onSelect === 'function') {
      this.#canvas.discardActiveObject()
      this.#canvas.setActiveObject(menuTarget)
    }

    this.#canvas.requestRenderAll()
    this.contextMenu.showAt?.(
      clientX,
      clientY,
      selectedCount > 1 ? ({ type: 'activeSelection' } as ContextMenuTarget) : menuTarget,
      selectedCount
    )
  }

  #cancelDrawMode() {
    if (this.action === 'draw-wall') {
      this.#finishWallSketch()
    }

    this.drawing = false
    this._current = undefined
    this._selectedSymbolPrototype = null
    this.#wallSketch.finish()
    this.canvas.selection = true
    this.#canvas.isDrawingMode = false
    this.action = undefined
    this.canvas.renderAll()
  }

  #contextmenu = (event) => {
    const object =
      (this.#canvas as Canvas & { findTarget?: (event: Event) => FabricObject | undefined }).findTarget?.(
        event as Event
      ) ??
      this.#lastPointerTarget ??
      (this.canvas.getActiveObject() as FabricObject | null)

    if (!object && this.action?.startsWith('draw')) {
      event.preventDefault()
      this.#cancelDrawMode()
      return
    }

    if (object) {
      event.preventDefault()
      this.#openObjectContextMenu(object, Number(event.clientX ?? 0), Number(event.clientY ?? 0))
    }
  }

  #isEditableTextObject(object: FabricObject | null | undefined): object is EditableTextFabricObject {
    if (!object) return false
    const textObject = object as EditableTextFabricObject
    const normalizedType = String(textObject.type ?? '').toLowerCase()
    const isTextType =
      normalizedType === 'textbox' ||
      normalizedType === 'i-text' ||
      textObject.isType?.('textbox') === true ||
      textObject.isType?.('i-text') === true
    return isTextType && typeof textObject.enterEditing === 'function'
  }

  #enterTextEditing(object: EditableTextFabricObject): boolean {
    if (object.editable === false) return false
    this.#canvas.setActiveObject(object)
    object.enterEditing?.()
    object.selectAll?.()
    this.#canvas.requestRenderAll()
    return true
  }

  #resolveEditableTextTarget(event?: DblClickInput): EditableTextFabricObject | null {
    const subTargets = Array.isArray(event?.subTargets) ? event?.subTargets : []
    for (const candidate of subTargets) {
      if (this.#isEditableTextObject(candidate)) return candidate
    }

    const directTarget = (event?.target as FabricObject | null) ?? null
    if (this.#isEditableTextObject(directTarget)) return directTarget

    const activeObject = this.canvas.getActiveObject() as FabricObject | null
    if (this.#isEditableTextObject(activeObject)) return activeObject
    return null
  }

  async _dblclick(event?: DblClickInput) {
    const editableTextTarget = this.#resolveEditableTextTarget(event)
    if (editableTextTarget && this.#enterTextEditing(editableTextTarget)) return

    const targetObject =
      (event?.target as FabricObject | null) ?? (this.canvas.getActiveObject() as FabricObject | null)
    if (!targetObject || this.drawing || this._current) return

    if (this.#isBreakerSymbol(targetObject)) {
      window.dispatchEvent(new CustomEvent('cadle-open-protection-pane'))
      return
    }

    await this.#promptBindingForObject(targetObject)
  }

  _drop(e) {
    void e
  }

  #lastGridSignature = ''

  #updateGridBackground() {
    const container = this.canvasContainer
    if (!container) return
    const vpt = this.#canvas?.viewportTransform
    if (!vpt) return

    const zoom = Number(vpt[0]) || 1
    const offsetX = Number(vpt[4]) || 0
    const offsetY = Number(vpt[5]) || 0
    const step = this.gridSize * zoom
    if (!Number.isFinite(step) || step <= 0) return

    const positionX = ((offsetX % step) + step) % step
    const positionY = ((offsetY % step) + step) % step

    const signature = `${step}:${positionX}:${positionY}`
    if (signature === this.#lastGridSignature) return
    this.#lastGridSignature = signature

    const minor = `${step}px ${step}px`
    const major = `${step * 5}px ${step * 5}px`
    const position = `${positionX}px ${positionY}px`

    container.style.backgroundSize = `${minor}, ${minor}, ${major}, ${major}`
    container.style.backgroundPosition = `${position}, ${position}, ${position}, ${position}`
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

  #selectWallSegmentAtPointer(wall: WallObject, pointer: { x: number; y: number }): void {
    const polyWall = wall as WallObject & {
      wallPoints?: { x: number; y: number }[]
      wallSelectedSegmentStartIndex?: number
    }
    const wallPoints = Array.isArray(polyWall.wallPoints) ? polyWall.wallPoints : null
    if (!wallPoints || wallPoints.length < 2) {
      polyWall.wallSelectedSegmentStartIndex = undefined
      return
    }

    const wallLeft = Number(wall.left ?? 0)
    const wallTop = Number(wall.top ?? 0)
    let bestIndex = -1
    let bestDistanceSquared = Infinity

    for (let i = 0; i < wallPoints.length - 1; i++) {
      const a = { x: wallLeft + wallPoints[i].x, y: wallTop + wallPoints[i].y }
      const b = { x: wallLeft + wallPoints[i + 1].x, y: wallTop + wallPoints[i + 1].y }
      const vx = b.x - a.x
      const vy = b.y - a.y
      const lengthSquared = vx * vx + vy * vy
      if (lengthSquared <= 0) continue

      const wx = pointer.x - a.x
      const wy = pointer.y - a.y
      const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / lengthSquared))
      const cx = a.x + t * vx
      const cy = a.y + t * vy
      const dx = pointer.x - cx
      const dy = pointer.y - cy
      const distanceSquared = dx * dx + dy * dy

      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared
        bestIndex = i
      }
    }

    const baseThickness =
      Number((polyWall as { wallThickness?: number }).wallThickness ?? 0) ||
      Math.max(1, Math.min(Number(wall.width ?? 0), Number(wall.height ?? 0)))
    const maxDistance = Math.max(this.gridSize * 0.8, baseThickness * 0.75)
    polyWall.wallSelectedSegmentStartIndex =
      bestIndex >= 0 && bestDistanceSquared <= maxDistance * maxDistance ? bestIndex : undefined
  }

  async _mousedown(e) {
    this.#lastPointerTarget = (e?.target as FabricObject | null) ?? null
    const mouseEvent = e?.e as MouseEvent | undefined
    const wallFreeMode = this.freeDraw || Boolean(mouseEvent?.shiftKey)

    if (mouseEvent && mouseEvent.button === 0) {
      const clickedObject = (e?.target as FabricObject | null) ?? null
      if (clickedObject && isWallObject(clickedObject as WallObject)) {
        const pointer = this.#extractPointer(e)
        this.#selectWallSegmentAtPointer(clickedObject as WallObject, pointer)
        const nodes = this.#collectWallNodesForCanvas().filter((node) =>
          node.refs.some((ref) => ref.wall === clickedObject)
        )
        if (nodes.length > 0) {
          const zoom = typeof this.#canvas.getZoom === 'function' ? this.#canvas.getZoom() : 1
          const selectTolerance = Math.max(64, 48 / Math.max(zoom, 0.01))
          const nearestNode = findWallNodeAt(nodes, { x: pointer.x, y: pointer.y }, selectTolerance)
          if (nearestNode) {
            this.#selectedWallNode = nearestNode
            this.#scheduleMeasurementOverlayRender()
          }
        }
      }
    }

    if ((mouseEvent?.button ?? 0) === 2) {
      mouseEvent?.preventDefault?.()
      mouseEvent?.stopPropagation?.()
      const target = (e?.target as FabricObject | null) ?? this.#lastPointerTarget
      if (target) {
        this.#openObjectContextMenu(target, Number(mouseEvent?.clientX ?? 0), Number(mouseEvent?.clientY ?? 0))
      } else if (this.action?.startsWith('draw')) {
        this.#cancelDrawMode()
      }
      return
    }

    if (this.action === 'draw-symbol' && !this._current && !this.drawing && !this.moving) {
      await this.#instantiateSelectedSymbol()
    }

    if (this.action === 'draw-text' && !this._current && !this.drawing && !this.moving) {
      const pointer = this.#extractPointer(e)
      const currentPoints = this.snapToGrid({ left: pointer.x, top: pointer.y })
      this._current = new Textbox(state.text.current, {
        fontFamily: 'system-ui',
        fontSize: 12,
        fontStyle: 'normal',
        fontWeight: 'normal',
        controls: false,
        left: Math.abs(currentPoints.left),
        top: Math.abs(currentPoints.top)
      })
    }

    if (this.action === 'draw-symbol' || this.action === 'draw-text') {
      if (this._current && !this.drawing && !this.moving) {
        const pointer = this.#extractPointer(e)
        const currentPoints = this.snapToGrid({ left: pointer.x, top: pointer.y })
        this._current.set({
          left: Math.abs(currentPoints.left),
          top: Math.abs(currentPoints.top),
          opacity: 1,
          selectable: true,
          evented: true
        })
        this.#ensureCurrentOnCanvas()

        this.drawing = true
      }
    }

    if (
      e.target &&
      this.action !== 'draw-door' &&
      this.action !== 'draw-window' &&
      this.action !== 'draw-gate' &&
      this.action !== 'draw-wall' &&
      this.action !== 'draw-cable' &&
      this.action !== 'draw-symbol' &&
      this.action !== 'draw-text'
    )
      return

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
        case '':
        case null:
        case undefined:
          this.canvas.selection = true
          this.#canvas.isDrawingMode = false
          return
        default:
          this.drawing = true
          if (this.#openingHoverGhost.clear()) this.#scheduleMeasurementOverlayRender()
          const pointer = this.#extractPointer(e)
          const snappedPointer = this.snapToGrid({ left: pointer.x, top: pointer.y })
          this.#drawSnapWall = null
          this.#startPoints = snappedPointer

          if (this.#isLineLikeAction(this.action)) {
            this.#startPoints = this.#snapLinePointToOneWirePort(this.#startPoints)
          }

          if (this.action === 'draw-wall') {
            this.#wallDrawFreeMode = wallFreeMode
            const startSnap = snapWallEndpoint(
              this.canvas,
              this.#startPoints,
              undefined,
              this.gridSize,
              false,
              this.#wallDrawFreeMode
            )
            this.#startPoints = { left: startSnap.left, top: startSnap.top }
            this.#wallSketch.start(this.#startPoints)
            this.#overlayPointer = { left: this.#startPoints.left, top: this.#startPoints.top }
          }

          if (this.action === 'draw-door' || this.action === 'draw-window' || this.action === 'draw-gate') {
            const wallSnap = findNearestWall(this.#canvas, snappedPointer, Math.max(24, this.gridSize * 2))
            if (wallSnap) {
              this.#drawSnapWall = wallSnap
              this.#startPoints = projectPointToWall(snappedPointer, wallSnap, {
                freeDraw: this.freeDraw,
                snap: (value: number) => this.snap(value)
              })
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
            this.#canvas.freeDrawingBrush = new PencilBrush(this.#canvas)
            this.#canvas.freeDrawingBrush.color = state.styling.stroke || '#555'
            this.#canvas.freeDrawingBrush.width = 2
          } else if (this.#isLineLikeAction(this.action)) {
            this._current = new Line(
              [this.#startPoints.left, this.#startPoints.top, this.#startPoints.left, this.#startPoints.top],
              {
                ...sharedDrawOptions,
                strokeWidth: this.action === 'draw-cable' ? 2 : 1,
                stroke: this.action === 'draw-cable' ? '#a85427' : state.styling.stroke,
                strokeDashArray: this.action === 'draw-cable' ? [8, 4] : undefined,
                x2: this.#startPoints.top,
                y2: this.#startPoints.left,
                originX: 'center',
                originY: 'center',
                borderScaleFactor: 0,
                centeredRotation: true
              }
            )
          } else if (this.action === 'draw-circle') {
            const circleSize = Math.max(
              this.gridSize,
              Math.abs(pointer.x - this.#startPoints.left),
              Math.abs(pointer.y - this.#startPoints.top)
            )
            this._current = new Circle({
              ...sharedDrawOptions,
              top: Math.min(this.#startPoints.top, pointer.y),
              left: Math.min(this.#startPoints.left, pointer.x),
              originX: 'left',
              originY: 'top',
              radius: circleSize / 2,
              strokeWidth: 1,
              centeredRotation: true
            })
          } else if (this.action === 'draw-arc') {
            const dx = pointer.x - this.#startPoints.left
            const dy = pointer.y - this.#startPoints.top
            const arcSize = Math.max(this.gridSize, Math.abs(dx), Math.abs(dy))
            const left = dx >= 0 ? this.#startPoints.left : this.#startPoints.left - arcSize
            const top = dy >= 0 ? this.#startPoints.top : this.#startPoints.top - arcSize
            const startAngle = dx >= 0 ? (dy >= 0 ? 0 : 270) : dy >= 0 ? 90 : 180
            const endAngle = startAngle + 90
            this._current = new Circle({
              ...sharedDrawOptions,
              top,
              left,
              originX: 'left',
              originY: 'top',
              radius: arcSize / 2,
              startAngle,
              endAngle,
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
            const wallLayout = this.#wallDrawFreeMode
              ? getWallDrawLayoutFree(this.canvas, this.#startPoints, snappedPointer, this.gridSize)
              : getWallDrawLayout(this.canvas, this.#startPoints, snappedPointer, this.gridSize)
            this._current = new CadleWall({
              ...sharedDrawOptions,
              ...wallLayout,
              strokeWidth: 1.5,
              stroke: canvasInk(),
              strokeDashArray: [10, 6],
              fill: canvasSurface(),
              opacity: 0.72
            })
          } else if (this.action === 'draw-window') {
            const wallLayout = this.#drawSnapWall
              ? getCenteredOpeningLayout(this.action, this.#startPoints, this.#drawSnapWall, this.gridSize, {
                  freeDraw: this.freeDraw,
                  snap: (value: number) => this.snap(value)
                })
              : null
            const openingBackground = this.#drawSnapWall?.wall?.fill
              ? invertColor(String(this.#drawSnapWall.wall.fill))
              : canvasSurface()
            this._current = new CadleWindow({
              ...sharedDrawOptions,
              ...(wallLayout ?? {
                left: this.#startPoints.left,
                top: this.#startPoints.top,
                width: pointer.x - this.#startPoints.left,
                height: pointer.y - this.#startPoints.top
              }),
              backgroundColor: openingBackground,
              strokeWidth: 1,
              strokeDashArray: [5, 5]
            })
            if (this.#drawSnapWall?.wall && this._current) {
              this.#writeOpeningAnchor(this._current as OpeningSnapTarget, this.#drawSnapWall.wall)
            }
          } else if (this.action === 'draw-door') {
            const wallLayout = this.#drawSnapWall
              ? getCenteredOpeningLayout(this.action, this.#startPoints, this.#drawSnapWall, this.gridSize, {
                  freeDraw: this.freeDraw,
                  snap: (value: number) => this.snap(value)
                })
              : null
            const openingBackground = this.#drawSnapWall?.wall?.fill
              ? invertColor(String(this.#drawSnapWall.wall.fill))
              : canvasSurface()
            this._current = new CadleDoor({
              ...sharedDrawOptions,
              ...(wallLayout ?? {
                left: this.#startPoints.left,
                top: this.#startPoints.top,
                width: pointer.x - this.#startPoints.left,
                height: pointer.y - this.#startPoints.top,
                wallThickness: undefined
              }),
              backgroundColor: openingBackground,
              strokeWidth: 1,
              strokeDashArray: [5, 5]
            })
            if (this.#drawSnapWall?.wall && this._current) {
              this.#writeOpeningAnchor(this._current as OpeningSnapTarget, this.#drawSnapWall.wall)
            }
          } else if (this.action === 'draw-gate') {
            const wallLayout = this.#drawSnapWall
              ? getCenteredOpeningLayout(this.action, this.#startPoints, this.#drawSnapWall, this.gridSize, {
                  freeDraw: this.freeDraw,
                  snap: (value: number) => this.snap(value)
                })
              : null
            const openingBackground = this.#drawSnapWall?.wall?.fill
              ? invertColor(String(this.#drawSnapWall.wall.fill))
              : canvasSurface()
            this._current = new CadleGate({
              ...sharedDrawOptions,
              ...(wallLayout ?? {
                left: this.#startPoints.left,
                top: this.#startPoints.top,
                width: pointer.x - this.#startPoints.left,
                height: pointer.y - this.#startPoints.top
              }),
              backgroundColor: openingBackground,
              strokeWidth: 1,
              strokeDashArray: [5, 5]
            })
            if (this.#drawSnapWall?.wall && this._current) {
              this.#writeOpeningAnchor(this._current as OpeningSnapTarget, this.#drawSnapWall.wall)
            }
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
    } else if (this.#isLineLikeAction(this.action)) {
      const snappedEndpoint = this.#snapLinePointToOneWirePort(
        { left: currentPoints.left, top: currentPoints.top },
        this._current
      )
      this._current.set({ x2: snappedEndpoint.left, y2: snappedEndpoint.top })
    } else if (this.action === 'draw-circle') {
      const circleSize = Math.max(
        this.gridSize,
        Math.abs(this.#startPoints.left - currentPoints.left),
        Math.abs(this.#startPoints.top - currentPoints.top)
      )
      this._current.set({
        left: Math.min(this.#startPoints.left, currentPoints.left),
        top: Math.min(this.#startPoints.top, currentPoints.top),
        radius: circleSize / 2
      })
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
        const wallLayout = getOpeningWallLayout(this.#startPoints, currentPoints, this.#drawSnapWall, this.gridSize, {
          freeDraw: this.freeDraw,
          snap: (value: number) => this.snap(value)
        })
        this._current.set(wallLayout)
        if (this.#drawSnapWall.wall) {
          this.#writeOpeningAnchor(this._current as OpeningSnapTarget, this.#drawSnapWall.wall)
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
    } else if (this.action === 'draw-door') {
      if (this.#drawSnapWall) {
        const wallLayout = getOpeningWallLayout(this.#startPoints, currentPoints, this.#drawSnapWall, this.gridSize, {
          freeDraw: this.freeDraw,
          snap: (value: number) => this.snap(value)
        })
        this._current.set(wallLayout)

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

        if (this.#drawSnapWall.wall) {
          this.#writeOpeningAnchor(this._current as OpeningSnapTarget, this.#drawSnapWall.wall)
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
        (this._current as { doorSwingDirection?: string }).doorSwingDirection === 'up' ||
        (this._current as { doorSwingDirection?: string }).doorSwingDirection === 'down'

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
        const wallLayout = getOpeningWallLayout(this.#startPoints, currentPoints, this.#drawSnapWall, this.gridSize, {
          freeDraw: this.freeDraw,
          snap: (value: number) => this.snap(value)
        })
        this._current.set(wallLayout)
        if (this.#drawSnapWall.wall) {
          this.#writeOpeningAnchor(this._current as OpeningSnapTarget, this.#drawSnapWall.wall)
        }
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
      const dx = currentPoints.left - this.#startPoints.left
      const dy = currentPoints.top - this.#startPoints.top
      const arcSize = Math.max(this.gridSize, Math.abs(dx), Math.abs(dy))
      const left = dx >= 0 ? this.#startPoints.left : this.#startPoints.left - arcSize
      const top = dy >= 0 ? this.#startPoints.top : this.#startPoints.top - arcSize
      const startAngle = dx >= 0 ? (dy >= 0 ? 0 : 270) : dy >= 0 ? 90 : 180
      const endAngle = startAngle + 90
      this._current.set({
        left,
        top,
        radius: arcSize / 2,
        startAngle,
        endAngle
      })
      // this._current.set({ radius: Math.abs(this.#startPoints.top - currentPoints.top) });
    } else if (this.action === 'draw-wall') {
      this.#updateWallPreview(currentPoints)
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
    const mouseEvent = e?.e as MouseEvent | undefined
    const wallFreeMode = this.freeDraw || Boolean(mouseEvent?.shiftKey)
    if (this.action === 'draw-wall') this.#wallDrawFreeMode = wallFreeMode
    state.mouse.position = { x: pointer.x, y: pointer.y }
    const currentPoints = this.#wallDrawFreeMode
      ? { left: pointer.x, top: pointer.y }
      : this.snapToGrid({ left: pointer.x, top: pointer.y })
    this.#overlayPointer = currentPoints

    if (this.action === 'draw-wall') {
      this.#scheduleMeasurementOverlayRender()
    }

    if (this.#maybeUpdateOpeningHoverGhost(currentPoints)) {
      this.#renderOverlay()
      this.#scheduleMeasurementOverlayRender()
    }

    if (this.action === 'draw') {
      return
    }

    if (
      this.action === 'draw-symbol' &&
      !this.drawing &&
      !this.moving &&
      !this._current &&
      this._selectedSymbolPrototype
    ) {
      void this.#instantiateSelectedSymbol(currentPoints)
    }

    if (e.target && !this.drawing) {
      if (this.action === 'draw-symbol' && this._current) {
        this._current.set({ left: currentPoints.left, top: currentPoints.top })
        this.#ensureCurrentOnCanvas()
        this.canvas.requestRenderAll()
        return
      }
      return
    }

    if (!this.drawing && this.action !== 'draw-symbol') return
    if (!this._current) return

    this.updateObjects(currentPoints)
    this.canvas.requestRenderAll()
  }

  #maybeUpdateOpeningHoverGhost(pointer: LeftTop): boolean {
    return this.#openingHoverGhost.update(this.action, pointer, {
      findNearestWall: (p, maxDist) => findNearestWall(this.#canvas, p, maxDist),
      getCenteredLayout: (action, p, wallSnap) =>
        wallSnap
          ? getCenteredOpeningLayout(action, p, wallSnap, this.gridSize, {
              freeDraw: this.freeDraw,
              snap: (value: number) => this.snap(value)
            })
          : { left: 0, top: 0, width: 0, height: 0 }
    })
  }

  async #instantiateSelectedSymbol(position?: LeftTop) {
    if (!this._selectedSymbolPrototype) return
    try {
      const cloned = await this._selectedSymbolPrototype.clone()
      if (!cloned) return
      if (position) {
        cloned.set({ left: position.left, top: position.top })
      }

      cloned.setCoords?.()
      cloned.set?.({ selectable: false, evented: false, opacity: 0.6 })
      this._current = cloned
      this.#ensureCurrentOnCanvas()
    } catch {
      this._current = null
    }
  }

  #ensureCurrentOnCanvas() {
    if (!this._current) return
    if (this._current.canvas && this._current.canvas !== this.canvas) {
      this._current.canvas.remove(this._current)
    }

    if (!this.canvas.getObjects().includes(this._current)) {
      this.canvas.add(this._current)
    }
  }

  async _mouseenter(e) {
    const pointer = this.#extractPointer(e)
    state.mouse.position = { x: pointer.x, y: pointer.y }
    if (this.action) this.#canvas.defaultCursor = 'crosshair'
    if (this.action === 'draw-symbol' && !this._current && this._selectedSymbolPrototype) {
      await this.#instantiateSelectedSymbol()
    }

    if (!this._current) return

    const currentPoints = this.snapToGrid({ left: pointer.x, top: pointer.y })
    if (this.action === 'draw-symbol' || this.action === 'draw-text') {
      this.drawing = true
      this._current.set({ left: Math.abs(currentPoints.left) })
      this._current.set({ top: Math.abs(currentPoints.top) })
      this.#ensureCurrentOnCanvas()
    }

    this.canvas.renderAll()
  }

  _mouseleave(e) {
    const pointer = this.#extractPointer(e)
    state.mouse.position = { x: pointer.x, y: pointer.y }
    this.drawing = false
    this.#overlayPointer = null
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

    if (this.#openingHoverGhost.clear()) {
      this.#scheduleMeasurementOverlayRender()
    }

    this.#drawSnapWall = null
    this.canvas.selection = true
    this.#canvas.isDrawingMode = false

    this.canvas.renderAll()
  }

  _mouseup(e?: { e?: PointerEvent }) {
    if (this.action === 'draw-wall' && this.drawing && !this.moving && this._current) {
      const pointer = this.#extractPointer(e)
      this.#commitWallSegment({ left: pointer.x, top: pointer.y })
      return
    }

    if (this.drawing && !this.moving) {
      if (this.action !== 'draw-wall') {
        this.drawing = false
        if (this.action !== 'draw' && this._current) {
          this.#ensureCurrentOnCanvas()
          this.canvas.remove(this._current)
          this.canvas.add(this._current)
          if (this.action === 'draw-symbol' || this.action === 'draw-text') {
            if (this.loadedPage && this.project?.pages?.[this.loadedPage]) {
              void this.#shell
                .savePage()
                .catch((error) => console.error('Auto-save failed after drawing symbol/text', error))
            }
          }

          if (this.action === 'draw-cable') {
            this.#promptCableBindingAndPersist(this._current as CableLineObject)
          }
        }

        this.canvas.selection = true
        this._current = undefined
        this.#drawSnapWall = null
        this.#canvas.isDrawingMode = false
        if (this.action === 'draw') {
          this.canvas.selection = true
          this.#canvas.isDrawingMode = false
          this.action = undefined
        }

        if (this._selectionWasTrue) {
          this.canvas.selection = true
          this._selectionWasTrue = false
        }
      }
    } else {
      const activeObjects = this.canvas.getActiveObjects() ?? []
      if (activeObjects.length > 1) {
        this._drawState = 'group'
        this._currentGroup = activeObjects[0]?.group ?? undefined
        this.canvas.renderAll()
      }
    }
  }

  _keydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && this.action === 'draw-wall' && this.isWallChainActive()) {
      this.#finishWallSketch()
      return
    }

    if (e.key !== 'Escape') return
    if (!this.action?.startsWith('draw')) return

    if (this.action === 'draw-wall' && this.isWallChainActive()) {
      this.#finishWallSketch()
      return
    }

    if (this._current) {
      this.drawing = false
      this._current = undefined
      this._selectedSymbolPrototype = null
      this.canvas.selection = true
      this.#canvas.isDrawingMode = false
      this.canvas.renderAll()
    }
  }

  toJSON() {
    if (!this.#canvas) return { version: '6.0.0', objects: [] }
    return this.#canvas.toObject(BINDING_AND_SYMBOL_PROPS as unknown as string[])
  }

  #sanitizeCanvasObjects(canvas: Canvas) {
    for (const object of canvas.getObjects()) {
      this.#sanitizeObjectForSerialization(object)
    }
  }

  #sanitizeObjectForSerialization(object) {
    if (!object || typeof object !== 'object') return
    const objectRecord = object as Record<string, JsonValue>

    if (Array.isArray(objectRecord._objects)) {
      objectRecord._objects = objectRecord._objects.filter((child) => child != null)
      for (const child of objectRecord._objects) {
        this.#sanitizeObjectForSerialization(child)
      }
    }

    if (Array.isArray(objectRecord.objects)) {
      objectRecord.objects = objectRecord.objects.filter((child) => child != null)
      for (const child of objectRecord.objects) {
        this.#sanitizeObjectForSerialization(child)
      }
    }
  }

  async fromJSON(json: { objects?: JsonValue[]; version: string }) {
    if (!json.objects) return

    const { standard, specials } = partitionRawObjects(json.objects as unknown as SerializedObject[])

    this.#historyRecordingEnabled = false
    await this.#canvas.loadFromJSON({ objects: standard, version: json.version })
    reapplyBindingProps(standard, this.#canvas.getObjects())
    instantiateSpecials(this.#canvas, specials)
    this.#historyRecordingEnabled = true

    this.#canvas.renderAll()
    this.#scheduleBindingLookupRefresh()
    this.fitToContainer()
    this.#recordHistorySnapshot('Loaded page')
  }

  toDataURL() {
    return this.#canvas.toDataURL({ multiplier: 3, quality: 100, enableRetinaScaling: true })
  }

  resizeCanvas() {
    const stage = this.shadowRoot.querySelector('.canvas-stage') as HTMLElement | null
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
    const objects = this.#canvas.getObjects().filter((obj: FabricObject) => obj.visible !== false)

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
      const bounds = obj.getBoundingRect()
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
    if (this.#zoomController) {
      this.#zoomController.fitToContainer()
    } else {
      this.#fitContentInCanvas()
      this.#canvas.renderAll()
      this.requestRender()
    }
  }

  setZoom(zoom: number) {
    this.#zoomController?.setZoom(zoom)
  }

  zoomIn() {
    this.#zoomController?.zoomIn()
  }

  zoomOut() {
    this.#zoomController?.zoomOut()
  }

  resetZoom() {
    this.#zoomController?.reset()
  }

  toggleMeasurements() {
    const next = !this.showMeasurements
    this.showMeasurements = next
    cadleShell.showMeasurements = next
    this.#canvas.requestRenderAll()
  }

  render() {
    return html`<context-menu>
        <custom-list-item
          type="menu"
          action="add-to-catalog">
          <custom-icon
            slot="start"
            icon="add"></custom-icon>
          add
        </custom-list-item>
        <custom-list-item
          type="menu"
          action="export-symbol">
          <custom-icon
            slot="start"
            icon="download"></custom-icon>
          export symbol
        </custom-list-item>
        <custom-list-item
          type="menu"
          action="clone-object">
          <custom-icon
            slot="start"
            icon="content_copy"></custom-icon>
          clone
        </custom-list-item>
        <custom-list-item
          type="menu"
          action="bring-to-front">
          <custom-icon
            slot="start"
            icon="vertical_align_top"></custom-icon>
          bring to front
        </custom-list-item>
        <custom-list-item
          type="menu"
          action="send-to-back">
          <custom-icon
            slot="start"
            icon="vertical_align_bottom"></custom-icon>
          send to back
        </custom-list-item>
        <custom-list-item
          type="menu"
          action="delete-object">
          <custom-icon
            slot="start"
            icon="delete"></custom-icon>
          delete
        </custom-list-item>
      </context-menu>
      <div class="canvas-stage">
        <div class="shadow"></div>
        <canvas></canvas>
      </div> `
  }
}
