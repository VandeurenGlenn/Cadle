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
  getWallAxisFrame,
  getWallEndpoints,
  projectPointToWall,
  getWallDrawLayout,
  getWallDrawLayoutFree,
  getOpeningWallLayout,
  getCenteredOpeningLayout,
  snapOpeningToWall,
  snapWallEndpoint,
  LeftTop,
  type WallObject,
  type WallSnap
} from './draw/wall-snap.js'
import { OpeningHoverGhost } from './draw/opening-placement.js'
import { sceneToViewport } from './draw/overlay-geometry.js'
import type { BindingOverlay } from './draw/binding-overlay.js'
import { renderArchitecturalMeasurements, getMeasurementOverlayContext } from './draw/measurement-utils.js'
import { canvasInk, canvasSurface, invertColor } from '../symbols/canvas-tokens.js'
import {
  BINDING_AND_SYMBOL_PROPS,
  instantiateSpecials,
  partitionRawObjects,
  reapplyBindingProps,
  type SerializedObject
} from './draw/json-io.js'
import { ZoomController } from './draw/zoom-controller.js'
// import 'fabric-history';

declare global {
  interface HTMLElementTagNameMap {
    'draw-field': DrawField
  }
}

type DrawFabricObject = FabricObject & Record<string, JsonValue>

