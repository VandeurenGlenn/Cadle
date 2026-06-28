import { LiteElement, html, customElement } from '@vandeurenglenn/lite'
import { nothing, svg } from 'lit'
import { repeat } from 'lit/directives/repeat.js'
import styles from './app.css' with { type: 'css' }
import { loadNativeState, saveNativeState, type NativeDocumentState } from './native-project-data.js'
import { migrateLegacyProjectToNativeState, migrateLegacySchemaToNativeState } from './native-draw/legacy-project.js'
import {
  DEFAULT_PRINT_MARGIN_MM,
  DEFAULT_WORLD_HEIGHT,
  DEFAULT_WORLD_WIDTH,
  GRID_SIZE,
  LEGACY_STORAGE_KEY,
  ONE_WIRE_BREAKER_WIDTH,
  ONE_WIRE_CIRCUIT_SPACING,
  ONE_WIRE_NODE_SIZE,
  ONE_WIRE_PRESETS,
  PAPER_PRESETS,
  nextOneWireBindingId,
  type OneWirePreset
} from './native-app/constants.js'
import {
  getNativeHotkeyAction,
  isEditableKeyboardEvent,
  type NativeHotkeyAction
} from './controllers/keyboard/hotkeys.js'
import {
  cloneShape,
  cloneShapes,
  inferSymbolScale,
  lineMetrics,
  nextShapeId,
  samePoint,
  sanitizeShapes,
  scaleDraftShape,
  scalePoint,
  scaleShape,
  shapeBounds
} from './native-draw/model.js'
import type {
  DraftShape,
  DragState,
  ImageShape,
  LineShape,
  NativeCatalogPick,
  PaperPreset,
  Point,
  RectShape,
  Shape,
  Snapshot,
  SymbolShape,
  TextShape,
  Tool
} from './native-draw/types.js'
import type { UUID } from './types.js'
import pubsub from './pubsub.js'
import { downloadTextFile, savePdfFromPng } from './native-app/downloads.js'
import {
  buildSvgDocument,
  buildWallMask,
  safeAreaRect,
  selectedOutlineMarkup,
  shapeMarkup
} from './native-app/svg-export.js'
import {
  bindingLabelsTemplate,
  measurementTemplate,
  rubberBandTemplate,
  safeAreaTemplate,
  selectedOutlineTemplate,
  shapeTemplate,
  wallChainPreviewTemplate,
  wallMaskTemplate
} from './native-app/svg-templates.js'
import { translateShape } from './native-app/shape-transforms.js'
import { buildOneWireCircuit } from './native-app/onewire-builder.js'
import { nextPanFromPointer } from './native-app/pointer-pan.js'
import { canCommitDraft, resolvePointerUpPhase } from './native-app/pointer-up.js'
import {
  resolveSelectPointerDownState,
  resolveOneWirePointerDown,
  resolveWallPointerDown
} from './native-app/pointer-down.js'
import {
  applyDragMove,
  updateDraftShapeEnd,
  updateSymbolPreviewPoint,
  updateWallChainPreview
} from './native-app/pointer-move.js'
import { resolveNativeEscapeAction } from './native-app/keyboard.js'
import { createDraftShape, createSymbolShape, createTextShape } from './native-app/pointer-down-builders.js'
import { createNativeSelectionChangedPayload } from './native-app/selection-payload.js'
import { transformShapeForSelection, type SelectionTransformAction } from './native-app/selection-transforms.js'

@customElement('cadle-app')
export class CadleApp extends LiteElement {
  static styles = [styles]

  #tool: Tool = 'select'
  #shapes: Shape[] = []
  #selectedId: string | null = null
  #draft: DraftShape | null = null
  #drag: DragState | null = null
  #history: Snapshot[] = []
  #historyIndex = -1
  #snap = true
  #stagePointerId: number | null = null
  #paperPreset: PaperPreset = 'a4-landscape'
  #printMargin = DEFAULT_PRINT_MARGIN_MM
  #worldWidth = DEFAULT_WORLD_WIDTH
  #worldHeight = DEFAULT_WORLD_HEIGHT
  #resizeObserver: ResizeObserver | null = null
  #projectKey: UUID | null = null
  #pageKey: UUID | null = null
  #persistPromise: Promise<void> = Promise.resolve()
  #connected = false
  // Wall click-chain state
  #wallChain: { startPoint: Point } | null = null
  #chainPreviewEnd: Point | null = null
  #snapTarget: Point | null = null
  #lastWallClickTime = 0
  #lastWallClickPoint: Point | null = null
  #pendingCatalogSymbol: NativeCatalogPick | null = null
  #symbolPreviewPoint: Point | null = null
  // Zoom & pan state
  #zoom = 1
  #panX = 0
  #panY = 0
  #isPanning = false
  #panStart: { px: number; py: number; panX: number; panY: number } | null = null
  #spaceDown = false
  // Rubber-band select
  #bandStart: Point | null = null
  #bandEnd: Point | null = null
  #selectedIds: Set<string> = new Set()
  #nativeClipboard: Shape[] = []
  #oneWireBindingId = 'A1'
  #oneWirePreset: OneWirePreset = 'sockets'
  #oneWireComposeKind: 'breaker' | 'switch' | 'load' = 'switch'
  #stageContextMenuOpen = false
  #stageContextMenuX = 0
  #stageContextMenuY = 0
  #stageContextSubmenu: 'transform' | 'arrange' | '' = ''
  // One-wire panel auto-stack state
  #oneWireAnchor: Point | null = null
  #oneWireLastPoint: Point | null = null
  #oneWireBusBarId: string | null = null

  #toolFromShellAction(action: string): Tool {
    switch (action) {
      case 'draw-wall':
        return 'wall'
      case 'draw-door':
        return 'door'
      case 'draw-window':
        return 'window'
      case 'draw-gate':
        return 'gate'
      case 'draw-line':
      case 'draw-cable':
        return 'line'
      case 'draw-onewire':
        return 'onewire'
      case 'draw-square':
        return 'rect'
      case 'draw-circle':
        return 'circle'
      case 'draw-arc':
        return 'arc'
      case 'draw-text':
        return 'text'
      case 'draw-symbol':
        return 'symbol'
      case 'draw':
        return 'line'
      case 'resize':
      case 'select':
      default:
        return 'select'
    }
  }

  connectedCallback() {
    super.connectedCallback()
    this.#connected = true
    this.#bindResizeObserver()
    this.shadowRoot?.addEventListener('wheel', this.#onWheel, { passive: false })
    window.addEventListener('hashchange', this.#onHashChange)
    window.addEventListener('keydown', this.#onKeyDown)
    window.addEventListener('keyup', this.#onKeyUp)
    pubsub.subscribe('shell.action', this.#onShellAction)
    pubsub.subscribe('shell.snap', this.#onShellSnap)
    pubsub.subscribe('native.catalog.pick', this.#onNativeCatalogPick)
    pubsub.subscribe('native.object.update', this.#onNativeObjectUpdate)
    pubsub.subscribe('native.object.delete', this.#onNativeObjectDelete)
    pubsub.subscribe('native.object.flip-side', this.#onNativeObjectFlipSide)
    void this.#initialize()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.#connected = false
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    this.shadowRoot?.removeEventListener('wheel', this.#onWheel)
    window.removeEventListener('hashchange', this.#onHashChange)
    window.removeEventListener('keydown', this.#onKeyDown)
    window.removeEventListener('keyup', this.#onKeyUp)
    pubsub.unsubscribe('shell.action', this.#onShellAction)
    pubsub.unsubscribe('shell.snap', this.#onShellSnap)
    pubsub.unsubscribe('native.catalog.pick', this.#onNativeCatalogPick)
    pubsub.unsubscribe('native.object.update', this.#onNativeObjectUpdate)
    pubsub.unsubscribe('native.object.delete', this.#onNativeObjectDelete)
    pubsub.unsubscribe('native.object.flip-side', this.#onNativeObjectFlipSide)
  }

  undo() {
    this.#undo()
  }

  redo() {
    this.#redo()
  }

  toSVG(): string {
    return this.#buildSvgDocument()
  }

  async exportA4PNG(orientation: 'portrait' | 'landscape' | 'auto' = 'auto'): Promise<{
    dataUrl: string
    orientation: 'portrait' | 'landscape'
    widthPx: number
    heightPx: number
  }> {
    const paper = this.#paperMeta()
    const resolvedOrientation =
      orientation === 'auto' ? (paper.widthMm >= paper.heightMm ? 'landscape' : 'portrait') : orientation
    const widthPx = resolvedOrientation === 'landscape' ? 3508 : 2480
    const heightPx = resolvedOrientation === 'landscape' ? 2480 : 3508
    const svgBlob = new Blob([this.#buildSvgDocument()], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('Unable to render SVG export'))
        img.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = widthPx
      canvas.height = heightPx
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas export is unavailable')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, widthPx, heightPx)
      context.drawImage(image, 0, 0, widthPx, heightPx)
      return {
        dataUrl: canvas.toDataURL('image/png'),
        orientation: resolvedOrientation,
        widthPx,
        heightPx
      }
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  #onShellAction = (action: string) => {
    const nextTool = this.#toolFromShellAction(action ?? '')
    this.#activateTool(nextTool)
  }

  #onShellSnap = (enabled: boolean) => {
    const next = Boolean(enabled)
    if (next === this.#snap) return
    this.#snap = next
    this.#render()
  }

  #onNativeCatalogPick = (payload: NativeCatalogPick) => {
    if (!payload || typeof payload.path !== 'string' || typeof payload.name !== 'string') return
    this.#pendingCatalogSymbol = {
      name: payload.name,
      path: payload.path,
      metadata: payload.metadata
    }
    this.#symbolPreviewPoint = null
    this.#tool = 'symbol'
    this.#draft = null
    this.#render()
  }

  #onNativeObjectUpdate = (payload: { bindingId?: string; rotation?: number; fill?: string; stroke?: string }) => {
    const raw = String(payload?.bindingId ?? '')
      .trim()
      .toUpperCase()
    const bindingId = raw || undefined
    const targets = this.#selectedIds.size > 0 ? [...this.#selectedIds] : this.#selectedId ? [this.#selectedId] : []
    if (!targets.length) return
    for (const id of targets) {
      const shape = this.#shapeById(id)
      if (!shape) continue
      const updated = cloneShape(shape) as Shape & {
        rotation?: number
        fill?: string
        stroke?: string
        bindingId?: string
      }
      if ('bindingId' in updated) {
        if (bindingId) updated.bindingId = bindingId
        else delete updated.bindingId
      }
      if (typeof payload.rotation === 'number') {
        if (updated.kind === 'symbol' || updated.kind === 'image' || updated.kind === 'text' || updated.kind === 'rect') {
          updated.rotation = ((payload.rotation % 360) + 360) % 360
        }
      }
      if (typeof payload.fill === 'string') {
        if (payload.fill) updated.fill = payload.fill
        else delete updated.fill
      }
      if (typeof payload.stroke === 'string') {
        if (payload.stroke) updated.stroke = payload.stroke
        else delete updated.stroke
      }
      this.#setShape(updated as Shape)
    }
    this.#pushHistory()
    this.#render()
  }

  #onNativeObjectDelete = () => {
    const targets =
      this.#selectedIds.size > 0
        ? this.#selectedIds
        : this.#selectedId
          ? new Set([this.#selectedId])
          : new Set<string>()
    if (!targets.size) return
    this.#shapes = this.#shapes.filter((shape) => !targets.has(shape.id))
    this.#selectedId = null
    this.#selectedIds = new Set()
    this.#pushHistory()
    this.#render()
  }

  #onNativeObjectFlipSide = () => {
    const shape = this.#shapeById(this.#selectedId)
    if (!shape || (shape.kind !== 'door' && shape.kind !== 'gate')) return
    const updated: LineShape = { ...shape, flipSide: !shape.flipSide }
    this.#setShape(updated)
    this.#pushHistory()
    this.#render()
  }

  async #initialize() {
    this.#history = []
    this.#historyIndex = -1
    this.#draft = null
    this.#drag = null
    this.#selectedId = null
    this.#selectedIds = new Set()

    await this.#restore()
    this.#pushHistory(false)
    this.#render()
    this.#syncWorldSize()
  }

  #persist() {
    const payload = this.#nativeDocumentState()

    if (!this.#projectKey || !this.#pageKey) return

    this.#persistPromise = this.#persistPromise
      .then(async () => {
        await saveNativeState(this.#projectKey!, this.#pageKey!, payload)
      })
      .catch(() => {})
  }

  async #restore() {
    const loaded = await loadNativeState()
    this.#projectKey = loaded.projectKey
    this.#pageKey = loaded.pageKey

    if (loaded.state) {
      this.#applyPersistedState(loaded.state)
      return
    }

    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) {
      this.#resetPageState()
      return
    }

    try {
      const parsed = JSON.parse(raw) as Partial<NativeDocumentState>
      this.#applyPersistedState(parsed)
      window.localStorage.removeItem(LEGACY_STORAGE_KEY)
      this.#persist()
    } catch {
      this.#resetPageState()
    }
  }

  #onHashChange = () => {
    if (!this.#connected) return
    void this.#initialize()
  }

  #applyPersistedState(parsed: Partial<NativeDocumentState>) {
    this.#resetPageState()
    if (Array.isArray(parsed.shapes)) this.#shapes = sanitizeShapes(parsed.shapes)
    if (typeof parsed.worldWidth === 'number' && Number.isFinite(parsed.worldWidth) && parsed.worldWidth > 0) {
      this.#worldWidth = parsed.worldWidth
    }
    if (typeof parsed.worldHeight === 'number' && Number.isFinite(parsed.worldHeight) && parsed.worldHeight > 0) {
      this.#worldHeight = parsed.worldHeight
    }
    if (parsed.paperPreset && parsed.paperPreset in PAPER_PRESETS) {
      this.#paperPreset = parsed.paperPreset
    }
    if (typeof parsed.printMargin === 'number' && Number.isFinite(parsed.printMargin) && parsed.printMargin >= 0) {
      this.#printMargin = parsed.printMargin
    }
  }

  #resetPageState() {
    this.#shapes = []
    this.#selectedId = null
    this.#selectedIds = new Set()
    this.#draft = null
    this.#drag = null
    this.#bandStart = null
    this.#bandEnd = null
    this.#wallChain = null
    this.#chainPreviewEnd = null
    this.#snapTarget = null
    this.#symbolPreviewPoint = null
    this.#worldWidth = DEFAULT_WORLD_WIDTH
    this.#worldHeight = DEFAULT_WORLD_HEIGHT
    this.#paperPreset = 'a4-landscape'
    this.#printMargin = DEFAULT_PRINT_MARGIN_MM
    this.#oneWireAnchor = null
    this.#oneWireLastPoint = null
    this.#oneWireBusBarId = null
  }

  #pushHistory(persist = true) {
    const snapshot: Snapshot = {
      shapes: cloneShapes(this.#shapes),
      selectedId: this.#selectedId,
      worldWidth: this.#worldWidth,
      worldHeight: this.#worldHeight
    }
    this.#history = this.#history.slice(0, this.#historyIndex + 1)
    this.#history.push(snapshot)
    this.#historyIndex = this.#history.length - 1
    if (persist) this.#persist()
  }

  #restoreSnapshot(snapshot: Snapshot) {
    this.#shapes = cloneShapes(snapshot.shapes)
    this.#selectedId = snapshot.selectedId
    this.#worldWidth = snapshot.worldWidth
    this.#worldHeight = snapshot.worldHeight
    this.#draft = null
    this.#drag = null
    this.#persist()
    this.#render()
  }

  #bindResizeObserver() {
    if (this.#resizeObserver) return
    this.#resizeObserver = new ResizeObserver(() => {
      this.#syncWorldSize()
    })
    this.#resizeObserver.observe(this)
  }

  #syncWorldSize() {
    const panel = this.shadowRoot?.querySelector<HTMLElement>('.panel')
    if (!panel) return

    const rect = panel.getBoundingClientRect()
    const nextWidth = Math.max(1, Math.round(rect.width))
    const nextHeight = Math.max(1, Math.round(rect.height))
    if (nextWidth === this.#worldWidth && nextHeight === this.#worldHeight) return

    const scaleX = nextWidth / this.#worldWidth
    const scaleY = nextHeight / this.#worldHeight
    this.#worldWidth = nextWidth
    this.#worldHeight = nextHeight
    this.#shapes = this.#shapes.map((shape) => scaleShape(shape, scaleX, scaleY))
    if (this.#draft) this.#draft = scaleDraftShape(this.#draft, scaleX, scaleY)
    if (this.#drag) {
      this.#drag = {
        ids: [...this.#drag.ids],
        pointerStart: scalePoint(this.#drag.pointerStart, scaleX, scaleY),
        initial: this.#drag.initial.map((shape) => scaleShape(shape, scaleX, scaleY))
      }
    }

    this.#persist()
    this.#render()
  }

  #undo() {
    if (this.#historyIndex <= 0) return
    this.#historyIndex -= 1
    this.#restoreSnapshot(this.#history[this.#historyIndex])
  }

  #redo() {
    if (this.#historyIndex >= this.#history.length - 1) return
    this.#historyIndex += 1
    this.#restoreSnapshot(this.#history[this.#historyIndex])
  }

  #snapPoint(point: Point): Point {
    if (!this.#snap) return point
    return {
      x: Math.round(point.x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(point.y / GRID_SIZE) * GRID_SIZE
    }
  }

  #pointFromEvent(event: PointerEvent): Point | null {
    const panel = this.shadowRoot?.querySelector<HTMLElement>('.panel')
    if (!panel) return null
    const rect = panel.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    // Convert screen → world via our explicit pan/zoom transform
    const screenX = event.clientX - rect.left
    const screenY = event.clientY - rect.top
    const worldPt = this.#screenToWorld(screenX, screenY)
    return {
      x: Math.max(0, Math.min(this.#worldWidth, worldPt.x)),
      y: Math.max(0, Math.min(this.#worldHeight, worldPt.y))
    }
  }

  // ── Zoom & pan helpers ────────────────────────────────────────────────────

  #clampZoom(z: number): number {
    return Math.max(0.1, Math.min(8, z))
  }

  // Zoom centred on a screen-space point (px, py are relative to the panel element).
  #zoomAt(px: number, py: number, factor: number) {
    const next = this.#clampZoom(this.#zoom * factor)
    if (next === this.#zoom) return
    // Keep the point under the cursor stationary: adjust pan so world-point stays the same.
    this.#panX = px - (px - this.#panX) * (next / this.#zoom)
    this.#panY = py - (py - this.#panY) * (next / this.#zoom)
    this.#zoom = next
    this.#render()
  }

  // Convert a screen-space event point (relative to panel) to world coordinates.
  #screenToWorld(screenX: number, screenY: number): Point {
    return {
      x: (screenX - this.#panX) / this.#zoom,
      y: (screenY - this.#panY) / this.#zoom
    }
  }

  #onWheel = (event: WheelEvent) => {
    const panel = this.shadowRoot?.querySelector<HTMLElement>('.panel')
    if (!panel) return
    // Only handle wheel events that target the drawing stage area
    const stage = this.shadowRoot?.querySelector('.stage')
    if (!stage || !event.composedPath().includes(stage)) return

    event.preventDefault()

    const rect = panel.getBoundingClientRect()
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top

    if (event.ctrlKey || event.metaKey) {
      // Pinch-zoom on trackpad, or Ctrl+scroll
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
      this.#zoomAt(px, py, factor)
    } else {
      // Scroll/pan
      this.#panX -= event.deltaX
      this.#panY -= event.deltaY
      this.#render()
    }
  }

  // ── Rubber-band select helpers ─────────────────────────────────────────────

  #shapesInBand(a: Point, b: Point): string[] {
    const minX = Math.min(a.x, b.x)
    const maxX = Math.max(a.x, b.x)
    const minY = Math.min(a.y, b.y)
    const maxY = Math.max(a.y, b.y)
    const ids: string[] = []
    for (const shape of this.#shapes) {
      const bounds = shapeBounds(shape)
      if (bounds.x + bounds.width >= minX && bounds.x <= maxX && bounds.y + bounds.height >= minY && bounds.y <= maxY) {
        ids.push(shape.id)
      }
    }
    return ids
  }

  // ── Space-key pan ──────────────────────────────────────────────────────────

  #onKeyUp = (event: KeyboardEvent) => {
    if (event.code === 'Space') {
      this.#spaceDown = false
      if (this.#isPanning) {
        this.#isPanning = false
        this.#panStart = null
        this.#render()
      }
    }
  }

  // ── Shape lookup ───────────────────────────────────────────────────────────

  #shapeById(id: string | null): Shape | null {
    if (!id) return null
    return this.#shapes.find((shape) => shape?.id === id) ?? null
  }

  #pointNearSegment(point: Point, start: Point, end: Point, tolerance: number): boolean {
    const deltaX = end.x - start.x
    const deltaY = end.y - start.y
    const lengthSquared = deltaX * deltaX + deltaY * deltaY
    if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y) <= tolerance
    const position = Math.max(
      0,
      Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared)
    )
    const projection = {
      x: start.x + position * deltaX,
      y: start.y + position * deltaY
    }
    return Math.hypot(point.x - projection.x, point.y - projection.y) <= tolerance
  }

  #shapeIdAtPoint(point: Point): string | null {
    const tolerance = Math.max(6, 12 / this.#zoom)
    for (let index = this.#shapes.length - 1; index >= 0; index -= 1) {
      const shape = this.#shapes[index]
      if (
        shape.kind === 'wall' ||
        shape.kind === 'line' ||
        shape.kind === 'door' ||
        shape.kind === 'window' ||
        shape.kind === 'gate'
      ) {
        if (this.#pointNearSegment(point, shape.start, shape.end, tolerance)) return shape.id
        continue
      }

      const bounds = shapeBounds(shape)
      if (
        point.x >= bounds.x - tolerance &&
        point.x <= bounds.x + bounds.width + tolerance &&
        point.y >= bounds.y - tolerance &&
        point.y <= bounds.y + bounds.height + tolerance
      ) {
        return shape.id
      }
    }
    return null
  }

  #activateTool(tool: Tool) {
    if (tool === this.#tool) return
    this.#tool = tool
    if (tool !== 'symbol') {
      this.#pendingCatalogSymbol = null
      this.#symbolPreviewPoint = null
    }
    if (tool !== 'onewire') {
      this.#oneWireAnchor = null
      this.#oneWireLastPoint = null
      this.#oneWireBusBarId = null
    }
    this.#draft = null
    this.#wallChain = null
    this.#chainPreviewEnd = null
    this.#snapTarget = null
    this.#render()
  }

  #selectedShapeIds(): string[] {
    if (this.#selectedIds.size > 0) return [...this.#selectedIds]
    return this.#selectedId ? [this.#selectedId] : []
  }

  #expandSelectionWithGroup(shapeId: string): Set<string> {
    const shape = this.#shapeById(shapeId)
    const groupId = shape?.groupId
    if (!groupId) return new Set([shapeId])
    return new Set(this.#shapes.filter((item) => item.groupId === groupId).map((item) => item.id))
  }

  #selectedGroupIds(): string[] {
    const ids = new Set<string>()
    for (const id of this.#selectedShapeIds()) {
      const groupId = this.#shapeById(id)?.groupId
      if (groupId) ids.add(groupId)
    }
    return [...ids]
  }

  #groupNativeSelection(): boolean {
    const ids = this.#selectedShapeIds()
    if (ids.length < 2) return false
    const groupId = `group-${nextShapeId()}`
    for (const id of ids) {
      const shape = this.#shapeById(id)
      if (!shape) continue
      this.#setShape({ ...shape, groupId })
    }
    this.#pushHistory()
    this.#render()
    return true
  }

  #ungroupNativeSelection(): boolean {
    const groupIds = this.#selectedGroupIds()
    if (!groupIds.length) return false
    const targetGroups = new Set(groupIds)
    for (const shape of this.#shapes) {
      if (!shape.groupId || !targetGroups.has(shape.groupId)) continue
      const updated = { ...shape }
      delete updated.groupId
      this.#setShape(updated)
    }
    this.#pushHistory()
    this.#render()
    return true
  }

  #hideStageContextMenu() {
    if (!this.#stageContextMenuOpen) return
    this.#stageContextMenuOpen = false
    this.#stageContextSubmenu = ''
    this.#renderPreviewOnly()
  }

  #openStageContextMenu(clientX: number, clientY: number) {
    const panel = this.shadowRoot?.querySelector<HTMLElement>('.panel')
    const rect = panel?.getBoundingClientRect()
    if (!rect) return
    this.#stageContextMenuX = Math.max(12, Math.min(rect.width - 180, clientX - rect.left))
    this.#stageContextMenuY = Math.max(12, Math.min(rect.height - 240, clientY - rect.top))
    this.#stageContextMenuOpen = true
    this.#stageContextSubmenu = ''
    this.#renderPreviewOnly()
  }

  #selectionCenter(): Point | null {
    const selectedShapes = this.#selectedShapeIds()
      .map((id) => this.#shapeById(id))
      .filter((shape): shape is Shape => Boolean(shape))
    if (!selectedShapes.length) return null

    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const shape of selectedShapes) {
      const bounds = shapeBounds(shape)
      minX = Math.min(minX, bounds.x)
      minY = Math.min(minY, bounds.y)
      maxX = Math.max(maxX, bounds.x + bounds.width)
      maxY = Math.max(maxY, bounds.y + bounds.height)
    }

    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2
    }
  }

  #transformNativeSelection(action: SelectionTransformAction): boolean {
    const ids = this.#selectedShapeIds()
    if (!ids.length) return false
    const center = this.#selectionCenter()
    if (!center) return false

    for (const id of ids) {
      const shape = this.#shapeById(id)
      if (!shape) continue
      this.#setShape(transformShapeForSelection(shape, center, action))
    }

    this.#pushHistory()
    this.#render()
    return true
  }

  #onStageContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    const shapeElement = event.target instanceof Element ? event.target.closest<SVGElement>('[data-shape-id]') : null
    const shapeId = shapeElement?.dataset.shapeId ?? null

    if (shapeId) {
      if (!this.#selectedIds.has(shapeId)) this.#selectedIds = this.#expandSelectionWithGroup(shapeId)
      this.#selectedId = shapeId
    }

    this.#openStageContextMenu(event.clientX, event.clientY)
  }

  #onStageContextAction = (event: Event) => {
    const target =
      event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-stage-menu-action]') : null
    if (!target) return
    const action = target.dataset.stageMenuAction
    if (!action) return

    if (action === 'toggle-transform') {
      this.#stageContextSubmenu = this.#stageContextSubmenu === 'transform' ? '' : 'transform'
      this.#renderPreviewOnly()
      return
    }

    if (action === 'toggle-arrange') {
      this.#stageContextSubmenu = this.#stageContextSubmenu === 'arrange' ? '' : 'arrange'
      this.#renderPreviewOnly()
      return
    }

    this.#hideStageContextMenu()

    if (action === 'copy') {
      this.#copyNativeSelection()
      return
    }
    if (action === 'paste') {
      this.#pasteNativeClipboard()
      return
    }
    if (action === 'delete') {
      this.#deleteNativeSelection()
      return
    }
    if (action === 'flip-side') {
      this.#onNativeObjectFlipSide()
      return
    }
    if (action === 'group') {
      this.#groupNativeSelection()
      return
    }
    if (action === 'ungroup') {
      this.#ungroupNativeSelection()
      return
    }
    if (
      action === 'flip-horizontal' ||
      action === 'flip-vertical' ||
      action === 'rotate-left' ||
      action === 'rotate-right' ||
      action === 'scale-up' ||
      action === 'scale-down'
    ) {
      this.#transformNativeSelection(action)
    }
  }

  #copyNativeSelection(): boolean {
    const shapes = this.#selectedShapeIds()
      .map((id) => this.#shapeById(id))
      .filter((shape): shape is Shape => Boolean(shape))
      .map((shape) => cloneShape(shape))
    if (!shapes.length) return false
    this.#nativeClipboard = shapes
    void navigator.clipboard
      ?.writeText(JSON.stringify({ kind: 'cadle-native-svg-selection', shapes }))
      .catch(() => undefined)
    return true
  }

  #pasteNativeClipboard(): boolean {
    if (!this.#nativeClipboard.length) return false
    const groupMap = new Map<string, string>()
    const pasted = this.#nativeClipboard.map((shape) => {
      const moved = this.#translateShape(cloneShape(shape), GRID_SIZE, GRID_SIZE)
      const next = { ...moved, id: nextShapeId() } as Shape
      if (moved.groupId) {
        const mapped = groupMap.get(moved.groupId) ?? `group-${nextShapeId()}`
        if (!groupMap.has(moved.groupId)) groupMap.set(moved.groupId, mapped)
        next.groupId = mapped
      }
      return next
    })
    this.#shapes.push(...pasted)
    this.#selectedIds = new Set(pasted.map((shape) => shape.id))
    this.#selectedId = pasted[0]?.id ?? null
    this.#pushHistory()
    this.#render()
    return true
  }

  #deleteNativeSelection(): boolean {
    const ids = new Set(this.#selectedShapeIds())
    if (!ids.size) return false
    this.#shapes = this.#shapes.filter((shape) => !ids.has(shape.id))
    this.#selectedId = null
    this.#selectedIds = new Set()
    this.#pushHistory()
    this.#render()
    return true
  }

  #applyNativeHotkey(action: NativeHotkeyAction): boolean {
    switch (action) {
      case 'undo':
        this.#undo()
        return true
      case 'redo':
        this.#redo()
        return true
      case 'copy':
        return this.#copyNativeSelection()
      case 'cut':
        return this.#copyNativeSelection() && this.#deleteNativeSelection()
      case 'paste':
        return this.#pasteNativeClipboard()
      case 'group':
        return this.#groupNativeSelection()
      case 'ungroup':
        return this.#ungroupNativeSelection()
      case 'scale-up':
        return this.#transformNativeSelection('scale-up')
      case 'scale-down':
        return this.#transformNativeSelection('scale-down')
      case 'select-all':
        this.#selectedIds = new Set(this.#shapes.map((shape) => shape.id))
        this.#selectedId = this.#shapes[0]?.id ?? null
        this.#render()
        return true
      case 'delete':
        return this.#deleteNativeSelection()
      case 'tool-select':
        this.#activateTool('select')
        return true
      case 'tool-wall':
        this.#activateTool('wall')
        return true
      case 'tool-door':
        this.#activateTool('door')
        return true
      case 'tool-window':
        this.#activateTool('window')
        return true
      case 'tool-gate':
        this.#activateTool('gate')
        return true
      case 'tool-line':
        this.#activateTool('line')
        return true
      case 'tool-text':
        this.#activateTool('text')
        return true
      case 'tool-onewire':
        this.#activateTool('onewire')
        return true
      case 'escape':
        return false
    }
  }

  #handleEscapeKey() {
    const action = resolveNativeEscapeAction({
      tool: this.#tool,
      hasPendingCatalogSymbol: Boolean(this.#pendingCatalogSymbol),
      hasSymbolPreviewPoint: Boolean(this.#symbolPreviewPoint),
      hasWallChain: Boolean(this.#wallChain),
      hasDraft: Boolean(this.#draft),
      hasDrag: Boolean(this.#drag),
      selectedId: this.#selectedId,
      selectedCount: this.#selectedIds.size,
      hasBandStart: Boolean(this.#bandStart),
      hasOneWireAnchor: Boolean(this.#oneWireAnchor)
    })

    if (action === 'cancel-symbol') {
      this.#pendingCatalogSymbol = null
      this.#symbolPreviewPoint = null
      this.#tool = 'select'
      this.#render()
      return
    }

    if (action === 'cancel-wall-chain') {
      this.#wallChain = null
      this.#chainPreviewEnd = null
      this.#snapTarget = null
      this.#render()
      return
    }

    if (action === 'cancel-onewire-panel') {
      this.#oneWireAnchor = null
      this.#oneWireLastPoint = null
      this.#oneWireBusBarId = null
      this.#render()
      return
    }

    if (action === 'clear-interaction') {
      this.#draft = null
      this.#drag = null
      this.#selectedId = null
      this.#selectedIds = new Set()
      this.#bandStart = null
      this.#bandEnd = null
      this.#stagePointerId = null
      this.#render()
    }
  }

  // Snap to the nearest wall endpoint within snap radius (world units ≈ screen px).
  #snapToEndpoints(point: Point): { point: Point; snapped: boolean } {
    const SNAP_RADIUS = 20
    let best: Point | null = null
    let bestDist = SNAP_RADIUS
    for (const shape of this.#shapes) {
      if (shape.kind !== 'wall') continue
      for (const ep of [shape.start, shape.end]) {
        const dist = Math.hypot(ep.x - point.x, ep.y - point.y)
        if (dist < bestDist) {
          bestDist = dist
          best = ep
        }
      }
    }
    // Also snap to the chain start itself (for closing a room loop)
    if (this.#wallChain) {
      const dist = Math.hypot(this.#wallChain.startPoint.x - point.x, this.#wallChain.startPoint.y - point.y)
      if (dist < bestDist) {
        bestDist = dist
        best = this.#wallChain.startPoint
      }
    }
    return best ? { point: best, snapped: true } : { point, snapped: false }
  }

  #isElectricalSymbolPath(path: string): boolean {
    const lower = path.toLowerCase()
    return (
      lower.includes('/protection devices/') ||
      lower.includes('/switches/') ||
      lower.includes('/consumption appliances/') ||
      lower.includes('/socket outlets/') ||
      lower.includes('/one-wire/')
    )
  }

  #symbolConnectionPoints(shape: SymbolShape): Point[] {
    return this.#symbolConnectionAnchors(shape).map((anchor) => anchor.point)
  }

  #symbolConnectionAnchors(shape: SymbolShape): Array<{
    side: 'top' | 'bottom' | 'left' | 'right'
    point: Point
  }> {
    if (!this.#isElectricalSymbolPath(shape.path)) return []
    const bounds = shapeBounds(shape)
    const centerX = bounds.x + bounds.width / 2
    const centerY = bounds.y + bounds.height / 2
    return [
      { side: 'top', point: { x: centerX, y: bounds.y } },
      { side: 'bottom', point: { x: centerX, y: bounds.y + bounds.height } },
      { side: 'left', point: { x: bounds.x, y: centerY } },
      { side: 'right', point: { x: bounds.x + bounds.width, y: centerY } }
    ]
  }

  #nearestElectricalAnchor(point: Point): {
    point: Point
    snapped: boolean
    hostSymbol: SymbolShape | null
    side: 'top' | 'bottom' | 'left' | 'right' | null
  } {
    const SNAP_RADIUS = 24
    let best: Point | null = null
    let bestDist = SNAP_RADIUS
    let hostSymbol: SymbolShape | null = null
    let side: 'top' | 'bottom' | 'left' | 'right' | null = null

    for (const shape of this.#shapes) {
      if (shape.kind === 'line' && shape.bindingId) {
        for (const ep of [shape.start, shape.end]) {
          const dist = Math.hypot(ep.x - point.x, ep.y - point.y)
          if (dist < bestDist) {
            bestDist = dist
            best = ep
            hostSymbol = null
            side = null
          }
        }
        continue
      }
      if (shape.kind !== 'symbol') continue
      for (const anchor of this.#symbolConnectionAnchors(shape)) {
        const dist = Math.hypot(anchor.point.x - point.x, anchor.point.y - point.y)
        if (dist < bestDist) {
          bestDist = dist
          best = anchor.point
          hostSymbol = shape
          side = anchor.side
        }
      }
    }

    return best
      ? { point: best, snapped: true, hostSymbol, side }
      : { point, snapped: false, hostSymbol: null, side: null }
  }

  #snapToElectricalPoints(point: Point): { point: Point; snapped: boolean } {
    const nearest = this.#nearestElectricalAnchor(point)
    return { point: nearest.point, snapped: nearest.snapped }
  }

  #oneWireComponentSymbol(kind: 'breaker' | 'switch' | 'load'): { name: string; path: string } {
    if (kind === 'breaker') return { name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }
    if (kind === 'switch') return { name: 'Switch', path: 'symbols/Switches/Switch general symbol.svg' }
    if (this.#oneWirePreset === 'sockets') {
      return { name: 'Socket outlet', path: 'symbols/Socket outlets/Electrical wall outlet.svg' }
    }
    if (this.#oneWirePreset === 'motor') {
      return { name: 'Motor', path: 'symbols/Consumption appliances/Motor.svg' }
    }
    return { name: 'Lighting', path: 'symbols/Consumption appliances/Lighting.svg' }
  }

  #composeOneWireAt(point: Point, useDirectional = false): boolean {
    const anchor = this.#nearestElectricalAnchor(point)
    if (!anchor.snapped || !anchor.hostSymbol || !anchor.side) return false

    // Directional intent: derive attachment side from cursor offset vs host center
    // unless Shift is held (forces nearest anchor side).
    let side = anchor.side
    if (useDirectional) {
      const hostBounds = shapeBounds(anchor.hostSymbol)
      const hostCx = hostBounds.x + hostBounds.width / 2
      const hostCy = hostBounds.y + hostBounds.height / 2
      const dx = point.x - hostCx
      const dy = point.y - hostCy
      if (Math.abs(dy) >= Math.abs(dx)) {
        side = dy < 0 ? 'top' : 'bottom'
      } else {
        side = dx < 0 ? 'left' : 'right'
      }
    }

    const component = this.#oneWireComponentSymbol(this.#oneWireComposeKind)
    const scale = inferSymbolScale(component.path)
    const size = 40 * Math.max(0.4, scale)
    const gap = 24
    const half = size / 2

    const hostAnchors = this.#symbolConnectionAnchors(anchor.hostSymbol)
    const attachAnchor = hostAnchors.find((a) => a.side === side) ?? hostAnchors[0]
    const attachPoint = attachAnchor?.point ?? anchor.point

    const center: Point =
      side === 'top'
        ? { x: attachPoint.x, y: attachPoint.y - (half + gap) }
        : side === 'bottom'
          ? { x: attachPoint.x, y: attachPoint.y + (half + gap) }
          : side === 'left'
            ? { x: attachPoint.x - (half + gap), y: attachPoint.y }
            : { x: attachPoint.x + (half + gap), y: attachPoint.y }

    const newAnchorPoint: Point =
      side === 'top'
        ? { x: center.x, y: center.y + half }
        : side === 'bottom'
          ? { x: center.x, y: center.y - half }
          : side === 'left'
            ? { x: center.x + half, y: center.y }
            : { x: center.x - half, y: center.y }

    const bindingId = anchor.hostSymbol.bindingId ?? this.#oneWireBindingId
    const groupId = anchor.hostSymbol.groupId ?? `onewire-${nextShapeId()}`
    const connector: LineShape = {
      id: nextShapeId(),
      kind: 'line',
      start: attachPoint,
      end: newAnchorPoint,
      bindingId,
      groupId
    }
    const newSymbol: SymbolShape = {
      id: nextShapeId(),
      kind: 'symbol',
      position: center,
      name: component.name,
      path: component.path,
      scale,
      bindingId,
      groupId
    }

    this.#shapes.push(connector, newSymbol)
    this.#selectedId = newSymbol.id
    this.#selectedIds = new Set([connector.id, newSymbol.id])
    return true
  }

  #snapOneWirePoint(point: Point): { point: Point; snapped: boolean } {
    const SNAP_RADIUS = 24
    let bestX = point.x
    let bestY = point.y
    let bestXDist = SNAP_RADIUS
    let bestYDist = SNAP_RADIUS
    let snapType: 'none' | 'x' | 'y' | 'both' = 'none'

    // Snap to existing one-wire circuit X positions (columns) and bus bar Y
    for (const shape of this.#shapes) {
      if (shape.kind === 'symbol' && shape.bindingId) {
        for (const cp of this.#symbolConnectionPoints(shape)) {
          const xDist = Math.abs(cp.x - point.x)
          if (xDist < bestXDist) {
            bestXDist = xDist
            bestX = cp.x
            snapType = snapType === 'y' ? 'both' : 'x'
          }
        }
      }
      // Snap Y to horizontal bus bar lines (lines without binding ID)
      if (shape.kind === 'line' && !shape.bindingId) {
        for (const pt of [shape.start, shape.end]) {
          const yDist = Math.abs(pt.y - point.y)
          if (yDist < bestYDist) {
            bestYDist = yDist
            bestY = pt.y
            snapType = snapType === 'x' ? 'both' : 'y'
          }
        }
      }
    }

    const snapped = snapType !== 'none'
    return {
      point: {
        x: snapType === 'x' || snapType === 'both' ? bestX : point.x,
        y: snapType === 'y' || snapType === 'both' ? bestY : point.y
      },
      snapped
    }
  }

  #setShape(shape: Shape) {
    const index = this.#shapes.findIndex((item) => item?.id === shape.id)
    if (index < 0) return
    this.#shapes[index] = shape
  }

  #setShapes(shapes: Shape[]) {
    if (!shapes.length) return
    const updates = new Map(shapes.map((shape) => [shape.id, shape]))
    this.#shapes = this.#shapes.map((shape) => updates.get(shape.id) ?? shape)
  }

  #shapeMarkup(shape: Shape, selected: boolean, extraClass = ''): string {
    return shapeMarkup(shape, selected, extraClass)
  }

  #shapeTemplate(shape: Shape, selected: boolean, extraClass = '') {
    return shapeTemplate(shape, selected, extraClass)
  }

  #bindingLabelsTemplate() {
    return bindingLabelsTemplate(this.#shapes)
  }

  #selectedOutlineTemplate(shape: Shape | null) {
    return selectedOutlineTemplate(shape)
  }

  #safeAreaTemplate() {
    return safeAreaTemplate(this.#safeAreaRect())
  }

  #rubberBandTemplate() {
    return rubberBandTemplate(this.#bandStart, this.#bandEnd)
  }

  #wallChainPreviewTemplate() {
    return wallChainPreviewTemplate(this.#wallChain, this.#chainPreviewEnd, this.#snapTarget)
  }

  #measurementTemplate(from: Point | null, to: Point | null) {
    return measurementTemplate(from, to)
  }

  #publishNativeSelection(selectedShape: Shape | null) {
    pubsub.publish(
      'native.selection.changed',
      createNativeSelectionChangedPayload(selectedShape, this.#selectedIds.size)
    )
  }

  #selectedOutlineMarkup(shape: Shape | null): string {
    return selectedOutlineMarkup(shape)
  }

  #nativeDocumentState(): NativeDocumentState {
    return {
      version: 1,
      shapes: this.#shapes,
      paperPreset: this.#paperPreset,
      printMargin: this.#printMargin,
      worldWidth: this.#worldWidth,
      worldHeight: this.#worldHeight
    }
  }

  #serialize() {
    return JSON.stringify(this.#nativeDocumentState(), null, 2)
  }

  #download(filename: string, content: string, type: string) {
    downloadTextFile(filename, content, type)
  }

  #paperMeta() {
    return PAPER_PRESETS[this.#paperPreset]
  }

  #buildSvgDocument() {
    return buildSvgDocument({
      shapes: this.#shapes,
      selectedShape: this.#shapeById(this.#selectedId),
      paper: this.#paperMeta(),
      worldWidth: this.#worldWidth,
      worldHeight: this.#worldHeight
    })
  }

  #safeAreaRect() {
    return safeAreaRect(this.#paperMeta(), this.#printMargin, this.#worldWidth, this.#worldHeight)
  }

  #exportSvg() {
    this.#download(`cadle-${this.#paperPreset}.svg`, this.#buildSvgDocument(), 'image/svg+xml;charset=utf-8')
  }

  async #exportPdf() {
    const exported = await this.exportA4PNG('auto')
    savePdfFromPng(`cadle-${this.#paperPreset}.pdf`, exported)
  }

  #printSvg() {
    const paper = this.#paperMeta()
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1200,height=900')
    if (!printWindow) return

    const svg = this.#buildSvgDocument()
    printWindow.document.write(`<!doctype html>
<html>
  <head>
    <title>Cadle Print</title>
    <style>
      @page {
        size: ${paper.widthMm}mm ${paper.heightMm}mm;
        margin: 0;
      }
      html, body {
        margin: 0;
        padding: 0;
        width: ${paper.widthMm}mm;
        height: ${paper.heightMm}mm;
        overflow: hidden;
        background: white;
      }
      svg {
        display: block;
        width: ${paper.widthMm}mm;
        height: ${paper.heightMm}mm;
      }
    </style>
  </head>
  <body>${svg}</body>
</html>`)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  #importJson(file: File) {
    file.text().then((text) => {
      try {
        const parsed = JSON.parse(text) as unknown
        const nativeShapes =
          parsed && typeof parsed === 'object' && 'shapes' in parsed ? (parsed as { shapes?: unknown }).shapes : null
        const migrated =
          migrateLegacyProjectToNativeState(parsed, this.#pageKey ?? undefined) ??
          migrateLegacySchemaToNativeState(parsed)

        if (Array.isArray(nativeShapes)) this.#applyPersistedState({ shapes: nativeShapes })
        else if (migrated) this.#applyPersistedState(migrated)
        else return
        this.#selectedId = null
        this.#draft = null
        this.#drag = null
        this.#pushHistory()
        this.#persist()
        this.#render()
      } catch {
        window.alert('Invalid JSON file')
      }
    })
  }

  #buildWallMask(): string {
    return buildWallMask(this.#shapes, this.#worldWidth, this.#worldHeight)
  }

  render() {
    const selectedShape = this.#shapeById(this.#selectedId)
    const paper = this.#paperMeta()
    const worldTransform = `translate(${this.#panX} ${this.#panY}) scale(${this.#zoom})`
    const gridTransform = `translate(${this.#panX}px,${this.#panY}px) scale(${this.#zoom})`
    const cursor = this.#isPanning || this.#spaceDown ? 'grab' : 'default'
    const hint =
      this.#tool === 'symbol' && this.#pendingCatalogSymbol
        ? `Click to place ${this.#pendingCatalogSymbol.name} · Esc to cancel`
        : this.#wallChain
          ? 'Click to add wall · Double-click or Esc to end'
          : this.#draft
            ? 'Release to commit shape'
            : this.#tool === 'onewire' && this.#oneWireAnchor
              ? `Click to add circuit ${this.#oneWireBindingId} · or hover anchor + click to append ${this.#oneWireComposeKind} (Shift = force nearest side) · Esc for new panel`
              : this.#tool === 'onewire'
                ? `Click to start panel — circuit ${this.#oneWireBindingId} · or hover anchor + click to append ${this.#oneWireComposeKind}`
                : `${this.#toolLabel(this.#tool)} · ${paper.label} · ${this.#shapes.length} shapes`

    return html`
      <div class="canvas-host">
        <div class="stage-shell">
          <div class="panel">
            <div
              class="grid"
              style="transform: ${gridTransform}; transform-origin: 0 0"></div>
            <svg
              class="stage"
              style="cursor: ${cursor}"
              @pointerdown=${this.#onPointerDown}
              @pointermove=${this.#onPointerMove}
              @pointerup=${this.#onPointerUp}
              @pointercancel=${this.#onPointerUp}
              @contextmenu=${this.#onStageContextMenu}>
              <defs>${this.#wallMaskTemplate()}</defs>
              <g
                class="world"
                transform=${worldTransform}>
                ${this.#committedTemplate(selectedShape)} ${this.#previewTemplate()}
              </g>
            </svg>
            ${this.#stageContextMenuOpen
              ? html`
                  <div
                    class="stage-context-menu"
                    ?open=${this.#stageContextMenuOpen}
                    style="left: ${this.#stageContextMenuX}px; top: ${this.#stageContextMenuY}px"
                    @click=${this.#onStageContextAction}>
                    <button
                      class="stage-context-menu-item"
                      data-stage-menu-action="copy">
                      Copy
                    </button>
                    <button
                      class="stage-context-menu-item"
                      data-stage-menu-action="paste"
                      ?disabled=${!this.#nativeClipboard.length}>
                      Paste
                    </button>
                    <button
                      class="stage-context-menu-item"
                      data-stage-menu-action="delete"
                      ?disabled=${!this.#selectedShapeIds().length}>
                      Delete
                    </button>
                    <button
                      class="stage-context-menu-item"
                      data-stage-menu-action="toggle-transform">
                      Transform
                    </button>
                    ${this.#stageContextSubmenu === 'transform'
                      ? html`
                          <button
                            class="stage-context-menu-item stage-context-subitem"
                            data-stage-menu-action="flip-horizontal"
                            ?disabled=${!this.#selectedShapeIds().length}>
                            Flip horizontal
                          </button>
                          <button
                            class="stage-context-menu-item stage-context-subitem"
                            data-stage-menu-action="flip-vertical"
                            ?disabled=${!this.#selectedShapeIds().length}>
                            Flip vertical
                          </button>
                          <button
                            class="stage-context-menu-item stage-context-subitem"
                            data-stage-menu-action="rotate-left"
                            ?disabled=${!this.#selectedShapeIds().length}>
                            Rotate left
                          </button>
                          <button
                            class="stage-context-menu-item stage-context-subitem"
                            data-stage-menu-action="rotate-right"
                            ?disabled=${!this.#selectedShapeIds().length}>
                            Rotate right
                          </button>
                          <button
                            class="stage-context-menu-item stage-context-subitem"
                            data-stage-menu-action="scale-up"
                            ?disabled=${!this.#selectedShapeIds().length}>
                            Scale up
                          </button>
                          <button
                            class="stage-context-menu-item stage-context-subitem"
                            data-stage-menu-action="scale-down"
                            ?disabled=${!this.#selectedShapeIds().length}>
                            Scale down
                          </button>
                        `
                      : nothing}
                    <button
                      class="stage-context-menu-item"
                      data-stage-menu-action="toggle-arrange">
                      Arrange
                    </button>
                    ${this.#stageContextSubmenu === 'arrange'
                      ? html`
                          <button
                            class="stage-context-menu-item stage-context-subitem"
                            data-stage-menu-action="group"
                            ?disabled=${this.#selectedShapeIds().length < 2}>
                            Group
                          </button>
                          <button
                            class="stage-context-menu-item stage-context-subitem"
                            data-stage-menu-action="ungroup"
                            ?disabled=${!this.#selectedGroupIds().length}>
                            Ungroup
                          </button>
                        `
                      : nothing}
                    <button
                      class="stage-context-menu-item"
                      data-stage-menu-action="flip-side"
                      ?disabled=${!(selectedShape && (selectedShape.kind === 'door' || selectedShape.kind === 'gate'))}>
                      Flip side
                    </button>
                  </div>
                `
              : nothing}
          </div>
        </div>
        <div
          class="native-controls"
          @click=${this.#onClick}>
          <div class="nc-group">
            <span class="nc-label">Paper</span>
            <button
              class="nc-btn"
              data-paper="a4-portrait"
              data-active=${this.#paperPreset === 'a4-portrait'}>
              A4↑
            </button>
            <button
              class="nc-btn"
              data-paper="a4-landscape"
              data-active=${this.#paperPreset === 'a4-landscape'}>
              A4→
            </button>
            <button
              class="nc-btn"
              data-paper="a3-portrait"
              data-active=${this.#paperPreset === 'a3-portrait'}>
              A3↑
            </button>
            <button
              class="nc-btn"
              data-paper="a3-landscape"
              data-active=${this.#paperPreset === 'a3-landscape'}>
              A3→
            </button>
          </div>
          <div class="nc-group">
            <span class="nc-label">Margin</span>
            <button
              class="nc-btn"
              data-action="margin-dec">
              −
            </button>
            <span class="nc-value">${this.#printMargin} mm</span>
            <button
              class="nc-btn"
              data-action="margin-inc">
              +
            </button>
          </div>
          <div class="nc-group">
            <span class="nc-label">One-wire</span>
            ${Object.entries(ONE_WIRE_PRESETS).map(
              ([preset, config]) => html`
                <button
                  class="nc-btn"
                  data-onewire-preset=${preset}
                  data-active=${this.#oneWirePreset === preset}>
                  ${config.label}
                </button>
              `
            )}
            <button
              class="nc-btn"
              data-action="onewire-next">
              Circuit ${this.#oneWireBindingId}
            </button>
            <button
              class="nc-btn"
              data-onewire-compose="breaker"
              data-active=${this.#oneWireComposeKind === 'breaker'}>
              + Breaker
            </button>
            <button
              class="nc-btn"
              data-onewire-compose="switch"
              data-active=${this.#oneWireComposeKind === 'switch'}>
              + Switch
            </button>
            <button
              class="nc-btn"
              data-onewire-compose="load"
              data-active=${this.#oneWireComposeKind === 'load'}>
              + Load
            </button>
            ${this.#oneWireAnchor
              ? html`<button
                  class="nc-btn"
                  data-action="onewire-reset-panel"
                  title="Start a new panel column (Esc)">
                  New panel
                </button>`
              : nothing}
          </div>
          <div class="nc-spacer"></div>
          <div class="nc-group">
            <details class="nc-download">
              <summary class="nc-btn">Download</summary>
              <div class="nc-download-menu">
                <button
                  class="nc-btn"
                  data-action="export-json">
                  JSON
                </button>
                <button
                  class="nc-btn"
                  data-action="export-pdf">
                  PDF
                </button>
              </div>
            </details>
            <button
              class="nc-btn"
              data-action="print-svg">
              Print
            </button>
            <button
              class="nc-btn"
              data-action="import-json">
              ↑ JSON
            </button>
            <button
              class="nc-btn nc-danger"
              data-action="clear">
              Clear
            </button>
          </div>
        </div>
        <footer class="status"><span>${hint}</span></footer>
        <input
          class="file-input"
          type="file"
          accept="application/json"
          hidden
          @change=${this.#onImportChange} />
      </div>
    `
  }

  #hasWallOpenings(): boolean {
    return this.#shapes.some((shape) => shape.kind === 'door' || shape.kind === 'window' || shape.kind === 'gate')
  }

  #wallMaskTemplate() {
    return wallMaskTemplate(this.#shapes, this.#worldWidth, this.#worldHeight)
  }

  #committedTemplate(selectedShape: Shape | null) {
    const wallShapes = this.#shapes.filter((shape) => shape.kind === 'wall')
    const restShapes = this.#shapes.filter((shape) => shape.kind !== 'wall')
    const wallMask = this.#hasWallOpenings() ? 'url(#wall-opening-mask)' : nothing
    return svg`
      ${this.#safeAreaTemplate()}
      <g mask=${wallMask}>
        ${repeat(
          wallShapes,
          (shape) => shape.id,
          (shape) => this.#shapeTemplate(shape, shape.id === this.#selectedId || this.#selectedIds.has(shape.id))
        )}
      </g>
      ${repeat(
        restShapes,
        (shape) => shape.id,
        (shape) => this.#shapeTemplate(shape, shape.id === this.#selectedId || this.#selectedIds.has(shape.id))
      )}
      ${this.#bindingLabelsTemplate()}
      ${this.#selectedOutlineTemplate(selectedShape)}
    `
  }

  #previewTemplate() {
    const symbolPreviewShape: SymbolShape | null =
      this.#tool === 'symbol' && this.#pendingCatalogSymbol && this.#symbolPreviewPoint
        ? {
            id: '__symbol-preview__',
            kind: 'symbol',
            position: this.#symbolPreviewPoint,
            name: this.#pendingCatalogSymbol.name,
            path: this.#pendingCatalogSymbol.path,
            scale: inferSymbolScale(this.#pendingCatalogSymbol.path)
          }
        : null
    return svg`
      ${this.#draft ? this.#shapeTemplate(this.#draft, false, 'draft') : nothing}
      ${symbolPreviewShape ? this.#shapeTemplate(symbolPreviewShape, false, 'symbol-preview') : nothing}
      ${this.#wallChainPreviewTemplate()}
      ${this.#draft ? this.#measurementTemplate(this.#draft.start, this.#draft.end) : nothing}
      ${this.#wallChain ? this.#measurementTemplate(this.#wallChain.startPoint, this.#chainPreviewEnd) : nothing}
      ${this.#rubberBandTemplate()}
    `
  }

  #render() {
    this.#publishNativeSelection(this.#shapeById(this.#selectedId))
    this.requestRender()
  }

  #renderPreviewOnly() {
    this.requestRender()
  }

  #toolLabel(tool: Tool): string {
    switch (tool) {
      case 'select':
        return 'Select'
      case 'wall':
        return 'Wall'
      case 'line':
        return 'Line'
      case 'door':
        return 'Door'
      case 'window':
        return 'Window'
      case 'gate':
        return 'Gate'
      case 'rect':
        return 'Box'
      case 'circle':
        return 'Circle'
      case 'arc':
        return 'Arc'
      case 'text':
        return 'Text'
      case 'symbol':
        return 'Symbol'
      case 'onewire':
        return `One-wire ${this.#oneWireBindingId}`
    }
  }

  #nextOneWireBindingId(): string {
    return nextOneWireBindingId(this.#oneWireBindingId, this.#oneWirePreset)
  }

  #advanceOneWireBinding() {
    this.#oneWireBindingId = this.#nextOneWireBindingId()
    this.#render()
  }

  #onClick = (event: Event) => {
    const target = event.target instanceof HTMLElement ? event.target : null

    const paperButton = target?.closest<HTMLElement>('[data-paper]')
    if (paperButton) {
      const preset = paperButton.dataset.paper as PaperPreset | undefined
      if (preset && preset in PAPER_PRESETS) {
        this.#paperPreset = preset
        this.#persist()
        this.#render()
      }
      return
    }

    const oneWirePresetButton = target?.closest<HTMLElement>('[data-onewire-preset]')
    if (oneWirePresetButton) {
      const preset = oneWirePresetButton.dataset.onewirePreset as OneWirePreset | undefined
      if (preset && preset in ONE_WIRE_PRESETS) {
        this.#oneWirePreset = preset
        this.#render()
      }
      return
    }

    const oneWireComposeButton = target?.closest<HTMLElement>('[data-onewire-compose]')
    if (oneWireComposeButton) {
      const next = oneWireComposeButton.dataset.onewireCompose
      if (next === 'breaker' || next === 'switch' || next === 'load') {
        this.#oneWireComposeKind = next
        this.#render()
      }
      return
    }

    const actionButton = target?.closest<HTMLElement>('[data-action]')
    if (!actionButton) return
    actionButton.closest<HTMLDetailsElement>('.nc-download')?.removeAttribute('open')

    switch (actionButton.dataset.action) {
      case 'undo':
        this.#undo()
        return
      case 'redo':
        this.#redo()
        return
      case 'toggle-snap':
        this.#snap = !this.#snap
        this.#render()
        return
      case 'export-json':
        this.#download('cadle-drawing.json', this.#serialize(), 'application/json;charset=utf-8')
        return
      case 'export-pdf':
        void this.#exportPdf().catch(() => window.alert('Unable to export PDF'))
        return
      case 'import-json':
        this.shadowRoot?.querySelector<HTMLInputElement>('.file-input')?.click()
        return
      case 'export-svg':
        this.#exportSvg()
        return
      case 'print-svg':
        this.#printSvg()
        return
      case 'margin-inc':
        this.#printMargin = Math.min(this.#printMargin + 1, 50)
        this.#persist()
        this.#render()
        return
      case 'onewire-next':
        this.#advanceOneWireBinding()
        return
      case 'onewire-reset-panel':
        this.#oneWireAnchor = null
        this.#oneWireLastPoint = null
        this.#oneWireBusBarId = null
        this.#render()
        return
      case 'margin-dec':
        this.#printMargin = Math.max(this.#printMargin - 1, 0)
        this.#persist()
        this.#render()
        return
      case 'clear':
        if (!window.confirm('Clear the drawing?')) return
        this.#shapes = []
        this.#selectedId = null
        this.#draft = null
        this.#drag = null
        this.#pushHistory()
        this.#render()
        return
    }
  }

  #onImportChange = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    const file = input?.files?.[0]
    if (file) this.#importJson(file)
  }

  #onPointerDown = (event: PointerEvent) => {
    this.#hideStageContextMenu()
    const stage = event.currentTarget as SVGSVGElement

    // Space-drag pan: always takes priority
    if (this.#spaceDown && event.button === 0) {
      const panel = this.shadowRoot?.querySelector<HTMLElement>('.panel')
      const rect = panel?.getBoundingClientRect()
      if (rect) {
        this.#isPanning = true
        this.#panStart = {
          px: event.clientX - rect.left,
          py: event.clientY - rect.top,
          panX: this.#panX,
          panY: this.#panY
        }
        this.#stagePointerId = event.pointerId
        ;(stage as SVGSVGElement).setPointerCapture(event.pointerId)
      }
      return
    }

    const rawPoint = this.#pointFromEvent(event)
    if (!rawPoint) return

    const shapeElement = event.target instanceof Element ? event.target.closest<SVGElement>('[data-shape-id]') : null
    let shapeId = shapeElement?.dataset.shapeId ?? null
    shapeId ??= this.#shapeIdAtPoint(rawPoint)

    const isAdditiveSelection = (event.metaKey || event.ctrlKey) && event.button === 0

    if (shapeId && isAdditiveSelection && !(this.#tool === 'symbol' && this.#pendingCatalogSymbol)) {
      const expanded = this.#expandSelectionWithGroup(shapeId)
      const next = new Set(this.#selectedIds.size ? this.#selectedIds : this.#selectedId ? [this.#selectedId] : [])
      const shouldRemove = [...expanded].every((id) => next.has(id))

      if (shouldRemove) {
        for (const id of expanded) next.delete(id)
      } else {
        for (const id of expanded) next.add(id)
      }

      this.#selectedIds = next
      this.#selectedId = next.values().next().value ?? null
      this.#drag = null
      this.#bandStart = null
      this.#bandEnd = null
      this.#stagePointerId = null
      this.#render()
      return
    }

    if (shapeId && event.button === 0 && !(this.#tool === 'symbol' && this.#pendingCatalogSymbol)) {
      const expanded = this.#expandSelectionWithGroup(shapeId)
      this.#selectedIds = expanded
      this.#selectedId = shapeId
      const dragIds = [...expanded]
      const initial = dragIds
        .map((id) => this.#shapeById(id))
        .filter((shape): shape is Shape => Boolean(shape))
        .map((shape) => cloneShape(shape))
      this.#drag = {
        ids: dragIds,
        pointerStart: rawPoint,
        initial
      }
      this.#bandStart = null
      this.#bandEnd = null
      this.#stagePointerId = event.pointerId
      stage.setPointerCapture(event.pointerId)
      this.#render()
      return
    }

    if (this.#tool === 'text') {
      const value = window.prompt('Text', 'Label')?.trim()
      if (!value) return
      this.#shapes.push(createTextShape(nextShapeId(), rawPoint, value))
      this.#selectedId = this.#shapes[this.#shapes.length - 1]?.id ?? null
      this.#pushHistory()
      this.#render()
      return
    }

    if (this.#tool === 'symbol' && event.button === 0 && this.#pendingCatalogSymbol) {
      const gridSnapped = this.#snapPoint(rawPoint)
      const { point } = this.#snapToElectricalPoints(gridSnapped)
      const shape = createSymbolShape(nextShapeId(), point, this.#pendingCatalogSymbol)
      this.#shapes.push(shape)
      this.#selectedId = shape.id
      this.#selectedIds = new Set([shape.id])
      this.#symbolPreviewPoint = point
      this.#pendingCatalogSymbol = null
      this.#pushHistory()
      this.#render()
      return
    }

    if (this.#tool === 'onewire') {
      if (event.button !== 0) return

      const electricalPoint = this.#snapToElectricalPoints(this.#snapPoint(rawPoint)).point
      // useDirectional=true: placement side derived from cursor direction; Shift forces nearest anchor side
      if (this.#composeOneWireAt(electricalPoint, !event.shiftKey)) {
        this.#pushHistory()
        this.#render()
        return
      }

      // Auto-stack: first click sets the panel anchor; subsequent clicks place to the right.
      let placementPoint: Point
      if (this.#oneWireAnchor !== null && this.#oneWireLastPoint !== null) {
        const nextPoint: Point = {
          x: this.#oneWireLastPoint.x + ONE_WIRE_CIRCUIT_SPACING,
          y: this.#oneWireAnchor.y
        }
        const { point: snappedPoint } = this.#snapOneWirePoint(nextPoint)
        placementPoint = snappedPoint
      } else {
        const gridSnapped = this.#snapPoint(rawPoint)
        const { point: snappedPoint } = this.#snapOneWirePoint(gridSnapped)
        placementPoint = snappedPoint
        this.#oneWireAnchor = placementPoint
      }

      const onewire = resolveOneWirePointerDown({
        button: 0,
        point: placementPoint,
        bindingId: this.#oneWireBindingId,
        preset: ONE_WIRE_PRESETS[this.#oneWirePreset],
        nextId: nextShapeId,
        breakerWidth: ONE_WIRE_BREAKER_WIDTH,
        nodeSize: ONE_WIRE_NODE_SIZE,
        nextBindingId: (current) => nextOneWireBindingId(current, this.#oneWirePreset)
      })
      if (!onewire) return

      this.#shapes.push(...onewire.shapes)
      this.#selectedId = onewire.selectedId
      this.#selectedIds = onewire.selectedIds
      this.#oneWireBindingId = onewire.nextBindingId
      this.#oneWireLastPoint = placementPoint

      // Draw / extend the horizontal bus bar across all circuit top connections.
      if (this.#oneWireAnchor && this.#oneWireAnchor.x !== placementPoint.x) {
        const busY = this.#oneWireAnchor.y
        const busStart: Point = { x: this.#oneWireAnchor.x, y: busY }
        const busEnd: Point = { x: placementPoint.x, y: busY }
        const existing = this.#oneWireBusBarId ? this.#shapeById(this.#oneWireBusBarId) : null
        if (existing?.kind === 'line') {
          this.#setShape({ ...existing, end: busEnd } as LineShape)
        } else {
          const busBarId = nextShapeId()
          this.#oneWireBusBarId = busBarId
          this.#shapes.push({ id: busBarId, kind: 'line', start: busStart, end: busEnd } as LineShape)
        }
      }

      this.#pushHistory()
      this.#render()
      return
    }

    if (this.#tool === 'select' || (this.#tool === 'symbol' && !this.#pendingCatalogSymbol)) {
      const selectResult = resolveSelectPointerDownState({
        shapeId,
        rawPoint,
        selectedIds: this.#selectedIds,
        selectedId: this.#selectedId,
        shapes: this.#shapes,
        pointerId: event.pointerId
      })
      if (shapeId) {
        const expanded = this.#expandSelectionWithGroup(shapeId)
        this.#selectedIds = expanded
        this.#selectedId = shapeId
        const dragIds = [...expanded]
        const initial = dragIds
          .map((id) => this.#shapeById(id))
          .filter((shape): shape is Shape => Boolean(shape))
          .map((shape) => cloneShape(shape))
        this.#drag = {
          ids: dragIds,
          pointerStart: rawPoint,
          initial
        }
        this.#bandStart = null
        this.#bandEnd = null
        this.#stagePointerId = event.pointerId
      } else {
        this.#selectedIds = selectResult.selectedIds
        this.#selectedId = selectResult.selectedId
        this.#drag = selectResult.drag
        this.#bandStart = selectResult.bandStart
        this.#bandEnd = selectResult.bandEnd
        this.#stagePointerId = selectResult.stagePointerId
      }
      ;(stage as SVGSVGElement).setPointerCapture(event.pointerId)
      this.#render()
      return
    }

    if (this.#tool === 'wall') {
      // Apply grid snap first, then endpoint snap (endpoint wins).
      const gridSnapped = this.#snapPoint(rawPoint)
      const { point, snapped } = this.#snapToEndpoints(gridSnapped)
      const wallResult = resolveWallPointerDown({
        button: event.button,
        point,
        snapped,
        now: Date.now(),
        lastWallClickTime: this.#lastWallClickTime,
        lastWallClickPoint: this.#lastWallClickPoint,
        wallChain: this.#wallChain,
        nextId: nextShapeId
      })
      if (!wallResult) return
      this.#snapTarget = wallResult.snapTarget
      this.#lastWallClickTime = wallResult.lastWallClickTime
      this.#lastWallClickPoint = wallResult.lastWallClickPoint
      this.#wallChain = wallResult.wallChain
      this.#chainPreviewEnd = wallResult.chainPreviewEnd
      if (wallResult.committedWall) {
        this.#shapes.push(wallResult.committedWall)
        this.#selectedId = wallResult.committedWall.id
        this.#pushHistory()
      }
      this.#render()
      return
    }

    if (event.button !== 0) return
    const gridSnapped = this.#snapPoint(rawPoint)
    const point = this.#tool === 'line' ? this.#snapToElectricalPoints(gridSnapped).point : gridSnapped
    this.#draft = createDraftShape(nextShapeId(), point, this.#tool)
    this.#stagePointerId = event.pointerId
    ;(stage as SVGSVGElement).setPointerCapture(event.pointerId)
    this.#render()
  }

  #onPointerMove = (event: PointerEvent) => {
    // Space-drag pan
    if (this.#isPanning && this.#panStart && this.#stagePointerId === event.pointerId) {
      const panel = this.shadowRoot?.querySelector<HTMLElement>('.panel')
      const rect = panel?.getBoundingClientRect()
      if (rect) {
        const px = event.clientX - rect.left
        const py = event.clientY - rect.top
        const next = nextPanFromPointer(this.#panStart, px, py)
        this.#panX = next.panX
        this.#panY = next.panY
        this.#renderPreviewOnly()
      }
      return
    }

    const rawPoint = this.#pointFromEvent(event)
    if (!rawPoint) return
    pubsub.publish('shell.pointer', rawPoint)

    const drag = this.#drag
    if (drag && this.#stagePointerId === event.pointerId) {
      const movedShapes = applyDragMove(rawPoint, drag, (point) => this.#snapPoint(point), this.#shapes)
      this.#setShapes(movedShapes)
      this.#render()
      return
    }

    if (this.#tool === 'symbol' && this.#pendingCatalogSymbol) {
      const symbolPreview = updateSymbolPreviewPoint(
        rawPoint,
        this.#symbolPreviewPoint,
        (point) => this.#snapToElectricalPoints(this.#snapPoint(point)).point,
        samePoint
      )
      if (!symbolPreview.changed) return
      this.#symbolPreviewPoint = symbolPreview.nextPreview
      this.#renderPreviewOnly()
      return
    }

    // Rubber-band update
    if (this.#bandStart && this.#stagePointerId === event.pointerId) {
      this.#bandEnd = rawPoint
      this.#renderPreviewOnly()
      return
    }

    // Wall chain: update live preview with snap
    if (this.#tool === 'wall' && this.#wallChain) {
      const wallPreview = updateWallChainPreview(
        rawPoint,
        (point) => this.#snapPoint(point),
        (point) => this.#snapToEndpoints(point)
      )
      this.#chainPreviewEnd = wallPreview.chainPreviewEnd
      this.#snapTarget = wallPreview.snapTarget
      this.#renderPreviewOnly()
      return
    }

    // One-wire: show snap preview
    if (this.#tool === 'onewire') {
      const electrical = this.#nearestElectricalAnchor(this.#snapPoint(rawPoint))
      if (electrical.snapped) {
        this.#snapTarget = electrical.point
        this.#renderPreviewOnly()
        return
      }

      let previewPoint: Point
      if (this.#oneWireAnchor !== null && this.#oneWireLastPoint !== null) {
        const nextPoint: Point = {
          x: this.#oneWireLastPoint.x + ONE_WIRE_CIRCUIT_SPACING,
          y: this.#oneWireAnchor.y
        }
        const { point: snappedPoint } = this.#snapOneWirePoint(nextPoint)
        previewPoint = snappedPoint
      } else {
        const gridSnapped = this.#snapPoint(rawPoint)
        const { point: snappedPoint } = this.#snapOneWirePoint(gridSnapped)
        previewPoint = snappedPoint
      }
      this.#snapTarget = previewPoint
      this.#renderPreviewOnly()
      return
    }

    if (this.#draft && this.#stagePointerId === event.pointerId) {
      this.#draft = updateDraftShapeEnd(
        this.#draft,
        rawPoint,
        (point) => {
          const gridSnapped = this.#snapPoint(point)
          if (this.#draft?.kind !== 'line') return gridSnapped
          return this.#snapToElectricalPoints(gridSnapped).point
        },
        event.shiftKey
      )
      this.#renderPreviewOnly()
      return
    }
  }

  #translateShape(shape: Shape, dx: number, dy: number): Shape {
    return translateShape(shape, dx, dy)
  }

  #onPointerUp = (event: PointerEvent) => {
    const stage = event.currentTarget as SVGSVGElement
    if (this.#stagePointerId !== event.pointerId) return

    const phase = resolvePointerUpPhase({
      isPanning: this.#isPanning,
      hasBand: Boolean(this.#bandStart && this.#bandEnd),
      hasDraft: Boolean(this.#draft),
      hasDrag: Boolean(this.#drag)
    })

    if (phase === 'pan') {
      this.#isPanning = false
      this.#panStart = null
      this.#stagePointerId = null
      if (stage?.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId)
      this.#render()
      return
    }

    if (phase === 'band' && this.#bandStart && this.#bandEnd) {
      const ids = this.#shapesInBand(this.#bandStart, this.#bandEnd)
      this.#selectedIds = new Set(ids)
      this.#selectedId = ids[0] ?? null
      this.#bandStart = null
      this.#bandEnd = null
      this.#stagePointerId = null
      if (stage?.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId)
      this.#render()
      return
    }

    if (phase === 'draft' && this.#draft) {
      if (canCommitDraft(this.#draft)) {
        this.#shapes.push(cloneShape(this.#draft))
        this.#selectedId = this.#draft.id
        this.#selectedIds = new Set([this.#draft.id])
        this.#pushHistory()
      }
      this.#draft = null
      this.#stagePointerId = null
      if (stage?.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId)
      this.#render()
      return
    }

    if (phase === 'drag' && this.#drag) {
      this.#pushHistory()
      this.#drag = null
      this.#stagePointerId = null
      if (stage?.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId)
      this.#render()
    }
  }

  #onKeyDown = (event: KeyboardEvent) => {
    if (isEditableKeyboardEvent(event)) return

    if (event.key === 'Escape' && this.#stageContextMenuOpen) {
      this.#hideStageContextMenu()
      return
    }

    if (event.code === 'Space' && !this.#spaceDown) {
      this.#spaceDown = true
      this.#render()
      return
    }

    const nativeHotkeyAction = getNativeHotkeyAction(event)
    if (nativeHotkeyAction && nativeHotkeyAction !== 'escape') {
      const handled = this.#applyNativeHotkey(nativeHotkeyAction)
      if (handled) event.preventDefault()
      return
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) {
        this.#redo()
      } else {
        this.#undo()
      }
      return
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      this.#redo()
      return
    }

    if (event.key === 'Escape') {
      this.#handleEscapeKey()
      return
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && (this.#selectedId || this.#selectedIds.size > 0)) {
      event.preventDefault()
      this.#deleteNativeSelection()
    }
  }
}