type PointerInput = {
  scenePoint?: { x?: number; y?: number }
  e?: PointerEvent
  pointer?: { x?: number; y?: number }
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
  #zoomController?: ZoomController

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
  accessor contextMenu!: (HTMLElement & { open?: boolean }) | null

  @query('.canvas-container')
  accessor canvasContainer!: HTMLElement | null

  _current: FabricObject | null = null
  _selectedSymbolPrototype: FabricObject | null = null

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
    `
  ]

  snap(value) {
    return Math.round(value / this.gridSize) * this.gridSize
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

  buildAutoOneWireSchema() {
    return buildAutoOneWireSchema(this.getBindingValidationReport(), this.#canvas)
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

    this.#drawWallCornerCaps(ctx)

    this.#drawWallMarkers(ctx)

    this.#drawWallSnapGhost(ctx, this.#overlayPointer)

    if (this.#openingHoverGhost.hasGhost()) {
      this.#openingHoverGhost.draw(ctx, (point) => sceneToViewport(this.#canvas, point))
    }

    this.#drawWallPreviewDimensions(ctx, this.#overlayPointer)

    if (this.showMeasurements) {
      renderArchitecturalMeasurements(this.#canvas, this.showMeasurements, ctx)
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
      this.freeDraw
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

    const wallLayout = getWallDrawLayout(
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

      for (const endpoint of endpoints) {
        const point = sceneToViewport(this.#canvas, { x: endpoint.x, y: endpoint.y })
        ctx.save()
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
        ctx.strokeStyle = inkColor
        ctx.beginPath()
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = inkColor
        ctx.fillText('end', point.x, point.y - 6)
        ctx.restore()
      }

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

  #drawWallCornerCaps(ctx: CanvasRenderingContext2D) {
    const walls = this.#canvas.getObjects().filter((obj): obj is WallObject => isWallObject(obj))
    if (!walls.length) return

    const endpoints: Array<{ x: number; y: number; thickness: number }> = []
    for (const wall of walls) {
      const frame = getWallAxisFrame(wall)
      const wallEndpoints = getWallEndpoints(wall)
      for (const point of wallEndpoints) {
        endpoints.push({ x: point.x, y: point.y, thickness: frame.thickness })
      }
    }

    const tolerance = 3
    const caps: Array<{ x: number; y: number; radius: number }> = []
    for (const endpoint of endpoints) {
      const connected = endpoints.some((other) => {
        if (other === endpoint) return false
        return Math.hypot(endpoint.x - other.x, endpoint.y - other.y) <= tolerance
      })
      if (connected) {
        caps.push({ x: endpoint.x, y: endpoint.y, radius: Math.max(1, Math.round(endpoint.thickness / 2)) })
      }
    }

    if (!caps.length) return

    ctx.save()
    ctx.fillStyle = canvasInk() || '#000'
    for (const cap of caps) {
      const screenPoint = sceneToViewport(this.#canvas, { x: cap.x, y: cap.y })
      ctx.beginPath()
      ctx.arc(screenPoint.x, screenPoint.y, cap.radius, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.restore()
  }

  #maybeUpdateOpeningHoverGhost(pointer: LeftTop) {
    return this.#openingHoverGhost.update(this.action, pointer, {
      findNearestWall: (pointer, maxDistance) => findNearestWall(this.#canvas, pointer, maxDistance),
      getCenteredLayout: (action, pointer, wallSnap) =>
        getCenteredOpeningLayout(action, pointer, wallSnap, this.gridSize, {
          freeDraw: this.freeDraw,
          snap: (value: number) => this.snap(value)
        })
    })
  }

  updateMeasures(evt) {
    const obj = evt.target
    if (obj.type != 'group') {
      return
    }

    const groupObjects = obj.getObjects?.() ?? []
    if (groupObjects.length < 3) return
    const width = obj.getWidth()
    const height = obj.getWidth()
    groupObjects[1].text = width.toFixed(2) + 'px'
    groupObjects[1].scaleX = 1 / obj.scaleX
    groupObjects[1].scaleY = 1 / obj.scaleY
    groupObjects[2].text = height.toFixed(2) + 'px'
    groupObjects[2].scaleX = 1 / obj.scaleY
    groupObjects[2].scaleY = 1 / obj.scaleX
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
      const target = options.target
      if (!target) return

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
    this.#canvas.on('object:modified', () => {
      this.#scheduleBindingLookupRefresh()
      this.#recordHistorySnapshot('Object modified')
    })

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

    // Use ResizeObserver to handle container size changes
    const resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas()
    })
    resizeObserver.observe(this)

    // this.#canvas
    this.#scheduleBindingLookupRefresh()
    this.#recordHistorySnapshot('Initial canvas state')
  }

  #contextmenu = (event) => {
    if (this.action?.startsWith('draw')) {
      event.preventDefault()
      this.drawing = false
      this._current = undefined
      this._selectedSymbolPrototype = null
      this.canvas.selection = true
      this.#canvas.isDrawingMode = false
      this.action = undefined
      this.canvas.renderAll()
      return
    }

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

  async _dblclick() {
    const activeObject = this.canvas.getActiveObject() as FabricObject | null
    if (!activeObject || this.drawing || this._current) return

    await this.#promptBindingForObject(activeObject)
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

  async _mousedown(e) {
    if (this.action === 'draw-wall' && this.drawing && this._current) {
      const pointer = this.#extractPointer(e)
      const snappedPointer = this.snapToGrid({ left: pointer.x, top: pointer.y })
      const snap = snapWallEndpoint(
        this.canvas,
        snappedPointer,
        this._current as WallObject | null,
        this.gridSize,
        false,
        this.freeDraw
      )
      const endPoint = { left: snap.left, top: snap.top }
      const wallLayout = this.freeDraw
        ? getWallDrawLayoutFree(
            this.canvas,
            this.#startPoints,
            endPoint,
            this.gridSize,
            this._current as WallObject | null
          )
        : getWallDrawLayout(this.canvas, this.#startPoints, endPoint, this.gridSize, this._current as WallObject | null)
      this._current.set(wallLayout)
      this._current.set({ fill: cadleShell._currentColor || canvasInk() || '#000', opacity: 1 })
      this._current = undefined
      this.drawing = false
      this.canvas.selection = true
      this.#drawSnapWall = null
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

          if (this.action === 'draw-wall') {
            const startSnap = snapWallEndpoint(
              this.canvas,
              this.#startPoints,
              undefined,
              this.gridSize,
              false,
              this.freeDraw
            )
            this.#startPoints = { left: startSnap.left, top: startSnap.top }
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
            const wallLayout = this.freeDraw
              ? getWallDrawLayoutFree(this.canvas, this.#startPoints, snappedPointer, this.gridSize)
              : getWallDrawLayout(this.canvas, this.#startPoints, snappedPointer, this.gridSize)
            this._current = new CadleWall({
              ...sharedDrawOptions,
              left: wallLayout.left,
              top: wallLayout.top,
              width: wallLayout.width,
              height: wallLayout.height,
              strokeWidth: 0,
              fill: canvasInk() || 'rgba(0, 0, 0, 0.12)',
              opacity: 0.5
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
        const wallLayout = getOpeningWallLayout(this.#startPoints, currentPoints, this.#drawSnapWall, this.gridSize, {
          freeDraw: this.freeDraw,
          snap: (value: number) => this.snap(value)
        })
        this._current.set(wallLayout)
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
      const wallLayout = this.freeDraw
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
    const currentPoints = this.snapToGrid({ left: pointer.x, top: pointer.y })
    this.#overlayPointer = currentPoints

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

  _mouseup() {
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
    if (e.key !== 'Escape') return
    if (!this.action?.startsWith('draw')) return

    if (this.action === 'draw-wall' && this.drawing && this._current) {
      this.drawing = false
      this.canvas.selection = true
      this.canvas.remove(this._current)
      this._current = undefined
      this.#drawSnapWall = null
      this.#overlayPointer = null
      this.#scheduleMeasurementOverlayRender()
      this.canvas.renderAll()
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
    return html` <context-menu>
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
