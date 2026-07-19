import { LiteElement, html, customElement } from '@vandeurenglenn/lite'
import { nothing, svg } from 'lit'
import { unsafeSVG } from 'lit/directives/unsafe-svg.js'
import { repeat } from 'lit/directives/repeat.js'
import jsPDF from 'jspdf'
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
import type { Project, UUID } from './types.js'
import { setProjectData } from './api/project.js'
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
  buildProjectTitleBlockMarkup,
  getProjectLogoBounds,
  getProjectTitleBlockBounds,
  isProjectLogoVisible,
  PROJECT_LOGO_SHAPE_ID
} from './native-app/project-title-block.js'
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
import {
  oneWireSymbolNodeInfo,
  oneWireSymbolRotationFor,
  oneWireSymbolScaleFor
} from './native-app/onewire-symbol-nodes.js'
import { nextPanFromPointer } from './native-app/pointer-pan.js'
import { canCommitDraft, resolvePointerUpPhase } from './native-app/pointer-up.js'
import {
  resolveSelectPointerDownState,
  resolveOneWirePointerDown,
  resolveWallPointerDown
} from './native-app/pointer-down.js'
import { applyDragMove, updateDraftShapeEnd, updateWallChainPreview } from './native-app/pointer-move.js'
import { resolveNativeEscapeAction } from './native-app/keyboard.js'
import { createDraftShape, createSymbolShape, createTextShape } from './native-app/pointer-down-builders.js'
import { createNativeSelectionChangedPayload } from './native-app/selection-payload.js'
import { transformShapeForSelection, type SelectionTransformAction } from './native-app/selection-transforms.js'
import { getCachedSymbolSvg, isSymbolSvgLoading, preloadSymbolSvg } from './native-app/symbol-svg-cache.js'
import {
  ensureCustomCatalogLoaded,
  getStoredCustomCategories,
  getStoredCustomFolders,
  getStoredCustomSymbols,
  setStoredCustomSymbols
} from './shell/custom-symbols.js'
import {
  ensureCatalogSymbolOverridesLoaded,
  getCatalogSymbolStyleDefaults,
  setStoredCatalogSymbolStyleDefaults
} from './shell/catalog-symbol-overrides.js'

type SnapIndicatorKind = 'wall' | 'electrical' | 'onewire'
type BindingLabelSide = 'left' | 'right' | 'top' | 'bottom'

type CatalogDialogMode = 'add' | 'replace'

type CatalogDialogCategoryOption = {
  folder?: string
  name: string
}

type CatalogDialogReplaceOption = {
  path: string
  name: string
  category: string
  folder?: string
}

// Arrow-key nudge distances: default 5px, Alt+Arrow precision 1px, Shift+Arrow full grid.
const NUDGE_STEP = 5
const NUDGE_PRECISION_STEP = 1
const WHEEL_ROTATE_DEGREES_PER_DELTA = 0.12
const WHEEL_SCALE_PER_DELTA = 0.0025
const WHEEL_ROTATE_SNAP_DEGREES = 15
const WHEEL_GESTURE_IDLE_MS = 180

// Minimum drag distance (scene units) before a symbol placement gesture starts rotating.
const SYMBOL_PLACEMENT_ROTATE_THRESHOLD = 6
const KAMRAIL_HALF_LENGTH = 420
const KAMRAIL_STROKE_WIDTH = 10
const KAMRAIL_ATTACH_OFFSET = 72
const KAMRAIL_AUTO_COMPONENT_SPACING = 120
const ONEWIRE_SYMBOL_SCALE_MULTIPLIER = 1.7
const ONEWIRE_BRANCH_STROKE = '#000000'

const getBindingLabelNearMargin = (shape: Shape): number => (shape.kind === 'symbol' ? 2 : 5)

type OpticalInsets = { left: number; right: number; top: number; bottom: number }

const symbolOpticalInsetsCache = new Map<string, OpticalInsets | null>()
const symbolMeasurementHostId = 'cadle-symbol-measurement-host'

const parseViewBox = (viewBox: string): { minX: number; minY: number; width: number; height: number } | null => {
  const parts = viewBox
    .trim()
    .split(/\s+/)
    .map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return null
  const [minX, minY, width, height] = parts
  if (width <= 0 || height <= 0) return null
  return { minX, minY, width, height }
}

const getSymbolMeasurementHost = (): SVGSVGElement | null => {
  if (typeof document === 'undefined') return null
  const existing = document.getElementById(symbolMeasurementHostId)
  if (existing && existing instanceof SVGSVGElement) return existing

  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  host.id = symbolMeasurementHostId
  host.setAttribute('aria-hidden', 'true')
  host.style.position = 'absolute'
  host.style.left = '-10000px'
  host.style.top = '-10000px'
  host.style.visibility = 'hidden'
  host.style.pointerEvents = 'none'
  host.style.overflow = 'hidden'
  const mountTarget = document.body ?? document.documentElement
  mountTarget.appendChild(host)
  return host
}

const symbolOpticalInsets = (path: string): OpticalInsets | null => {
  const cached = symbolOpticalInsetsCache.get(path)
  if (cached !== undefined) return cached

  const symbolSvg = getCachedSymbolSvg(path)
  if (!symbolSvg) {
    symbolOpticalInsetsCache.set(path, null)
    return null
  }

  const viewBox = parseViewBox(symbolSvg.viewBox)
  const host = getSymbolMeasurementHost()
  if (!viewBox || !host) {
    symbolOpticalInsetsCache.set(path, null)
    return null
  }

  const previousViewBox = host.getAttribute('viewBox')
  const previousWidth = host.getAttribute('width')
  const previousHeight = host.getAttribute('height')
  const previousContent = host.innerHTML
  host.setAttribute('viewBox', symbolSvg.viewBox)
  host.setAttribute('width', `${viewBox.width}`)
  host.setAttribute('height', `${viewBox.height}`)
  host.innerHTML = symbolSvg.inner

  let box: DOMRect | null = null
  try {
    box = host.getBBox()
  } catch {
    box = null
  }

  host.innerHTML = previousContent
  if (previousViewBox == null) host.removeAttribute('viewBox')
  else host.setAttribute('viewBox', previousViewBox)
  if (previousWidth == null) host.removeAttribute('width')
  else host.setAttribute('width', previousWidth)
  if (previousHeight == null) host.removeAttribute('height')
  else host.setAttribute('height', previousHeight)

  if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y) || box.width <= 0 || box.height <= 0) {
    symbolOpticalInsetsCache.set(path, null)
    return null
  }

  const left = Math.max(0, Math.min(0.49, (box.x - viewBox.minX) / viewBox.width))
  const right = Math.max(0, Math.min(0.49, (viewBox.minX + viewBox.width - (box.x + box.width)) / viewBox.width))
  const top = Math.max(0, Math.min(0.49, (box.y - viewBox.minY) / viewBox.height))
  const bottom = Math.max(0, Math.min(0.49, (viewBox.minY + viewBox.height - (box.y + box.height)) / viewBox.height))
  const insets = { left, right, top, bottom }
  symbolOpticalInsetsCache.set(path, insets)
  return insets
}

const symbolContentBounds = (shape: Extract<Shape, { kind: 'symbol' }>) => {
  const size = 24 * Math.max(0.4, shape.scale)
  const x = shape.position.x - size / 2
  const y = shape.position.y - size / 2
  const fullBox = { x, y, width: size, height: size }
  if (shape.rotation || shape.flipX || shape.flipY) return fullBox
  const insets = symbolOpticalInsets(shape.path)
  if (!insets) return fullBox
  return {
    x: x + size * insets.left,
    y: y + size * insets.top,
    width: Math.max(1, size * (1 - insets.left - insets.right)),
    height: Math.max(1, size * (1 - insets.top - insets.bottom))
  }
}

const getBindingLabelOffset = (shape: Shape, side: BindingLabelSide): { x: number; y: number } => {
  const bounds = shape.kind === 'symbol' ? symbolContentBounds(shape) : shapeBounds(shape)
  const bindingId = 'bindingId' in shape && typeof shape.bindingId === 'string' ? shape.bindingId : ''
  const labelWidth = Math.max(14, bindingId.length * 7.2)
  const labelHeight = 12
  const nearMargin = getBindingLabelNearMargin(shape)
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const horizontalOffset = bounds.width / 2 + nearMargin + labelWidth / 2
  const verticalOffset = bounds.height / 2 + nearMargin + labelHeight / 2

  if (side === 'left') return { x: -horizontalOffset, y: 0 }
  if (side === 'right') return { x: horizontalOffset, y: 0 }
  if (side === 'top') return { x: 0, y: -verticalOffset }
  return { x: 0, y: verticalOffset }
}

@customElement('cadle-app')
export class CadleApp extends LiteElement {
  static styles = [styles]

  #tool: Tool = 'select'
  #shapes: Shape[] = []
  #selectedId: string | null = null
  #draft: DraftShape | null = null
  #drag: DragState | null = null
  #logoDrag: { pointerStart: Point; initial: Point } | null = null
  #labelDrag: {
    shapeId: string
    pointerStart: Point
    shapeCenter: Point
    initialOffset: { x: number; y: number }
  } | null = null
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
  #project: Project | null = null
  #persistPromise: Promise<void> = Promise.resolve()
  #connected = false
  // Wall click-chain state
  #wallChain: { startPoint: Point } | null = null
  #chainPreviewEnd: Point | null = null
  #snapTarget: Point | null = null
  #snapIndicatorKind: SnapIndicatorKind = 'wall'
  #lastWallClickTime = 0
  #lastWallClickPoint: Point | null = null
  #pendingCatalogSymbol: NativeCatalogPick | null = null
  #symbolPreviewPoint: Point | null = null
  // Active symbol placement gesture: anchor stays fixed while dragging sets the rotation.
  #symbolPlacement: { anchor: Point; rotation: number } | null = null
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
  #oneWireMode: 'preset' | 'compose' = 'preset'
  #oneWireComposeKind: 'breaker' | 'switch' | 'kamrail' | 'load' = 'switch'
  #stageContextMenuOpen = false
  #stageContextMenuX = 0
  #stageContextMenuY = 0
  #stageContextSubmenu: 'transform' | 'arrange' | '' = ''
  #stageContextPastePoint: Point | null = null
  // One-wire panel auto-stack state
  #oneWireAnchor: Point | null = null
  #oneWireLastPoint: Point | null = null
  #oneWireBusBarId: string | null = null
  #wheelTransformSession: {
    mode: 'rotate' | 'scale'
    lastAt: number
    rawDegrees: number
    snappedDegrees: number
  } | null = null
  #catalogDialogOpen = false
  #catalogDialogMode: CatalogDialogMode = 'add'
  #catalogDialogDraftMarkup = ''
  #catalogDialogDraftDefaultScale = 1
  #catalogDialogName = ''
  #catalogDialogFolder = ''
  #catalogDialogCategory = 'My Symbols'
  #catalogDialogTargetPath = ''
  #catalogDialogFolderOptions: string[] = []
  #catalogDialogCategoryOptions: CatalogDialogCategoryOption[] = []
  #catalogDialogReplaceOptions: CatalogDialogReplaceOption[] = []

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

  #shellActionFromTool(tool: Tool): string {
    switch (tool) {
      case 'wall':
        return 'draw-wall'
      case 'door':
        return 'draw-door'
      case 'window':
        return 'draw-window'
      case 'gate':
        return 'draw-gate'
      case 'line':
        return 'draw-line'
      case 'onewire':
        return 'draw-onewire'
      case 'rect':
        return 'draw-square'
      case 'circle':
        return 'draw-circle'
      case 'arc':
        return 'draw-arc'
      case 'text':
        return 'draw-text'
      case 'symbol':
        return 'draw-symbol'
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
    pubsub.subscribe('native.controls.command', this.#onNativeControlsCommand)
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
    pubsub.unsubscribe('native.controls.command', this.#onNativeControlsCommand)
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

  async exportA4PNG(
    orientation: 'portrait' | 'landscape' | 'auto' = 'auto',
    monochrome = false
  ): Promise<{
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
    const exportViewBox = this.#exportViewBox(resolvedOrientation)
    const svgBlob = new Blob([this.#buildSvgDocument(exportViewBox ?? undefined, monochrome)], {
      type: 'image/svg+xml;charset=utf-8'
    })
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
    const defaults = getCatalogSymbolStyleDefaults(payload.path)
    const metadata: Record<string, unknown> =
      payload.metadata && typeof payload.metadata === 'object' ? { ...payload.metadata } : {}
    if (defaults) {
      const existingDefaults =
        metadata.symbolDefaults && typeof metadata.symbolDefaults === 'object'
          ? (metadata.symbolDefaults as Record<string, unknown>)
          : {}
      metadata.symbolDefaults = {
        ...defaults,
        ...existingDefaults
      }
    }
    this.#pendingCatalogSymbol = {
      name: payload.name,
      path: payload.path,
      metadata
    }
    this.#symbolPreviewPoint = null
    this.#tool = 'symbol'
    this.#draft = null
    this.#render()
  }

  #refreshCatalogStructure() {
    window.cadleShell?.dispatchEvent(
      new CustomEvent('catalog-structure-updated', {
        bubbles: true,
        composed: true
      })
    )
  }

  #saveSelectedSymbolDefaultsToCatalog = async (): Promise<boolean> => {
    const ids = this.#selectedShapeIds()
    if (ids.length !== 1) return false
    const selected = this.#shapeById(ids[0])
    if (!selected || selected.kind !== 'symbol') return false

    await setStoredCatalogSymbolStyleDefaults(selected.path, {
      scale: selected.scale,
      rotation: selected.rotation,
      fill: selected.fill,
      stroke: selected.stroke,
      strokeWidth: selected.strokeWidth,
      flipX: selected.flipX,
      flipY: selected.flipY
    })
    window.alert(`Saved defaults for ${selected.name}.`)
    return true
  }

  #buildCatalogSelectionDraft(): { svgMarkup: string; defaultScale: number; fallbackName: string } | null {
    const selectedIds = new Set(this.#selectedShapeIds())
    if (!selectedIds.size) return null
    const selectedShapes = this.#shapes.filter((shape) => selectedIds.has(shape.id)).map((shape) => cloneShape(shape))
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

    const padding = 8
    const contentWidth = Math.max(1, maxX - minX)
    const contentHeight = Math.max(1, maxY - minY)
    const defaultScale = Math.max(0.4, Math.min(20, Math.max(contentWidth, contentHeight) / 24))
    const translatedShapes = selectedShapes.map((shape) =>
      this.#translateShape(cloneShape(shape), -minX + padding, -minY + padding)
    )
    const width = Math.max(24, maxX - minX + padding * 2)
    const height = Math.max(24, maxY - minY + padding * 2)
    const markup = translatedShapes.map((shape) => shapeMarkup(shape, false)).join('')
    const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${markup}</svg>`

    const fallbackName =
      selectedShapes.length === 1
        ? `${selectedShapes[0].kind.charAt(0).toUpperCase() + selectedShapes[0].kind.slice(1)} symbol`
        : 'Custom symbol'
    return { svgMarkup, defaultScale, fallbackName }
  }

  #catalogDialogCategoryOptionsForFolder(): CatalogDialogCategoryOption[] {
    const folder = this.#catalogDialogFolder.trim() || undefined
    const options = this.#catalogDialogCategoryOptions.filter((entry) => (entry.folder ?? '') === (folder ?? ''))
    if (options.some((entry) => entry.name === 'My Symbols')) return options
    return [...options, { folder, name: 'My Symbols' }]
  }

  #openCatalogDialog = async (mode: CatalogDialogMode): Promise<boolean> => {
    const draft = this.#buildCatalogSelectionDraft()
    if (!draft) return false

    await ensureCustomCatalogLoaded()
    const symbols = getStoredCustomSymbols()
    const folders = getStoredCustomFolders()
    const categories = getStoredCustomCategories()

    const uniqueCategories = new Map<string, CatalogDialogCategoryOption>()
    for (const category of categories) {
      const key = `${category.folder ?? ''}::${category.name}`
      uniqueCategories.set(key, { folder: category.folder, name: category.name })
    }
    uniqueCategories.set('::My Symbols', { name: 'My Symbols' })

    const replaceOptions = symbols.map((symbol) => ({
      path: symbol.path,
      name: symbol.name,
      category: symbol.category,
      folder: symbol.folder
    }))

    if (mode === 'replace' && replaceOptions.length === 0) {
      window.alert('No custom catalog symbols available to replace.')
      return false
    }

    this.#catalogDialogMode = mode
    this.#catalogDialogDraftMarkup = draft.svgMarkup
    this.#catalogDialogDraftDefaultScale = draft.defaultScale
    this.#catalogDialogFolderOptions = folders
    this.#catalogDialogCategoryOptions = [...uniqueCategories.values()].sort((left, right) => {
      const leftFolder = left.folder ?? ''
      const rightFolder = right.folder ?? ''
      if (leftFolder !== rightFolder) return leftFolder.localeCompare(rightFolder)
      return left.name.localeCompare(right.name)
    })
    this.#catalogDialogReplaceOptions = replaceOptions.sort((left, right) => left.name.localeCompare(right.name))
    this.#catalogDialogName = draft.fallbackName
    this.#catalogDialogFolder = ''
    this.#catalogDialogCategory = 'My Symbols'
    this.#catalogDialogTargetPath = this.#catalogDialogReplaceOptions[0]?.path ?? ''

    if (mode === 'replace') {
      const selected = this.#catalogDialogReplaceOptions[0]
      if (selected) {
        this.#catalogDialogFolder = selected.folder ?? ''
        this.#catalogDialogCategory = selected.category
      }
    }

    this.#catalogDialogOpen = true
    this.#renderPreviewOnly()
    return true
  }

  #closeCatalogDialog = () => {
    this.#catalogDialogOpen = false
    this.#catalogDialogDraftMarkup = ''
    this.#catalogDialogDraftDefaultScale = 1
    this.#renderPreviewOnly()
  }

  #saveCatalogDialog = async () => {
    if (!this.#catalogDialogDraftMarkup) return

    const path = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(this.#catalogDialogDraftMarkup)}`
    const symbols = getStoredCustomSymbols()

    if (this.#catalogDialogMode === 'replace') {
      const targetPath = this.#catalogDialogTargetPath
      const index = symbols.findIndex((entry) => entry.path === targetPath)
      if (index < 0) {
        window.alert('Selected catalog symbol was not found anymore.')
        return
      }
      const target = symbols[index]
      symbols[index] = {
        ...target,
        path,
        metadata: {
          ...(target.metadata ?? {}),
          customSymbol: true,
          replacedAt: Date.now(),
          source: 'native-selection',
          symbolDefaults: {
            scale: this.#catalogDialogDraftDefaultScale
          }
        }
      }
      await setStoredCustomSymbols(symbols)
      this.#refreshCatalogStructure()
      this.#closeCatalogDialog()
      window.alert(`Replaced ${target.name}.`)
      return
    }

    const name = this.#catalogDialogName.trim()
    if (!name) {
      window.alert('Please provide a symbol name.')
      return
    }

    const folder = this.#catalogDialogFolder.trim() || undefined
    const category = this.#catalogDialogCategory.trim() || 'My Symbols'
    symbols.push({
      folder,
      category,
      name,
      path,
      metadata: {
        customSymbol: true,
        importedAt: Date.now(),
        bindingRole: 'neutral',
        source: 'native-selection',
        symbolDefaults: {
          scale: this.#catalogDialogDraftDefaultScale
        }
      }
    })
    await setStoredCustomSymbols(symbols)
    this.#refreshCatalogStructure()
    this.#closeCatalogDialog()
    window.alert(`Added ${name} to catalog.`)
  }

  #addSelectionToCatalog = async (): Promise<boolean> => {
    return this.#openCatalogDialog('add')
  }

  #replaceSelectionInCatalog = async (): Promise<boolean> => {
    return this.#openCatalogDialog('replace')
  }

  #onNativeObjectUpdate = (payload: {
    text?: string
    symbolTextOverrides?: Record<string, string>
    bindingId?: string
    bindingLabelSide?: BindingLabelSide | 'auto'
    rotation?: number
    scale?: number
    flipX?: boolean
    flipY?: boolean
    fill?: string
    stroke?: string
    strokeWidth?: number
    x?: number
    y?: number
  }) => {
    const hasLogoSelection =
      this.#selectedIds.has(PROJECT_LOGO_SHAPE_ID) ||
      (this.#selectedIds.size === 0 && this.#selectedId === PROJECT_LOGO_SHAPE_ID)
    if (hasLogoSelection && this.#project && isProjectLogoVisible(this.#project)) {
      if (typeof payload.scale === 'number') {
        this.#project.logoScale = Math.max(0.4, Math.min(2.5, payload.scale))
      }
      if (typeof payload.fill === 'string') {
        const nextFill = payload.fill.trim()
        this.#project.logoColor = nextFill || undefined
      }
      if (typeof payload.stroke === 'string' && !('fill' in payload)) {
        const nextStroke = payload.stroke.trim()
        this.#project.logoColor = nextStroke || undefined
      }
      if (typeof payload.x === 'number') {
        this.#project.logoX = payload.x
      }
      if (typeof payload.y === 'number') {
        this.#project.logoY = payload.y
      }
      if (
        typeof payload.scale === 'number' ||
        typeof payload.fill === 'string' ||
        typeof payload.stroke === 'string' ||
        typeof payload.x === 'number' ||
        typeof payload.y === 'number'
      ) {
        cadleShell.project = this.#project
        void this.#persistProjectMetadata()
        this.#render()
        return
      }
    }

    const bindingId =
      'bindingId' in payload && typeof payload.bindingId === 'string'
        ? (() => {
            const raw = payload.bindingId.trim().toUpperCase()
            return raw && raw !== 'UNDEFINED' && raw !== 'NULL' ? raw : undefined
          })()
        : undefined
    const bindingLabelSide =
      payload.bindingLabelSide === 'auto'
        ? 'auto'
        : payload.bindingLabelSide === 'left' ||
            payload.bindingLabelSide === 'right' ||
            payload.bindingLabelSide === 'top' ||
            payload.bindingLabelSide === 'bottom'
          ? payload.bindingLabelSide
          : undefined
    const groupedSelection = this.#selectedGroupId() !== null
    const targets = this.#selectedIds.size > 0 ? [...this.#selectedIds] : this.#selectedId ? [this.#selectedId] : []
    if (!targets.length) return
    const targetShapeSet = new Set(targets)
    let selectionCenter: Point | null = null
    if (targets.length > 1) {
      let minX = Number.POSITIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      for (const candidate of this.#shapes) {
        if (!targetShapeSet.has(candidate.id)) continue
        const bounds = shapeBounds(candidate)
        minX = Math.min(minX, bounds.x)
        minY = Math.min(minY, bounds.y)
        maxX = Math.max(maxX, bounds.x + bounds.width)
        maxY = Math.max(maxY, bounds.y + bounds.height)
      }
      if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
        selectionCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
      }
    }
    for (const id of targets) {
      const shape = this.#shapeById(id)
      if (!shape) continue
      const updated = cloneShape(shape) as Shape & {
        rotation?: number
        scale?: number
        flipX?: boolean
        flipY?: boolean
        fill?: string
        stroke?: string
        strokeWidth?: number
        bindingId?: string
        bindingLabelOffset?: { x: number; y: number }
      }
      if ('bindingId' in payload) {
        if (bindingId) {
          if (!groupedSelection || id === this.#selectedId) updated.bindingId = bindingId
          else delete updated.bindingId
        } else {
          delete updated.bindingId
        }
      }
      if (bindingLabelSide === 'auto') {
        delete updated.bindingLabelOffset
      } else if (bindingLabelSide) {
        updated.bindingLabelOffset = getBindingLabelOffset(updated, bindingLabelSide)
      }
      if (typeof payload.rotation === 'number') {
        if (
          updated.kind === 'symbol' ||
          updated.kind === 'image' ||
          updated.kind === 'text' ||
          updated.kind === 'rect'
        ) {
          updated.rotation = ((payload.rotation % 360) + 360) % 360
        } else if (
          updated.kind === 'wall' ||
          updated.kind === 'line' ||
          updated.kind === 'door' ||
          updated.kind === 'window' ||
          updated.kind === 'gate'
        ) {
          const angle = ((payload.rotation % 360) + 360) % 360
          const radians = (angle * Math.PI) / 180
          const centerX = (updated.start.x + updated.end.x) / 2
          const centerY = (updated.start.y + updated.end.y) / 2
          const length = Math.hypot(updated.end.x - updated.start.x, updated.end.y - updated.start.y)
          const half = length / 2
          const dx = Math.cos(radians) * half
          const dy = Math.sin(radians) * half
          updated.start = { x: centerX - dx, y: centerY - dy }
          updated.end = { x: centerX + dx, y: centerY + dy }
          updated.rotation = angle
        }
      }
      if (typeof payload.scale === 'number') {
        const nextScale = Math.max(0.1, Math.min(20, payload.scale))
        if (updated.kind === 'symbol' || updated.kind === 'text') {
          updated.scale = nextScale
        } else if (updated.kind === 'rect') {
          const currentScale = typeof updated.scale === 'number' && Number.isFinite(updated.scale) ? updated.scale : 1
          const factor = nextScale / currentScale
          const centerX = (updated.start.x + updated.end.x) / 2
          const centerY = (updated.start.y + updated.end.y) / 2
          updated.start = {
            x: centerX + (updated.start.x - centerX) * factor,
            y: centerY + (updated.start.y - centerY) * factor
          }
          updated.end = {
            x: centerX + (updated.end.x - centerX) * factor,
            y: centerY + (updated.end.y - centerY) * factor
          }
          updated.scale = nextScale
        } else if (
          updated.kind === 'wall' ||
          updated.kind === 'line' ||
          updated.kind === 'door' ||
          updated.kind === 'window' ||
          updated.kind === 'gate'
        ) {
          const currentScale = typeof updated.scale === 'number' && Number.isFinite(updated.scale) ? updated.scale : 1
          const factor = nextScale / currentScale
          const centerX = selectionCenter?.x ?? (updated.start.x + updated.end.x) / 2
          const centerY = selectionCenter?.y ?? (updated.start.y + updated.end.y) / 2
          updated.start = {
            x: centerX + (updated.start.x - centerX) * factor,
            y: centerY + (updated.start.y - centerY) * factor
          }
          updated.end = {
            x: centerX + (updated.end.x - centerX) * factor,
            y: centerY + (updated.end.y - centerY) * factor
          }
          updated.scale = nextScale
        }
      }
      if (typeof payload.flipX === 'boolean') {
        if (
          updated.kind === 'symbol' ||
          updated.kind === 'image' ||
          updated.kind === 'text' ||
          updated.kind === 'rect'
        ) {
          if (payload.flipX) updated.flipX = true
          else delete updated.flipX
        } else if (
          updated.kind === 'wall' ||
          updated.kind === 'line' ||
          updated.kind === 'door' ||
          updated.kind === 'window' ||
          updated.kind === 'gate'
        ) {
          const centerX = (updated.start.x + updated.end.x) / 2
          updated.start = { x: centerX * 2 - updated.start.x, y: updated.start.y }
          updated.end = { x: centerX * 2 - updated.end.x, y: updated.end.y }
          if (payload.flipX) updated.flipX = true
          else delete updated.flipX
        }
      }
      if (typeof payload.flipY === 'boolean') {
        if (
          updated.kind === 'symbol' ||
          updated.kind === 'image' ||
          updated.kind === 'text' ||
          updated.kind === 'rect'
        ) {
          if (payload.flipY) updated.flipY = true
          else delete updated.flipY
        } else if (
          updated.kind === 'wall' ||
          updated.kind === 'line' ||
          updated.kind === 'door' ||
          updated.kind === 'window' ||
          updated.kind === 'gate'
        ) {
          const centerY = (updated.start.y + updated.end.y) / 2
          updated.start = { x: updated.start.x, y: centerY * 2 - updated.start.y }
          updated.end = { x: updated.end.x, y: centerY * 2 - updated.end.y }
          if (payload.flipY) updated.flipY = true
          else delete updated.flipY
        }
      }
      if (typeof payload.fill === 'string') {
        if (payload.fill) updated.fill = payload.fill
        else delete updated.fill
      }
      if (typeof payload.text === 'string' && updated.kind === 'text') {
        updated.text = payload.text
      }
      if (payload.symbolTextOverrides && updated.kind === 'symbol') {
        const cleanedEntries = Object.entries(payload.symbolTextOverrides)
          .filter(
            (entry): entry is [string, string] =>
              typeof entry[0] === 'string' &&
              Boolean(entry[0].trim()) &&
              typeof entry[1] === 'string' &&
              Boolean(entry[1].trim())
          )
          .map(([key, value]) => [key.trim(), value] as const)
        if (cleanedEntries.length) {
          updated.symbolTextOverrides = Object.fromEntries(cleanedEntries)
        } else {
          delete updated.symbolTextOverrides
        }
      }
      if (typeof payload.stroke === 'string') {
        if (payload.stroke) updated.stroke = payload.stroke
        else delete updated.stroke
      }
      if (typeof payload.strokeWidth === 'number') {
        const nextWidth = Math.max(0.5, Math.min(40, payload.strokeWidth))
        updated.strokeWidth = nextWidth
      }
      let nextShape = updated as Shape
      if (typeof payload.x === 'number' || typeof payload.y === 'number') {
        const bounds = shapeBounds(nextShape)
        const currentX = bounds.x + bounds.width / 2
        const currentY = bounds.y + bounds.height / 2
        const targetX = typeof payload.x === 'number' ? payload.x : currentX
        const targetY = typeof payload.y === 'number' ? payload.y : currentY
        const dx = targetX - currentX
        const dy = targetY - currentY
        if (dx !== 0 || dy !== 0) {
          nextShape = translateShape(nextShape, dx, dy)
        }
      }
      this.#setShape(nextShape)
    }
    this.#pushHistory()
    this.#render()
  }

  #onNativeObjectDelete = () => {
    if (this.#selectedId === PROJECT_LOGO_SHAPE_ID && this.#project) {
      this.#project.logoUrl = undefined
      this.#project.logoColor = undefined
      this.#project.logoScale = 1
      this.#project.logoX = undefined
      this.#project.logoY = undefined
      this.#selectedId = null
      this.#selectedIds = new Set()
      cadleShell.project = this.#project
      void this.#persistProjectMetadata()
      this.#render()
      return
    }

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
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    this.#autoCenterView()
    this.#render()
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

  async #persistProjectMetadata() {
    if (!this.#projectKey || !this.#project) return
    await setProjectData(this.#projectKey, this.#project)
  }

  async #restore() {
    const loaded = await loadNativeState()
    this.#projectKey = loaded.projectKey
    this.#pageKey = loaded.pageKey
    const shell = globalThis as unknown as { cadleShell?: { project?: Project | null } }
    this.#project = shell.cadleShell?.project ?? null

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
    this.#rebindAllOpeningsToWalls()
    if (typeof parsed.selectedId === 'string' && this.#shapeById(parsed.selectedId)) {
      this.#selectedId = parsed.selectedId
    }
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
    this.#snapIndicatorKind = 'wall'
    this.#symbolPreviewPoint = null
    this.#symbolPlacement = null
    this.#worldWidth = DEFAULT_WORLD_WIDTH
    this.#worldHeight = DEFAULT_WORLD_HEIGHT
    this.#paperPreset = 'a4-landscape'
    this.#printMargin = DEFAULT_PRINT_MARGIN_MM
    this.#oneWireAnchor = null
    this.#oneWireLastPoint = null
    this.#oneWireBusBarId = null
  }

  #pushHistory(persist = true, replaceCurrent = false) {
    const snapshot: Snapshot = {
      shapes: cloneShapes(this.#shapes),
      selectedId: this.#selectedId,
      worldWidth: this.#worldWidth,
      worldHeight: this.#worldHeight
    }
    if (replaceCurrent && this.#historyIndex >= 0) {
      this.#history[this.#historyIndex] = snapshot
      if (persist) this.#persist()
      return
    }
    this.#history = this.#history.slice(0, this.#historyIndex + 1)
    this.#history.push(snapshot)
    this.#historyIndex = this.#history.length - 1
    if (persist) this.#persist()
  }

  #restoreSnapshot(snapshot: Snapshot) {
    this.#shapes = cloneShapes(snapshot.shapes)
    this.#rebindAllOpeningsToWalls()
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
    this.#worldWidth = nextWidth
    this.#worldHeight = nextHeight

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

  #autoCenterView() {
    const panel = this.shadowRoot?.querySelector<HTMLElement>('.panel')
    if (!panel) return

    const rect = panel.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    // Fit the page (world) so the safe-area dashed boundary, grid and content
    // are shown coherently — like a print preview.
    const margin = 12
    const availableWidth = rect.width - margin * 2
    const availableHeight = rect.height - margin * 2
    const zoomX = availableWidth / this.#worldWidth
    const zoomY = availableHeight / this.#worldHeight
    this.#zoom = this.#clampZoom(Math.min(1, zoomX, zoomY))

    this.#panX = (rect.width - this.#worldWidth * this.#zoom) / 2
    this.#panY = (rect.height - this.#worldHeight * this.#zoom) / 2
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

    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      if (this.#selectedShapeIds().length) {
        const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
        const now = performance.now()
        const reuseSession =
          this.#wheelTransformSession?.mode === 'rotate' &&
          now - this.#wheelTransformSession.lastAt < WHEEL_GESTURE_IDLE_MS
        const session =
          reuseSession && this.#wheelTransformSession
            ? this.#wheelTransformSession
            : { mode: 'rotate' as const, lastAt: now, rawDegrees: 0, snappedDegrees: 0 }
        session.rawDegrees += dominantDelta * WHEEL_ROTATE_DEGREES_PER_DELTA
        const nextSnappedDegrees =
          Math.round(session.rawDegrees / WHEEL_ROTATE_SNAP_DEGREES) * WHEEL_ROTATE_SNAP_DEGREES
        const deltaDegrees = nextSnappedDegrees - session.snappedDegrees
        session.snappedDegrees = nextSnappedDegrees
        session.lastAt = now
        this.#wheelTransformSession = session
        if (deltaDegrees !== 0) {
          this.#rotateNativeSelectionBy(deltaDegrees, reuseSession)
        }
        return
      }
    }

    if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (this.#selectedShapeIds().length) {
        const factor = Math.exp(-event.deltaY * WHEEL_SCALE_PER_DELTA)
        const now = performance.now()
        const reuseSession =
          this.#wheelTransformSession?.mode === 'scale' &&
          now - this.#wheelTransformSession.lastAt < WHEEL_GESTURE_IDLE_MS
        this.#wheelTransformSession = {
          mode: 'scale',
          lastAt: now,
          rawDegrees: 0,
          snappedDegrees: 0
        }
        this.#scaleNativeSelectionBy(factor, reuseSession)
        return
      }
    }

    this.#wheelTransformSession = null

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

  #pointToSegmentDistance(point: Point, start: Point, end: Point): number {
    const deltaX = end.x - start.x
    const deltaY = end.y - start.y
    const lengthSquared = deltaX * deltaX + deltaY * deltaY
    if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y)
    const position = Math.max(
      0,
      Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared)
    )
    const projectionX = start.x + position * deltaX
    const projectionY = start.y + position * deltaY
    return Math.hypot(point.x - projectionX, point.y - projectionY)
  }

  #isOpeningShape(shape: Shape): shape is LineShape {
    return shape.kind === 'door' || shape.kind === 'window' || shape.kind === 'gate'
  }

  #bindOpeningToWall(shape: LineShape): LineShape {
    if (!this.#isOpeningShape(shape)) return shape

    const midpoint: Point = {
      x: (shape.start.x + shape.end.x) / 2,
      y: (shape.start.y + shape.end.y) / 2
    }

    let bestWall: LineShape | null = null
    let bestDistance = 8
    for (const candidate of this.#shapes) {
      if (candidate.kind !== 'wall') continue
      const startDistance = this.#pointToSegmentDistance(shape.start, candidate.start, candidate.end)
      const endDistance = this.#pointToSegmentDistance(shape.end, candidate.start, candidate.end)
      const middleDistance = this.#pointToSegmentDistance(midpoint, candidate.start, candidate.end)
      if (startDistance > 8 || endDistance > 8 || middleDistance > 8) continue
      const distance = (startDistance + endDistance + middleDistance) / 3
      if (distance < bestDistance) {
        bestDistance = distance
        bestWall = candidate
      }
    }

    const bound = { ...shape }
    if (bestWall) bound.wallId = bestWall.id
    else delete bound.wallId
    return bound
  }

  #linkedOpeningIdsForWalls(shapeIds: Iterable<string>): string[] {
    const wallIds = new Set<string>()
    for (const id of shapeIds) {
      const shape = this.#shapeById(id)
      if (shape?.kind === 'wall') wallIds.add(shape.id)
    }
    if (!wallIds.size) return []

    return this.#shapes
      .filter((shape): shape is LineShape => this.#isOpeningShape(shape))
      .filter((shape) => typeof shape.wallId === 'string' && wallIds.has(shape.wallId))
      .map((shape) => shape.id)
  }

  #rebindAllOpeningsToWalls() {
    if (!this.#shapes.length) return
    this.#shapes = this.#shapes.map((shape) => {
      if (!this.#isOpeningShape(shape)) return shape
      return this.#bindOpeningToWall(cloneShape(shape) as LineShape)
    })
  }

  #shapeIdAtPoint(point: Point): string | null {
    const logoBounds = this.#project && isProjectLogoVisible(this.#project) ? getProjectLogoBounds(this.#project) : null
    if (
      logoBounds &&
      point.x >= logoBounds.x &&
      point.x <= logoBounds.x + logoBounds.width &&
      point.y >= logoBounds.y &&
      point.y <= logoBounds.y + logoBounds.height
    ) {
      return PROJECT_LOGO_SHAPE_ID
    }
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
    const shellAction = this.#shellActionFromTool(tool)
    if (window.cadleShell?.action !== shellAction) {
      window.cadleShell.action = shellAction
    }
    if (tool !== 'symbol') {
      this.#pendingCatalogSymbol = null
      this.#symbolPreviewPoint = null
      this.#symbolPlacement = null
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
    this.#snapIndicatorKind = 'wall'
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
    // One-wire groupIds are layout metadata (realign, label dedupe) — shapes
    // stay individually selectable. Only user-made groups select as a whole.
    if (groupId.startsWith('onewire-')) return new Set([shapeId])
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

  #selectedGroupId(): string | null {
    const ids = this.#selectedShapeIds()
    if (ids.length < 2) return null
    const shapes = ids.map((id) => this.#shapeById(id)).filter((shape): shape is Shape => Boolean(shape))
    if (!shapes.length) return null
    const groupId = shapes[0]?.groupId
    if (!groupId) return null
    // One-wire layout groups never present as a single "group" selection.
    if (groupId.startsWith('onewire-')) return null
    return shapes.every((shape) => shape.groupId === groupId) ? groupId : null
  }

  #selectedGroupBindingId(): string | undefined {
    const groupId = this.#selectedGroupId()
    if (!groupId) return undefined
    for (const id of this.#selectedShapeIds()) {
      const bindingId = this.#shapeById(id)?.bindingId
      if (typeof bindingId === 'string' && bindingId.trim()) return bindingId
    }
    return undefined
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
    this.#stageContextPastePoint = null
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

  #rotatePointAround(point: Point, center: Point, deltaDegrees: number): Point {
    const radians = (deltaDegrees * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    const offsetX = point.x - center.x
    const offsetY = point.y - center.y
    return {
      x: center.x + offsetX * cos - offsetY * sin,
      y: center.y + offsetX * sin + offsetY * cos
    }
  }

  #rotateNativeSelectionBy(deltaDegrees: number, replaceHistory = false): boolean {
    const ids = this.#selectedShapeIds()
    if (!ids.length || deltaDegrees === 0) return false
    const center = this.#selectionCenter()
    if (!center) return false
    const rotateAsGroup = ids.length > 1

    for (const id of ids) {
      const shape = this.#shapeById(id)
      if (!shape) continue

      switch (shape.kind) {
        case 'wall':
        case 'line':
        case 'door':
        case 'window':
        case 'gate':
          this.#setShape({
            ...shape,
            start: this.#rotatePointAround(shape.start, center, deltaDegrees),
            end: this.#rotatePointAround(shape.end, center, deltaDegrees)
          })
          break
        case 'rect': {
          const width = Math.abs(shape.end.x - shape.start.x)
          const height = Math.abs(shape.end.y - shape.start.y)
          const currentCenter = {
            x: (shape.start.x + shape.end.x) / 2,
            y: (shape.start.y + shape.end.y) / 2
          }
          const nextCenter = this.#rotatePointAround(currentCenter, center, deltaDegrees)
          this.#setShape({
            ...shape,
            start: { x: nextCenter.x - width / 2, y: nextCenter.y - height / 2 },
            end: { x: nextCenter.x + width / 2, y: nextCenter.y + height / 2 },
            rotation: rotateAsGroup ? shape.rotation : ((((shape.rotation ?? 0) + deltaDegrees) % 360) + 360) % 360
          })
          break
        }
        case 'text':
        case 'symbol':
          this.#setShape({
            ...shape,
            position: this.#rotatePointAround(shape.position, center, deltaDegrees),
            rotation: rotateAsGroup ? shape.rotation : ((((shape.rotation ?? 0) + deltaDegrees) % 360) + 360) % 360
          })
          break
        case 'image':
          this.#setShape({
            ...shape,
            position: this.#rotatePointAround(shape.position, center, deltaDegrees),
            rotation: rotateAsGroup ? shape.rotation : ((((shape.rotation ?? 0) + deltaDegrees) % 360) + 360) % 360
          })
          break
      }
    }

    this.#pushHistory(true, replaceHistory)
    this.#render()
    return true
  }

  #scaleNativeSelectionBy(factor: number, replaceHistory = false): boolean {
    const ids = this.#selectedShapeIds()
    if (!ids.length || !Number.isFinite(factor) || factor <= 0 || factor === 1) return false
    const center = this.#selectionCenter()
    if (!center) return false

    const scalePointAround = (point: Point): Point => ({
      x: center.x + (point.x - center.x) * factor,
      y: center.y + (point.y - center.y) * factor
    })

    for (const id of ids) {
      const shape = this.#shapeById(id)
      if (!shape) continue

      switch (shape.kind) {
        case 'wall':
        case 'line':
        case 'door':
        case 'window':
        case 'gate':
          this.#setShape({
            ...shape,
            start: scalePointAround(shape.start),
            end: scalePointAround(shape.end)
          })
          break
        case 'rect': {
          const a = scalePointAround(shape.start)
          const b = scalePointAround(shape.end)
          this.#setShape({
            ...shape,
            start: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
            end: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
            scale: Math.max(0.1, Math.min(20, (shape.scale ?? 1) * factor))
          })
          break
        }
        case 'text':
          this.#setShape({
            ...shape,
            position: scalePointAround(shape.position),
            scale: Math.max(0.1, Math.min(20, (shape.scale ?? 1) * factor))
          })
          break
        case 'symbol':
          this.#setShape({
            ...shape,
            position: scalePointAround(shape.position),
            scale: Math.max(0.1, Math.min(20, shape.scale * factor))
          })
          break
        case 'image':
          this.#setShape({
            ...shape,
            position: scalePointAround(shape.position),
            width: Math.max(1, shape.width * factor),
            height: Math.max(1, shape.height * factor)
          })
          break
      }
    }

    this.#pushHistory(true, replaceHistory)
    this.#render()
    return true
  }

  #transformNativeSelection(action: SelectionTransformAction): boolean {
    const ids = this.#selectedShapeIds()
    if (!ids.length) return false
    if ((action === 'rotate-left' || action === 'rotate-right') && ids.length > 1) {
      const deltaDegrees = action === 'rotate-left' ? -90 : 90
      return this.#rotateNativeSelectionBy(deltaDegrees)
    }
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

    this.#stageContextPastePoint = this.#pointFromEvent(event as PointerEvent)

    this.#openStageContextMenu(event.clientX, event.clientY)
  }

  #onStageDoubleClick = (event: MouseEvent) => {
    const point = this.#pointFromEvent(event as PointerEvent)
    if (!point) return

    const shapeElement = event.target instanceof Element ? event.target.closest<SVGElement>('[data-shape-id]') : null
    let shapeId = shapeElement?.dataset.shapeId ?? null
    shapeId ??= this.#shapeIdAtPoint(point)
    if (!shapeId) {
      this.#selectedIds = new Set(this.#shapes.map((shape) => shape.id))
      this.#selectedId = this.#shapes[0]?.id ?? null
      this.#drag = null
      this.#bandStart = null
      this.#bandEnd = null
      this.#stagePointerId = null
      this.#hideStageContextMenu()
      this.#render()
      return
    }

    const shape = this.#shapeById(shapeId)
    if (!shape) return

    if (shape.kind === 'text') {
      const nextText = window.prompt('Text', shape.text)?.trim()
      if (!nextText || nextText === shape.text) {
        this.#selectedId = shape.id
        this.#selectedIds = new Set([shape.id])
        this.#render()
        return
      }

      this.#setShape({ ...shape, text: nextText } as TextShape)
      this.#selectedId = shape.id
      this.#selectedIds = new Set([shape.id])
      this.#pushHistory()
      this.#render()
      return
    }

    if (!shape.groupId) return

    // In a group: double-click isolates one shape for direct edit/delete operations.
    this.#selectedIds = new Set([shapeId])
    this.#selectedId = shapeId
    this.#drag = null
    this.#bandStart = null
    this.#bandEnd = null
    this.#stagePointerId = null
    this.#hideStageContextMenu()
    this.#render()
    pubsub.publish('native.binding.focus-input', {})
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
      this.#pasteNativeClipboard(this.#stageContextPastePoint)
      return
    }
    if (action === 'delete') {
      this.#deleteNativeSelection()
      return
    }
    if (action === 'save-symbol-defaults') {
      void this.#saveSelectedSymbolDefaultsToCatalog()
      return
    }
    if (action === 'add-selection-to-catalog') {
      void this.#addSelectionToCatalog()
      return
    }
    if (action === 'replace-selection-in-catalog') {
      void this.#replaceSelectionInCatalog()
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

  #pasteNativeClipboard(targetPoint: Point | null = null): boolean {
    if (!this.#nativeClipboard.length) return false

    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const shape of this.#nativeClipboard) {
      const bounds = shapeBounds(shape)
      minX = Math.min(minX, bounds.x)
      minY = Math.min(minY, bounds.y)
      maxX = Math.max(maxX, bounds.x + bounds.width)
      maxY = Math.max(maxY, bounds.y + bounds.height)
    }

    let dx = GRID_SIZE
    let dy = GRID_SIZE
    if (targetPoint) {
      const snappedTarget = this.#snap ? this.#snapPoint(targetPoint) : targetPoint
      const centerX = (minX + maxX) / 2
      const centerY = (minY + maxY) / 2
      dx = snappedTarget.x - centerX
      dy = snappedTarget.y - centerY
    }

    if (this.#snap) {
      const translatedMinX = minX + dx
      const translatedMinY = minY + dy
      const snappedMinX = Math.round(translatedMinX / GRID_SIZE) * GRID_SIZE
      const snappedMinY = Math.round(translatedMinY / GRID_SIZE) * GRID_SIZE
      dx += snappedMinX - translatedMinX
      dy += snappedMinY - translatedMinY
    }

    const groupMap = new Map<string, string>()
    const pasted = this.#nativeClipboard.map((shape) => {
      const moved = this.#translateShape(cloneShape(shape), dx, dy)
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

  #nudgeNativeSelection(dx: number, dy: number): boolean {
    const ids = this.#selectedShapeIds()
    if (!ids.length) return false

    for (const id of ids) {
      const shape = this.#shapeById(id)
      if (!shape) continue
      this.#setShape(this.#translateShape(cloneShape(shape), dx, dy))
    }

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
        return this.#pasteNativeClipboard(this.#stageContextPastePoint)
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
      case 'tool-rect':
        this.#activateTool('rect')
        return true
      case 'tool-circle':
        this.#activateTool('circle')
        return true
      case 'tool-arc':
        this.#activateTool('arc')
        return true
      case 'tool-text':
        this.#activateTool('text')
        return true
      case 'tool-symbol':
        this.#activateTool('symbol')
        return true
      case 'tool-onewire':
        this.#activateTool('onewire')
        return true
      case 'nudge-up':
        return this.#nudgeNativeSelection(0, -NUDGE_STEP)
      case 'nudge-down':
        return this.#nudgeNativeSelection(0, NUDGE_STEP)
      case 'nudge-left':
        return this.#nudgeNativeSelection(-NUDGE_STEP, 0)
      case 'nudge-right':
        return this.#nudgeNativeSelection(NUDGE_STEP, 0)
      case 'nudge-up-precision':
        return this.#nudgeNativeSelection(0, -NUDGE_PRECISION_STEP)
      case 'nudge-down-precision':
        return this.#nudgeNativeSelection(0, NUDGE_PRECISION_STEP)
      case 'nudge-left-precision':
        return this.#nudgeNativeSelection(-NUDGE_PRECISION_STEP, 0)
      case 'nudge-right-precision':
        return this.#nudgeNativeSelection(NUDGE_PRECISION_STEP, 0)
      case 'nudge-up-grid':
        return this.#nudgeNativeSelection(0, -GRID_SIZE)
      case 'nudge-down-grid':
        return this.#nudgeNativeSelection(0, GRID_SIZE)
      case 'nudge-left-grid':
        return this.#nudgeNativeSelection(-GRID_SIZE, 0)
      case 'nudge-right-grid':
        return this.#nudgeNativeSelection(GRID_SIZE, 0)
      case 'rotate-left':
        return this.#transformNativeSelection('rotate-left')
      case 'rotate-right':
        return this.#transformNativeSelection('rotate-right')
      case 'flip-horizontal':
        return this.#transformNativeSelection('flip-horizontal')
      case 'flip-vertical':
        return this.#transformNativeSelection('flip-vertical')
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
      this.#symbolPlacement = null
      this.#tool = 'select'
      this.#render()
      return
    }

    if (action === 'cancel-wall-chain') {
      this.#wallChain = null
      this.#chainPreviewEnd = null
      this.#snapTarget = null
      this.#snapIndicatorKind = 'wall'
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
      this.#snapTarget = null
      this.#snapIndicatorKind = 'wall'
      this.#stagePointerId = null
      this.#render()
      return
    }

    if (this.#tool !== 'select') {
      this.#activateTool('select')
    }
  }

  #isEndpointSnapShape(shape: Shape): shape is LineShape {
    return shape.kind === 'wall'
  }

  #snapToEndpoints(point: Point): { point: Point; snapped: boolean } {
    const SNAP_RADIUS = 20
    let best: Point | null = null
    let bestDist = SNAP_RADIUS
    for (const shape of this.#shapes) {
      if (!this.#isEndpointSnapShape(shape)) continue
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
    const bounds = symbolContentBounds(shape)
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

  #closestPointOnSegment(point: Point, start: Point, end: Point): Point {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared === 0) return { x: start.x, y: start.y }
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
    return {
      x: start.x + dx * t,
      y: start.y + dy * t
    }
  }

  #snapSymbolToWallOffset(point: Point, symbolHalfExtent: number): { point: Point; snapped: boolean } {
    const SNAP_RADIUS_FACTOR = 2
    const WALL_EDGE_OFFSET_FACTOR = 5 / 12
    const snapRadius = symbolHalfExtent * SNAP_RADIUS_FACTOR
    let bestPoint: Point | null = null
    let bestDistance = snapRadius

    for (const shape of this.#shapes) {
      if (shape.kind !== 'wall') continue
      const closest = this.#closestPointOnSegment(point, shape.start, shape.end)
      const distance = Math.hypot(point.x - closest.x, point.y - closest.y)
      if (distance >= bestDistance) continue

      const dx = shape.end.x - shape.start.x
      const dy = shape.end.y - shape.start.y
      const length = Math.hypot(dx, dy)
      if (length === 0) continue
      const nx = -dy / length
      const ny = dx / length
      const sideByPointer = Math.sign((point.x - closest.x) * nx + (point.y - closest.y) * ny)
      const side = sideByPointer === 0 ? 1 : sideByPointer
      const wallStrokePx = typeof shape.strokeWidth === 'number' ? shape.strokeWidth : 12
      const wallHalfThickness = wallStrokePx / (2 * Math.max(this.#zoom, 0.1))
      const wallDerivedMinGap = wallHalfThickness * (5 / 6)
      const wallEdgeOffset = Math.max(symbolHalfExtent * WALL_EDGE_OFFSET_FACTOR, wallDerivedMinGap)
      const centerOffset = wallHalfThickness + symbolHalfExtent + wallEdgeOffset

      bestPoint = {
        x: closest.x + nx * side * centerOffset,
        y: closest.y + ny * side * centerOffset
      }
      bestDistance = distance
    }

    return bestPoint ? { point: bestPoint, snapped: true } : { point, snapped: false }
  }

  // Snap the symbol center onto a nearby line axis (one-wire branch/feeder/bus).
  // Keeps the along-line coordinate on the grid so symbols line up in columns.
  #snapSymbolToBranchLine(point: Point): { point: Point; snapped: boolean } {
    const SNAP_RADIUS = 18
    let best: Point | null = null
    let bestDistance = SNAP_RADIUS

    for (const shape of this.#shapes) {
      if (shape.kind !== 'line') continue
      const closest = this.#closestPointOnSegment(point, shape.start, shape.end)
      const distance = Math.hypot(point.x - closest.x, point.y - closest.y)
      if (distance >= bestDistance) continue

      const horizontal = Math.abs(shape.end.y - shape.start.y) <= Math.abs(shape.end.x - shape.start.x)
      const gridded = this.#snapPoint(point)
      best = horizontal ? { x: gridded.x, y: closest.y } : { x: closest.x, y: gridded.y }
      bestDistance = distance
    }

    return best ? { point: best, snapped: true } : { point, snapped: false }
  }

  // Takes the raw (unsnapped) world point; skips grid snapping when a wall is in range.
  #snapSymbolPlacementPoint(rawPoint: Point): { point: Point; snapped: boolean; kind: SnapIndicatorKind } {
    const symbolScale = this.#pendingCatalogSymbol ? inferSymbolScale(this.#pendingCatalogSymbol.path) : 1
    const symbolHalfExtent = (24 * Math.max(0.4, symbolScale)) / 2

    // Check wall snap on the raw cursor position so grid jitter can't push us away.
    const wall = this.#snapSymbolToWallOffset(rawPoint, symbolHalfExtent)
    if (wall.snapped) return { point: wall.point, snapped: true, kind: 'wall' }

    // Branch/feeder lines win over plain grid: the symbol center lands exactly on the wire axis.
    const branch = this.#snapSymbolToBranchLine(rawPoint)
    if (branch.snapped) return { point: branch.point, snapped: true, kind: 'electrical' }

    // No wall or branch nearby — fall back to grid snap then electrical snap.
    const gridSnapped = this.#snapPoint(rawPoint)
    const electrical = this.#snapToElectricalPoints(gridSnapped)
    if (electrical.snapped) return { point: electrical.point, snapped: true, kind: 'electrical' }
    return { point: gridSnapped, snapped: false, kind: 'wall' }
  }

  #shouldShowSnapIndicator(): boolean {
    if (!this.#snapTarget || !this.#snap || this.#tool === 'select') return false
    if (this.#tool === 'wall') return Boolean(this.#wallChain)
    if (this.#tool === 'door' || this.#tool === 'window' || this.#tool === 'gate' || this.#tool === 'line') {
      return Boolean(this.#draft)
    }
    if (this.#tool === 'symbol') return Boolean(this.#pendingCatalogSymbol)
    if (this.#tool === 'onewire') return true
    return false
  }

  #snapIndicatorTemplate() {
    if (!this.#shouldShowSnapIndicator() || !this.#snapTarget) return nothing
    return svg`<circle class=${`snap-indicator snap-indicator-${this.#snapIndicatorKind}`} cx=${this.#snapTarget.x} cy=${this.#snapTarget.y} r="9"></circle>`
  }

  #oneWireComponentSymbol(kind: 'breaker' | 'switch' | 'kamrail' | 'load'): { name: string; path: string } {
    if (kind === 'breaker') return { name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }
    if (kind === 'switch') return { name: 'Switch', path: 'symbols/Switches/Switch general symbol.svg' }
    if (kind === 'kamrail') return { name: 'Kamrail', path: 'symbols/Protection devices/Kamrail.svg' }
    if (this.#oneWirePreset === 'sockets') {
      return { name: 'Socket outlet', path: 'symbols/Socket outlets/Electrical wall outlet.svg' }
    }
    if (this.#oneWirePreset === 'motor') {
      return { name: 'Motor', path: 'symbols/Consumption appliances/Motor.svg' }
    }
    return { name: 'Lighting', path: 'symbols/Consumption appliances/Lighting.svg' }
  }

  #oneWireSymbolScale(path: string, kind: 'breaker' | 'switch' | 'kamrail' | 'load'): number {
    if (kind === 'breaker') return Math.max(0.4, inferSymbolScale(path))
    // Node-normalized scale keeps every switch circle the same rendered size.
    const nodeScale = oneWireSymbolScaleFor(path)
    if (nodeScale !== null) return nodeScale
    return Math.max(0.55, inferSymbolScale(path) * ONEWIRE_SYMBOL_SCALE_MULTIPLIER)
  }

  // Symbols are placed with their geometric center on the wire axis; shifting by
  // optical insets moved switches/circles off the line, so keep this an identity.
  #alignSymbolCenterToVisibleContent(target: Point, _path: string, _scale: number): Point {
    return target
  }

  // Trikker-style cleanup for existing one-wire groups: symbols are centered on
  // their row axis and each horizontal wire is re-cut into segments that stop at
  // the visible edges of the symbols sitting on it. Wires never cross symbols.
  #realignExistingOneWire(): boolean {
    const isOneWire = (shape: Shape) => typeof shape.groupId === 'string' && shape.groupId.startsWith('onewire-')
    const groupedOneWireShapes = this.#shapes.filter(
      (shape) => isOneWire(shape) && !shape.groupId!.startsWith('onewire-kamrail-')
    )
    const bindingFallbackShapes = this.#shapes.filter((shape) => {
      if (shape.kind !== 'line' && shape.kind !== 'symbol') return false
      if (typeof shape.groupId === 'string' && shape.groupId.startsWith('onewire-kamrail-')) return false
      return typeof shape.bindingId === 'string' && shape.bindingId.trim().length > 0
    })
    const oneWireShapes = groupedOneWireShapes.length ? groupedOneWireShapes : bindingFallbackShapes
    if (!oneWireShapes.length) return false

    const symbols = oneWireShapes.filter((shape): shape is SymbolShape => shape.kind === 'symbol')
    const horizontalWires = oneWireShapes.filter(
      (shape): shape is LineShape => shape.kind === 'line' && Math.abs(shape.end.y - shape.start.y) < 1
    )
    if (!horizontalWires.length && !symbols.length) return false

    const AXIS_RADIUS = 20
    const updatedShapes = new Map<string, Shape>()
    const removedIds = new Set<string>()
    const addedShapes: Shape[] = []

    const nodeOffsetFor = (symbol: SymbolShape): Point =>
      oneWireSymbolNodeInfo(symbol.path, symbol.scale)?.offset ?? { x: 0, y: 0 }

    // 1. Snap each symbol's electrical node onto the nearest horizontal wire axis.
    const axisForSymbol = (symbol: SymbolShape): number | null => {
      const offset = nodeOffsetFor(symbol)
      const nodeX = symbol.position.x + offset.x
      const nodeY = symbol.position.y + offset.y
      let best: number | null = null
      let bestDistance = AXIS_RADIUS
      for (const wire of horizontalWires) {
        const minX = Math.min(wire.start.x, wire.end.x) - AXIS_RADIUS
        const maxX = Math.max(wire.start.x, wire.end.x) + AXIS_RADIUS
        if (nodeX < minX || nodeX > maxX) continue
        const distance = Math.abs(nodeY - wire.start.y)
        if (distance < bestDistance) {
          bestDistance = distance
          best = wire.start.y
        }
      }
      return best
    }

    const alignedSymbols: SymbolShape[] = symbols.map((symbol) => {
      const axisY = axisForSymbol(symbol)
      if (axisY === null) return symbol
      const targetY = axisY - nodeOffsetFor(symbol).y
      if (Math.abs(targetY - symbol.position.y) < 0.01) return symbol
      const aligned: SymbolShape = { ...symbol, position: { x: symbol.position.x, y: targetY } }
      updatedShapes.set(aligned.id, aligned)
      return aligned
    })

    // 2. Merge the wire pieces of each group+axis back into one run, then re-cut
    //    it around the symbol nodes (passthrough symbols leave the wire intact).
    const wireRuns = new Map<
      string,
      { wires: LineShape[]; y: number; groupId: string | null; bindingId: string | null }
    >()
    for (const wire of horizontalWires) {
      const runGroupId = typeof wire.groupId === 'string' && wire.groupId.trim().length ? wire.groupId : null
      const runBindingId = typeof wire.bindingId === 'string' && wire.bindingId.trim().length ? wire.bindingId : null
      const key = `${runGroupId ?? `binding:${runBindingId ?? 'none'}`}::${Math.round(wire.start.y)}`
      const run = wireRuns.get(key)
      if (run) run.wires.push(wire)
      else wireRuns.set(key, { wires: [wire], y: wire.start.y, groupId: runGroupId, bindingId: runBindingId })
    }

    for (const { wires, y, groupId: runGroupId, bindingId: runBindingId } of wireRuns.values()) {
      const from = Math.min(...wires.map((wire) => Math.min(wire.start.x, wire.end.x)))
      const to = Math.max(...wires.map((wire) => Math.max(wire.start.x, wire.end.x)))

      const cuts: Array<{ from: number; to: number }> = []
      let lastExtent = Number.NEGATIVE_INFINITY
      for (const symbol of alignedSymbols) {
        if (runGroupId && symbol.groupId !== runGroupId) continue
        if (!runGroupId && runBindingId && symbol.bindingId !== runBindingId) continue
        const node = oneWireSymbolNodeInfo(symbol.path, symbol.scale)
        const offset = node?.offset ?? { x: 0, y: 0 }
        const nodeY = symbol.position.y + offset.y
        if (Math.abs(nodeY - y) >= 1) continue
        const symbolKind = this.#composeKindForShape(symbol)
        if (node) {
          const nodeX = symbol.position.x + offset.x
          if (node.cutHalfWidth === null) {
            // Passthrough consumer: the wire runs under it up to its node.
            lastExtent = Math.max(lastExtent, nodeX)
            continue
          }
          const cutFrom = nodeX - node.cutHalfWidth
          const cutTo = nodeX + node.cutHalfWidth
          lastExtent = Math.max(lastExtent, cutTo)
          if (cutTo > from && cutFrom < to) cuts.push({ from: cutFrom, to: cutTo })
          continue
        }
        if (symbolKind === 'load') {
          // Unknown load symbols: cut around the visual center reach so wires
          // connect to the symbol edge without crossing through it.
          const bounds = symbolContentBounds(symbol)
          const nodeX = symbol.position.x
          const leftReach = Math.max(0, nodeX - bounds.x)
          const rightReach = Math.max(0, bounds.x + bounds.width - nodeX)
          const centeredHalfWidth = Math.max(2, Math.min(leftReach, rightReach))
          const cutFrom = nodeX - centeredHalfWidth
          const cutTo = nodeX + centeredHalfWidth
          lastExtent = Math.max(lastExtent, cutTo)
          if (cutTo > from && cutFrom < to) cuts.push({ from: cutFrom, to: cutTo })
          continue
        }
        const bounds = symbolContentBounds(symbol)
        lastExtent = Math.max(lastExtent, bounds.x + bounds.width)
        if (bounds.x + bounds.width > from && bounds.x < to) {
          cuts.push({ from: bounds.x, to: bounds.x + bounds.width })
        }
      }
      cuts.sort((a, b) => a.from - b.from)

      // The wire ends at the last consumer — trim any trailing stub.
      const runTo = Number.isFinite(lastExtent) ? Math.min(to, Math.max(lastExtent, from)) : to

      const segments: Array<{ from: number; to: number }> = []
      let cursor = from
      for (const cut of cuts) {
        if (cut.from > cursor + 0.5) segments.push({ from: cursor, to: Math.min(cut.from, runTo) })
        cursor = Math.max(cursor, cut.to)
        if (cursor >= runTo) break
      }
      if (runTo > cursor + 0.5) segments.push({ from: cursor, to: runTo })

      const existing = wires
        .map((wire) => ({ from: Math.min(wire.start.x, wire.end.x), to: Math.max(wire.start.x, wire.end.x) }))
        .sort((a, b) => a.from - b.from)
      const unchanged =
        existing.length === segments.length &&
        existing.every(
          (span, index) =>
            Math.abs(span.from - segments[index].from) < 0.6 && Math.abs(span.to - segments[index].to) < 0.6
        )
      if (unchanged) continue

      for (const wire of wires) removedIds.add(wire.id)
      for (const segment of segments) {
        addedShapes.push({
          ...cloneShape(wires[0]),
          id: nextShapeId(),
          start: { x: segment.from, y },
          end: { x: segment.to, y }
        } as LineShape)
      }
    }

    if (!updatedShapes.size && !removedIds.size) return false

    this.#shapes = this.#shapes
      .filter((shape) => !removedIds.has(shape.id))
      .map((shape) => updatedShapes.get(shape.id) ?? shape)
    this.#shapes.push(...addedShapes)
    this.#selectedId = null
    this.#selectedIds = new Set()
    this.#pushHistory()
    this.#render()
    return true
  }

  #isKamrailShape(shape: Shape | null): shape is LineShape {
    return Boolean(shape && shape.kind === 'line' && shape.groupId?.startsWith('onewire-kamrail-'))
  }

  #normalizeBindingFamily(value: string | null): string | null {
    const cleaned = String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
    return cleaned || null
  }

  #composeKindForShape(shape: Shape): 'switch' | 'load' {
    if (shape.kind === 'door' || shape.kind === 'gate') return 'switch'
    if (shape.kind !== 'symbol') return 'load'
    const lower = `${shape.name} ${shape.path}`.toLowerCase()
    return lower.includes('switch') || lower.includes('schakel') || lower.includes('knop') ? 'switch' : 'load'
  }

  #groundplanShapePool(): Shape[] {
    const currentPageType = this.#pageKey ? this.#project?.pages?.[this.#pageKey]?.pageType : undefined
    const pool: Shape[] = currentPageType === 'onewire' ? [] : [...this.#shapes]
    if (!this.#project?.pages) return pool

    for (const pageKey of Object.keys(this.#project.pages) as UUID[]) {
      if (pageKey === this.#pageKey) continue
      const page = this.#project.pages[pageKey]
      if (page?.pageType === 'onewire') continue
      const state = this.#nativeStateForPage(pageKey)
      if (!state || !Array.isArray(state.shapes)) continue
      pool.push(...sanitizeShapes(state.shapes))
    }

    return pool
  }

  #groundplanComponentsForFamily(
    family: string
  ): Array<{ bindingId: string; kind: 'switch' | 'load'; sourcePath?: string; sourceName?: string }> {
    const entries: Array<{
      bindingId: string
      kind: 'switch' | 'load'
      number: number
      sourcePath?: string
      sourceName?: string
    }> = []
    const pool = this.#groundplanShapePool()

    let highestNumber = 0
    for (const shape of pool) {
      if (typeof shape.groupId === 'string' && shape.groupId.startsWith('onewire-')) continue
      const rawBinding = 'bindingId' in shape && typeof shape.bindingId === 'string' ? shape.bindingId.trim() : ''
      if (!rawBinding) continue

      const normalized = rawBinding.toUpperCase()
      const match = /^([A-Z]+)(\d+)?$/.exec(normalized)
      if (!match || match[1] !== family) continue

      const number = Number(match[2] ?? '0')
      highestNumber = Math.max(highestNumber, number)
      entries.push({
        bindingId: match[2] ? `${family}${number}` : '',
        kind: this.#composeKindForShape(shape),
        number,
        sourcePath: shape.kind === 'symbol' ? shape.path : undefined,
        sourceName: shape.kind === 'symbol' ? shape.name : undefined
      })
    }

    let fallbackNumber = Math.max(1, highestNumber + 1)
    const normalizedEntries = entries.map((entry) => {
      if (entry.bindingId) return entry
      const bindingId = `${family}${fallbackNumber}`
      fallbackNumber += 1
      return { ...entry, bindingId, number: Number(bindingId.slice(family.length)) || fallbackNumber }
    })

    normalizedEntries.sort((a, b) => {
      if (a.number !== b.number) return a.number - b.number
      if (a.kind === b.kind) return 0
      return a.kind === 'switch' ? -1 : 1
    })

    return normalizedEntries.map(({ bindingId, kind, sourcePath, sourceName }) => ({
      bindingId,
      kind,
      sourcePath,
      sourceName
    }))
  }

  #addKamrailCircuitBundle(
    rail: LineShape,
    anchorX: number,
    options: { amps: number; family: string; autoIncludeFamily: boolean }
  ): boolean {
    const clampX = Math.max(
      Math.min(anchorX, Math.max(rail.start.x, rail.end.x) - 20),
      Math.min(rail.start.x, rail.end.x) + 20
    )
    const familyComponents = options.autoIncludeFamily ? this.#groundplanComponentsForFamily(options.family) : []
    const resolvedComponents = familyComponents.length
      ? familyComponents
      : [{ bindingId: `${options.family}1`, kind: 'load' as const, sourcePath: undefined, sourceName: undefined }]
    const startX = clampX
    const railY = rail.start.y

    const rows = new Map<string, Array<(typeof resolvedComponents)[number]>>()
    for (const entry of resolvedComponents) {
      const existing = rows.get(entry.bindingId)
      if (existing) existing.push(entry)
      else rows.set(entry.bindingId, [entry])
    }

    const orderedRows = [...rows.entries()].sort((a, b) => {
      const parse = (value: string): { letter: string; number: number } => {
        const match = /^([A-Z]+)(\d+)?$/.exec(value)
        return { letter: match?.[1] ?? value, number: Number(match?.[2] ?? '0') }
      }
      const ka = parse(a[0])
      const kb = parse(b[0])
      if (ka.letter !== kb.letter) return ka.letter.localeCompare(kb.letter)
      return ka.number - kb.number
    })

    const ROW_START_OFFSET_X = 64
    const ROW_SYMBOL_SPACING_X = 46
    const ROW_SYMBOL_MARGIN_X = 6
    const ROW_TOP_OFFSET_Y = 46
    const ROW_SPACING_Y = 48

    const createdIds: string[] = []
    const breakerBindingId = options.family
    {
      const x = startX - 10
      const kind: 'breaker' = 'breaker'
      const component = this.#oneWireComponentSymbol(kind)
      const scale = this.#oneWireSymbolScale(component.path, kind)
      const center: Point = { x, y: railY - KAMRAIL_ATTACH_OFFSET }
      const groupId = `onewire-${nextShapeId()}`

      const labelText = `${Math.max(1, Math.round(options.amps))}A`
      const symbol: SymbolShape = {
        id: nextShapeId(),
        kind: 'symbol',
        position: center,
        name: component.name,
        path: component.path,
        scale,
        // The Automaat symbol carries its own "20A" text field — override it
        // instead of adding a duplicate loose label next to the symbol.
        symbolTextOverrides: { 'desc:20A': labelText },
        bindingId: breakerBindingId,
        groupId
      }
      const contentBounds = symbolContentBounds(symbol)

      // Trikker-style: the wire stops at the visible edge of the symbol.
      const connector: LineShape = {
        id: nextShapeId(),
        kind: 'line',
        start: { x, y: railY },
        end: { x, y: contentBounds.y + contentBounds.height },
        stroke: ONEWIRE_BRANCH_STROKE,
        strokeWidth: 2,
        bindingId: breakerBindingId,
        groupId
      }

      this.#shapes.push(connector, symbol)
      createdIds.push(connector.id, symbol.id)
    }

    if (orderedRows.length > 0) {
      const trunkTopY = railY - ROW_TOP_OFFSET_Y - (orderedRows.length - 1) * ROW_SPACING_Y
      const trunk: LineShape = {
        id: nextShapeId(),
        kind: 'line',
        start: { x: startX, y: railY },
        end: { x: startX, y: trunkTopY },
        stroke: ONEWIRE_BRANCH_STROKE,
        strokeWidth: 2,
        bindingId: breakerBindingId,
        groupId: `onewire-${nextShapeId()}`
      }
      this.#shapes.push(trunk)
      createdIds.push(trunk.id)
    }

    for (const [rowIndex, [bindingId, entries]] of orderedRows.entries()) {
      const rowY = railY - ROW_TOP_OFFSET_Y - rowIndex * ROW_SPACING_Y
      const rowStartX = startX
      const symbolBaseX = startX + ROW_START_OFFSET_X
      const bindingNumberMatch = /^([A-Z]+)(\d+)$/.exec(bindingId)
      const rowNumber = bindingNumberMatch ? Number(bindingNumberMatch[2]) : rowIndex + 1
      const groupId = `onewire-${nextShapeId()}`

      // Multiple lamp consumers collapse into one lamp symbol + a "xN" count.
      const resolvedEntryPath = (entry: (typeof entries)[number]): string =>
        entry.sourcePath ?? this.#oneWireComponentSymbol(entry.kind).path
      const lampEntries = entries.filter(
        (entry) => entry.kind === 'load' && /lighting|lamp|fluorescent/i.test(resolvedEntryPath(entry))
      )
      const lampCount = lampEntries.length
      const collapsedEntries =
        lampCount > 1 ? [...entries.filter((entry) => !lampEntries.includes(entry)), lampEntries[0]] : entries

      type RowSymbolSpec = {
        kind: 'switch' | 'load'
        component: { name: string; path: string }
        scale: number
        node: ReturnType<typeof oneWireSymbolNodeInfo>
        rotation: number | undefined
        leftReach: number
        rightReach: number
      }

      const rowSymbolSpecs: RowSymbolSpec[] = collapsedEntries.map((entry) => {
        const fallback = this.#oneWireComponentSymbol(entry.kind)
        const component = {
          name: entry.sourceName ?? fallback.name,
          path: entry.sourcePath ?? fallback.path
        }
        const scale = this.#oneWireSymbolScale(component.path, entry.kind)
        const node = oneWireSymbolNodeInfo(component.path, scale)
        const rotation = oneWireSymbolRotationFor(component.path)
        const probeSlotX = 0
        const probe: SymbolShape = {
          id: nextShapeId(),
          kind: 'symbol',
          position: node ? { x: probeSlotX - node.offset.x, y: rowY - node.offset.y } : { x: probeSlotX, y: rowY },
          name: component.name,
          path: component.path,
          scale,
          bindingId,
          groupId
        }
        if (typeof rotation === 'number') probe.rotation = rotation
        const bounds = symbolContentBounds(probe)
        const leftReach = probeSlotX - bounds.x
        const rightReach = bounds.x + bounds.width - probeSlotX
        return { kind: entry.kind, component, scale, node, rotation, leftReach, rightReach }
      })

      const slotXs: number[] = []
      for (const [symbolIndex, spec] of rowSymbolSpecs.entries()) {
        if (symbolIndex === 0) {
          slotXs.push(symbolBaseX)
          continue
        }
        const prevSpec = rowSymbolSpecs[symbolIndex - 1]
        const prevX = slotXs[symbolIndex - 1]
        const minGap = prevSpec.rightReach + spec.leftReach + ROW_SYMBOL_MARGIN_X
        const preferredGap = Math.max(minGap, ROW_SYMBOL_SPACING_X)
        slotXs.push(prevX + preferredGap)
      }

      // Symbols first (Trikker-style slots on the wire axis). The electrical
      // node of each symbol — not its bounding box — lands exactly on the slot.
      const rowSymbols: SymbolShape[] = rowSymbolSpecs.map((spec, symbolIndex) => {
        const slot: Point = { x: slotXs[symbolIndex] ?? symbolBaseX, y: rowY }
        const symbol: SymbolShape = {
          id: nextShapeId(),
          kind: 'symbol',
          position: spec.node ? { x: slot.x - spec.node.offset.x, y: slot.y - spec.node.offset.y } : slot,
          name: spec.component.name,
          path: spec.component.path,
          scale: spec.scale,
          bindingId,
          groupId
        }
        if (typeof spec.rotation === 'number') symbol.rotation = spec.rotation
        return symbol
      })

      // Wire segments between trunk and symbols — the wire is only interrupted
      // around each symbol's node and ENDS at the last consumer (no stub).
      let cursor = rowStartX
      let wireEndX = rowStartX
      const wireSegments: Array<{ from: number; to: number }> = []
      for (const [symbolIndex, symbol] of rowSymbols.entries()) {
        const node = oneWireSymbolNodeInfo(symbol.path, symbol.scale)
        const slotX = slotXs[symbolIndex] ?? symbolBaseX
        const spec = rowSymbolSpecs[symbolIndex]
        if (node) {
          if (node.cutHalfWidth === null) {
            // Passthrough (lamp cross): the wire runs under it up to its node.
            wireEndX = Math.max(wireEndX, slotX)
            continue
          }
          const from = slotX - node.cutHalfWidth
          const to = slotX + node.cutHalfWidth
          if (from > cursor + 0.5) wireSegments.push({ from: cursor, to: from })
          cursor = Math.max(cursor, to)
          wireEndX = Math.max(wireEndX, cursor)
          continue
        }
        if (spec?.kind === 'load') {
          // Unknown load symbols: cut around center-reach to avoid branches
          // crossing through the symbol while keeping a tight connection.
          const bounds = symbolContentBounds(symbol)
          const leftReach = Math.max(0, slotX - bounds.x)
          const rightReach = Math.max(0, bounds.x + bounds.width - slotX)
          const centeredHalfWidth = Math.max(2, Math.min(leftReach, rightReach))
          const from = slotX - centeredHalfWidth
          const to = slotX + centeredHalfWidth
          if (from > cursor + 0.5) wireSegments.push({ from: cursor, to: from })
          cursor = Math.max(cursor, to)
          wireEndX = Math.max(wireEndX, cursor)
          continue
        }
        const bounds = symbolContentBounds(symbol)
        if (bounds.x > cursor + 0.5) wireSegments.push({ from: cursor, to: bounds.x })
        cursor = Math.max(cursor, bounds.x + bounds.width)
        wireEndX = Math.max(wireEndX, cursor)
      }
      if (wireEndX > cursor + 0.5) wireSegments.push({ from: cursor, to: wireEndX })
      const lastSlotX = slotXs.length ? slotXs[slotXs.length - 1] : symbolBaseX

      for (const segment of wireSegments) {
        const wire: LineShape = {
          id: nextShapeId(),
          kind: 'line',
          start: { x: segment.from, y: rowY },
          end: { x: segment.to, y: rowY },
          stroke: ONEWIRE_BRANCH_STROKE,
          strokeWidth: 2,
          bindingId,
          groupId
        }
        this.#shapes.push(wire)
        createdIds.push(wire.id)
      }

      const rowNumberText = `${rowNumber}`
      const rowNumberX = rowStartX - 14 - Math.max(0, rowNumberText.length - 1) * 7
      const rowNumberLabel = {
        ...createTextShape(nextShapeId(), { x: rowNumberX, y: rowY - 2 }, rowNumberText),
        fill: '#000000',
        bindingId,
        groupId
      }
      this.#shapes.push(rowNumberLabel)
      createdIds.push(rowNumberLabel.id)

      // Lamp count indicator ("x4") right next to the collapsed lamp symbol.
      if (lampCount > 1) {
        const countLabel = {
          ...createTextShape(nextShapeId(), { x: lastSlotX + 16, y: rowY + 5 }, `x${lampCount}`),
          fill: '#000000',
          scale: 0.8,
          bindingId,
          groupId
        }
        this.#shapes.push(countLabel)
        createdIds.push(countLabel.id)
      }

      for (const symbol of rowSymbols) {
        this.#shapes.push(symbol)
        createdIds.push(symbol.id)
      }
    }

    if (!createdIds.length) return false
    this.#selectedId = createdIds[1] ?? createdIds[0] ?? null
    this.#selectedIds = new Set(createdIds)
    this.#oneWireBindingId = this.#nextOneWireBindingId()
    return true
  }

  #nearestKamrail(point: Point): { rail: LineShape; point: Point } | null {
    const SNAP_RADIUS = 72
    let best: { rail: LineShape; point: Point } | null = null
    let bestDistance = SNAP_RADIUS

    for (const shape of this.#shapes) {
      if (shape.kind !== 'line') continue
      if (!shape.groupId?.startsWith('onewire-kamrail-')) continue
      const closest = this.#closestPointOnSegment(point, shape.start, shape.end)
      const distance = Math.hypot(point.x - closest.x, point.y - closest.y)
      if (distance >= bestDistance) continue
      bestDistance = distance
      best = { rail: shape, point: closest }
    }

    return best
  }

  #createKamrailAt(point: Point): boolean {
    const snapped = this.#snapPoint(point)
    const groupId = `onewire-kamrail-${nextShapeId()}`
    const railStart: Point = { x: snapped.x - KAMRAIL_HALF_LENGTH, y: snapped.y }
    const railEnd: Point = { x: snapped.x + KAMRAIL_HALF_LENGTH, y: snapped.y }

    const rail: LineShape = {
      id: nextShapeId(),
      kind: 'line',
      start: railStart,
      end: railEnd,
      stroke: '#111111',
      strokeWidth: KAMRAIL_STROKE_WIDTH,
      groupId
    }

    this.#shapes.push(rail)
    this.#selectedId = rail.id
    this.#selectedIds = new Set([rail.id])
    return true
  }

  #composeOneWireOnKamrailAt(point: Point): boolean {
    if (this.#oneWireComposeKind === 'kamrail') return false
    const railAnchor = this.#nearestKamrail(point)
    if (!railAnchor) return false

    const component = this.#oneWireComponentSymbol(this.#oneWireComposeKind)
    const scale = this.#oneWireSymbolScale(component.path, this.#oneWireComposeKind)
    const placeBelowRail = false
    const center: Point = {
      x: railAnchor.point.x,
      y: railAnchor.point.y + (placeBelowRail ? KAMRAIL_ATTACH_OFFSET : -KAMRAIL_ATTACH_OFFSET)
    }

    const bindingId = this.#oneWireBindingId
    const groupId = `onewire-${nextShapeId()}`

    const symbol: SymbolShape = {
      id: nextShapeId(),
      kind: 'symbol',
      position: center,
      name: component.name,
      path: component.path,
      scale,
      bindingId,
      groupId
    }
    const contentBounds = symbolContentBounds(symbol)

    // Wire stops at the visible symbol edge.
    const connector: LineShape = {
      id: nextShapeId(),
      kind: 'line',
      start: { x: center.x, y: railAnchor.point.y },
      end: { x: center.x, y: placeBelowRail ? contentBounds.y : contentBounds.y + contentBounds.height },
      stroke: ONEWIRE_BRANCH_STROKE,
      strokeWidth: 2,
      bindingId,
      groupId
    }

    const labelText = bindingId
    const label = {
      ...createTextShape(
        nextShapeId(),
        {
          x: contentBounds.x + contentBounds.width + 12,
          y: placeBelowRail
            ? contentBounds.y + contentBounds.height / 2 + 4
            : contentBounds.y + contentBounds.height / 2 - 6
        },
        labelText
      ),
      fill: '#000000',
      bindingId,
      groupId
    }

    this.#shapes.push(connector, symbol, label)
    this.#selectedId = symbol.id
    this.#selectedIds = new Set([connector.id, symbol.id, label.id])
    this.#oneWireBindingId = this.#nextOneWireBindingId()
    return true
  }

  #composeOneWireAt(point: Point, useDirectional = false): boolean {
    const anchor = this.#nearestElectricalAnchor(point)
    if (!anchor.snapped || !anchor.hostSymbol || !anchor.side) return false

    const hostBounds = shapeBounds(anchor.hostSymbol)
    const hostCx = hostBounds.x + hostBounds.width / 2
    const hostCy = hostBounds.y + hostBounds.height / 2
    const dx = point.x - hostCx
    const dy = point.y - hostCy

    // Strong horizontal preference: default to left/right and only use top/bottom
    // when cursor is almost perfectly above/below the host center.
    const preferredHorizontalSide: 'left' | 'right' = dx < 0 ? 'left' : 'right'

    // Directional intent: derive attachment side from cursor offset vs host center
    // unless Shift is held (forces nearest anchor side).
    let side = anchor.side
    if (useDirectional) {
      if (Math.abs(dx) >= 6 || Math.abs(dx) >= Math.abs(dy) * 0.5) {
        side = preferredHorizontalSide
      } else {
        side = dy < 0 ? 'top' : 'bottom'
      }
    } else if (side === 'top' || side === 'bottom') {
      side = preferredHorizontalSide
    }

    const component = this.#oneWireComponentSymbol(this.#oneWireComposeKind)
    const scale = this.#oneWireSymbolScale(component.path, this.#oneWireComposeKind)
    // Real render size is 24 * scale (not 40) — keep slot math on the actual size.
    const size = 24 * Math.max(0.4, scale)
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

    const bindingId = anchor.hostSymbol.bindingId ?? this.#oneWireBindingId
    const groupId = anchor.hostSymbol.groupId ?? `onewire-${nextShapeId()}`
    const newSymbol: SymbolShape = {
      id: nextShapeId(),
      kind: 'symbol',
      position: center,
      name: component.name,
      path: component.path,
      scale,
      groupId
    }

    // Wire runs from the host's visible edge to the new symbol's visible edge.
    const contentBounds = symbolContentBounds(newSymbol)
    const connectorEnd: Point =
      side === 'top'
        ? { x: attachPoint.x, y: contentBounds.y + contentBounds.height }
        : side === 'bottom'
          ? { x: attachPoint.x, y: contentBounds.y }
          : side === 'left'
            ? { x: contentBounds.x + contentBounds.width, y: attachPoint.y }
            : { x: contentBounds.x, y: attachPoint.y }
    const connector: LineShape = {
      id: nextShapeId(),
      kind: 'line',
      start: attachPoint,
      end: connectorEnd,
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
    return wallChainPreviewTemplate(this.#wallChain, this.#chainPreviewEnd)
  }

  #measurementTemplate(from: Point | null, to: Point | null) {
    return measurementTemplate(from, to)
  }

  #publishNativeSelection(selectedShape: Shape | null) {
    if (this.#selectedId === PROJECT_LOGO_SHAPE_ID && isProjectLogoVisible(this.#project)) {
      const logoBounds = getProjectLogoBounds(this.#project)
      const logoScaleRaw =
        typeof this.#project?.logoScale === 'number' && Number.isFinite(this.#project.logoScale)
          ? this.#project.logoScale
          : 1
      const logoColor = this.#project?.logoColor?.trim() ?? ''
      pubsub.publish('native.selection.changed', {
        selectionCount: 1,
        shape: {
          id: PROJECT_LOGO_SHAPE_ID,
          kind: 'symbol',
          name: 'Logo',
          scale: Math.max(0.4, Math.min(2.5, logoScaleRaw)),
          fill: logoColor,
          stroke: '',
          canSetStrokeWidth: false,
          x: logoBounds.x + logoBounds.width / 2,
          y: logoBounds.y + logoBounds.height / 2
        }
      })
      return
    }

    const groupedSelection = this.#selectedGroupId()
    pubsub.publish(
      'native.selection.changed',
      createNativeSelectionChangedPayload(selectedShape, groupedSelection ? 1 : this.#selectedIds.size, {
        kindOverride: groupedSelection ? 'group' : undefined,
        bindingIdOverride: groupedSelection ? this.#selectedGroupBindingId() : undefined
      })
    )
  }

  #selectedOutlineMarkup(shape: Shape | null): string {
    return selectedOutlineMarkup(shape)
  }

  #nativeDocumentState(): NativeDocumentState {
    return {
      version: 1,
      shapes: this.#shapes,
      selectedId: this.#selectedId as UUID | null,
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

  #exportViewBox(
    orientation: 'portrait' | 'landscape'
  ): { x: number; y: number; width: number; height: number } | null {
    if (!this.#shapes.length) return null

    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const shape of this.#shapes) {
      const bounds = shapeBounds(shape)
      minX = Math.min(minX, bounds.x)
      minY = Math.min(minY, bounds.y)
      maxX = Math.max(maxX, bounds.x + bounds.width)
      maxY = Math.max(maxY, bounds.y + bounds.height)

      if (shape.kind === 'door') {
        const { length, nx, ny } = lineMetrics(shape)
        const side = shape.flipSide ? -1 : 1
        const tipX = shape.start.x + nx * side * length
        const tipY = shape.start.y + ny * side * length
        minX = Math.min(minX, tipX)
        minY = Math.min(minY, tipY)
        maxX = Math.max(maxX, tipX)
        maxY = Math.max(maxY, tipY)
      }

      if (shape.kind === 'gate') {
        const { length, nx, ny } = lineMetrics(shape)
        const side = shape.flipSide ? -1 : 1
        const half = length / 2
        const tip1X = shape.start.x + nx * side * half
        const tip1Y = shape.start.y + ny * side * half
        const tip2X = shape.end.x + nx * side * half
        const tip2Y = shape.end.y + ny * side * half
        minX = Math.min(minX, tip1X, tip2X)
        minY = Math.min(minY, tip1Y, tip2Y)
        maxX = Math.max(maxX, tip1X, tip2X)
        maxY = Math.max(maxY, tip1Y, tip2Y)
      }
    }

    const padding = GRID_SIZE * 3
    let x = minX - padding
    let y = minY - padding
    let width = Math.max(1, maxX - minX + padding * 2)
    let height = Math.max(1, maxY - minY + padding * 2)

    const targetRatio = orientation === 'landscape' ? 3508 / 2480 : 2480 / 3508
    const currentRatio = width / height

    if (currentRatio > targetRatio) {
      const targetHeight = width / targetRatio
      y -= (targetHeight - height) / 2
      height = targetHeight
    } else if (currentRatio < targetRatio) {
      const targetWidth = height * targetRatio
      x -= (targetWidth - width) / 2
      width = targetWidth
    }

    return { x, y, width, height }
  }

  #buildSvgDocument(viewBox?: { x: number; y: number; width: number; height: number }, monochrome = false) {
    const buildDocument = buildSvgDocument as unknown as (options: Record<string, unknown>) => string
    const overlayScale = viewBox ? Math.min(viewBox.width / this.#worldWidth, viewBox.height / this.#worldHeight) : 1
    const exportOptions: Record<string, unknown> = {
      shapes: this.#shapes,
      selectedShape: this.#shapeById(this.#selectedId),
      paper: this.#paperMeta(),
      worldWidth: this.#worldWidth,
      worldHeight: this.#worldHeight,
      pageOverlayScale: overlayScale,
      viewBox,
      monochrome
    }

    return buildDocument(exportOptions)
  }

  #nativeStateForPage(pageKey: UUID): Partial<NativeDocumentState> | null {
    const page = this.#project?.pages?.[pageKey]
    if (!page || typeof page !== 'object') return null
    const schema = (page as { schema?: unknown }).schema
    if (!schema || typeof schema !== 'object') return null

    const nativeObjects = (schema as { objects?: unknown[] }).objects
    if (Array.isArray(nativeObjects)) {
      for (const object of nativeObjects) {
        if (!object || typeof object !== 'object') continue
        const candidate = object as { kind?: unknown; payload?: unknown }
        if (candidate.kind !== 'cadle-native-svg-document') continue
        const payload = candidate.payload
        if (payload && typeof payload === 'object' && Array.isArray((payload as { shapes?: unknown[] }).shapes)) {
          return payload as Partial<NativeDocumentState>
        }
      }
    }

    const legacy = migrateLegacySchemaToNativeState(schema)
    if (legacy) return legacy

    return null
  }

  #projectTitleBlockBounds(layoutScale = 1) {
    if (!this.#project) return null
    return getProjectTitleBlockBounds(this.#worldWidth, this.#worldHeight, layoutScale)
  }

  #projectTitleBlockTemplate() {
    if (!this.#project) return nothing
    return unsafeSVG(
      buildProjectTitleBlockMarkup(
        this.#project,
        this.#project?.pages?.[this.#pageKey ?? '']?.name ?? '',
        this.#worldWidth,
        this.#worldHeight,
        this.#pageKey ?? ''
      )
    )
  }

  async #ensureSymbolMarkupReady() {
    const symbolPaths = new Set<string>()
    for (const shape of this.#shapes) {
      if (shape.kind === 'symbol') symbolPaths.add(shape.path)
    }
    if (this.#pendingCatalogSymbol?.path) symbolPaths.add(this.#pendingCatalogSymbol.path)
    const projectLogoUrl = this.#project?.logoUrl?.trim() ?? ''
    if (
      isProjectLogoVisible(this.#project) &&
      projectLogoUrl &&
      /^(data:image\/svg\+xml|.*\.svg(?:$|[?#]))/i.test(projectLogoUrl)
    ) {
      symbolPaths.add(projectLogoUrl)
    }
    if (!symbolPaths.size) return

    await Promise.all([...symbolPaths].map((path) => preloadSymbolSvg(path)))
  }

  #primeSymbolSvgCache() {
    const symbolPaths = new Set<string>()
    for (const shape of this.#shapes) {
      if (shape.kind === 'symbol') symbolPaths.add(shape.path)
    }
    if (this.#pendingCatalogSymbol?.path) symbolPaths.add(this.#pendingCatalogSymbol.path)
    const projectLogoUrl = this.#project?.logoUrl?.trim() ?? ''
    if (
      isProjectLogoVisible(this.#project) &&
      projectLogoUrl &&
      /^(data:image\/svg\+xml|.*\.svg(?:$|[?#]))/i.test(projectLogoUrl)
    ) {
      symbolPaths.add(projectLogoUrl)
    }

    for (const path of symbolPaths) {
      if (getCachedSymbolSvg(path) || isSymbolSvgLoading(path)) continue
      void preloadSymbolSvg(path).then(() => this.#renderPreviewOnly())
    }
  }

  #safeAreaRect() {
    return safeAreaRect(this.#paperMeta(), this.#printMargin, this.#worldWidth, this.#worldHeight)
  }

  async #exportSvg() {
    await this.#ensureSymbolMarkupReady()
    this.#download(`cadle-${this.#paperPreset}.svg`, this.#buildSvgDocument(), 'image/svg+xml;charset=utf-8')
  }

  async #exportPdf() {
    await this.#ensureSymbolMarkupReady()
    const originalPageKey = this.#pageKey
    const originalState = this.#nativeDocumentState()
    const originalSelectedIds = new Set(this.#selectedIds)
    const originalDraft = this.#draft ? (cloneShape(this.#draft) as DraftShape) : null
    const originalDrag = this.#drag ? { ...this.#drag, initial: cloneShapes(this.#drag.initial) } : null
    const originalBandStart = this.#bandStart ? { ...this.#bandStart } : null
    const originalBandEnd = this.#bandEnd ? { ...this.#bandEnd } : null
    const originalWallChain = this.#wallChain ? { ...this.#wallChain } : null
    const originalChainPreviewEnd = this.#chainPreviewEnd ? { ...this.#chainPreviewEnd } : null
    const originalSnapTarget = this.#snapTarget ? { ...this.#snapTarget } : null
    const originalSnapIndicatorKind = this.#snapIndicatorKind
    const originalSymbolPreviewPoint = this.#symbolPreviewPoint ? { ...this.#symbolPreviewPoint } : null
    const originalSymbolPlacement = this.#symbolPlacement ? { ...this.#symbolPlacement } : null
    const originalOneWireAnchor = this.#oneWireAnchor ? { ...this.#oneWireAnchor } : null
    const originalOneWireLastPoint = this.#oneWireLastPoint ? { ...this.#oneWireLastPoint } : null
    const originalOneWireBusBarId = this.#oneWireBusBarId
    const originalPaperPreset = this.#paperPreset
    const originalPrintMargin = this.#printMargin
    const originalWorldWidth = this.#worldWidth
    const originalWorldHeight = this.#worldHeight
    const projectPages = Object.entries(this.#project?.pages ?? {}).sort(([, a], [, b]) => {
      const orderA = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER
      const orderB = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER
      return orderA - orderB || a.creationTime - b.creationTime
    })

    let pdf: jsPDF | null = null
    let pageIndex = 0

    try {
      for (const [pageKey, page] of projectPages) {
        const state = this.#nativeStateForPage(pageKey as UUID)
        if (!state) continue

        this.#applyPersistedState(state)
        this.#selectedId = null
        this.#selectedIds = new Set()
        this.#pageKey = pageKey as UUID

        const exported = await this.exportA4PNG('auto')
        if (!pdf) {
          pdf = new jsPDF({ format: 'a4', unit: 'px', orientation: exported.orientation, compress: true })
        } else {
          pdf.addPage('a4', exported.orientation)
        }

        const pageWidth = pdf.internal.pageSize.getWidth()
        const pageHeight = pdf.internal.pageSize.getHeight()
        pdf.setFillColor(255, 255, 255)
        pdf.rect(0, 0, pageWidth, pageHeight, 'F')
        pdf.addImage(exported.dataUrl, 'PNG', 0, 0, pageWidth, pageHeight, `page-${pageIndex}`, 'FAST')
        pageIndex += 1
      }

      if (!pdf) {
        const exported = await this.exportA4PNG('auto')
        pdf = new jsPDF({ format: 'a4', unit: 'px', orientation: exported.orientation, compress: true })
        const pageWidth = pdf.internal.pageSize.getWidth()
        const pageHeight = pdf.internal.pageSize.getHeight()
        pdf.setFillColor(255, 255, 255)
        pdf.rect(0, 0, pageWidth, pageHeight, 'F')
        pdf.addImage(exported.dataUrl, 'PNG', 0, 0, pageWidth, pageHeight, 'page-0', 'FAST')
      }

      pdf.save(`cadle-${this.#paperPreset}.pdf`)
    } finally {
      this.#applyPersistedState(originalState)
      this.#pageKey = originalPageKey
      this.#selectedId = originalState.selectedId ?? null
      this.#selectedIds = originalSelectedIds
      this.#draft = originalDraft
      this.#drag = originalDrag
      this.#bandStart = originalBandStart
      this.#bandEnd = originalBandEnd
      this.#wallChain = originalWallChain
      this.#chainPreviewEnd = originalChainPreviewEnd
      this.#snapTarget = originalSnapTarget
      this.#snapIndicatorKind = originalSnapIndicatorKind
      this.#symbolPreviewPoint = originalSymbolPreviewPoint
      this.#symbolPlacement = originalSymbolPlacement
      this.#oneWireAnchor = originalOneWireAnchor
      this.#oneWireLastPoint = originalOneWireLastPoint
      this.#oneWireBusBarId = originalOneWireBusBarId
      this.#paperPreset = originalPaperPreset
      this.#printMargin = originalPrintMargin
      this.#worldWidth = originalWorldWidth
      this.#worldHeight = originalWorldHeight
      this.#render()
    }
  }

  async #printSvg() {
    await this.#ensureSymbolMarkupReady()
    const paper = this.#paperMeta()
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1200,height=900')
    if (!printWindow) return

    const svg = this.#buildSvgDocument(undefined, true)
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
    const worldTransform = `translate(${this.#panX} ${this.#panY}) scale(${this.#zoom})`
    const minorGrid = GRID_SIZE * this.#zoom
    const majorGrid = GRID_SIZE * 5 * this.#zoom
    const gridStyle =
      `background-position: ${this.#panX}px ${this.#panY}px; ` +
      `background-size: ${minorGrid}px ${minorGrid}px, ${minorGrid}px ${minorGrid}px, ` +
      `${majorGrid}px ${majorGrid}px, ${majorGrid}px ${majorGrid}px`
    const cursor = this.#isPanning || this.#spaceDown ? 'grab' : 'default'
    const dialogCategoryOptions = this.#catalogDialogCategoryOptionsForFolder()
    const selectedReplaceOption = this.#catalogDialogReplaceOptions.find(
      (entry) => entry.path === this.#catalogDialogTargetPath
    )

    return html`
      <div class="canvas-host">
        <div class="stage-shell">
          <div class="panel">
            <div
              class="grid"
              style=${gridStyle}></div>
            <svg
              class="stage"
              shape-rendering="crispEdges"
              style="cursor: ${cursor}"
              @pointerdown=${this.#onPointerDown}
              @pointermove=${this.#onPointerMove}
              @pointerup=${this.#onPointerUp}
              @pointercancel=${this.#onPointerUp}
              @dblclick=${this.#onStageDoubleClick}
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
                      data-stage-menu-action="save-symbol-defaults"
                      ?disabled=${!(
                        selectedShape &&
                        selectedShape.kind === 'symbol' &&
                        this.#selectedShapeIds().length === 1
                      )}>
                      Save symbol defaults
                    </button>
                    <button
                      class="stage-context-menu-item"
                      data-stage-menu-action="add-selection-to-catalog"
                      ?disabled=${!this.#selectedShapeIds().length}>
                      Add selection to catalog
                    </button>
                    <button
                      class="stage-context-menu-item"
                      data-stage-menu-action="replace-selection-in-catalog"
                      ?disabled=${!this.#selectedShapeIds().length}>
                      Replace catalog symbol
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
            ${this.#catalogDialogOpen
              ? html`
                  <div class="catalog-dialog-backdrop">
                    <div class="catalog-dialog">
                      <h3>
                        ${this.#catalogDialogMode === 'replace' ? 'Replace catalog symbol' : 'Add selection to catalog'}
                      </h3>
                      ${this.#catalogDialogMode === 'replace'
                        ? html`
                            <label>
                              Existing symbol
                              <select
                                .value=${this.#catalogDialogTargetPath}
                                @change=${(event: Event) => {
                                  const target = event.target as HTMLSelectElement
                                  this.#catalogDialogTargetPath = target.value
                                  const selected = this.#catalogDialogReplaceOptions.find(
                                    (entry) => entry.path === this.#catalogDialogTargetPath
                                  )
                                  this.#catalogDialogFolder = selected?.folder ?? ''
                                  this.#catalogDialogCategory = selected?.category ?? 'My Symbols'
                                  this.#renderPreviewOnly()
                                }}>
                                ${this.#catalogDialogReplaceOptions.map(
                                  (entry) => html`
                                    <option value=${entry.path}>
                                      ${entry.name} · ${entry.folder ? `${entry.folder}/` : ''}${entry.category}
                                    </option>
                                  `
                                )}
                              </select>
                            </label>
                            <p class="catalog-dialog-meta">
                              ${selectedReplaceOption
                                ? `Target: ${selectedReplaceOption.folder ? `${selectedReplaceOption.folder}/` : ''}${selectedReplaceOption.category}`
                                : ''}
                            </p>
                          `
                        : html`
                            <label>
                              Symbol name
                              <input
                                type="text"
                                .value=${this.#catalogDialogName}
                                @input=${(event: Event) => {
                                  const target = event.target as HTMLInputElement
                                  this.#catalogDialogName = target.value
                                }} />
                            </label>
                            <label>
                              Folder (optional)
                              <select
                                .value=${this.#catalogDialogFolder}
                                @change=${(event: Event) => {
                                  const target = event.target as HTMLSelectElement
                                  this.#catalogDialogFolder = target.value
                                  const nextCategories = this.#catalogDialogCategoryOptionsForFolder()
                                  if (!nextCategories.some((entry) => entry.name === this.#catalogDialogCategory)) {
                                    this.#catalogDialogCategory = nextCategories[0]?.name ?? 'My Symbols'
                                  }
                                  this.#renderPreviewOnly()
                                }}>
                                <option value="">No folder</option>
                                ${this.#catalogDialogFolderOptions.map(
                                  (folder) => html`<option value=${folder}>${folder}</option>`
                                )}
                              </select>
                            </label>
                            <label>
                              Category
                              <select
                                .value=${this.#catalogDialogCategory}
                                @change=${(event: Event) => {
                                  const target = event.target as HTMLSelectElement
                                  this.#catalogDialogCategory = target.value
                                }}>
                                ${dialogCategoryOptions.map(
                                  (entry) => html`<option value=${entry.name}>${entry.name}</option>`
                                )}
                              </select>
                            </label>
                          `}
                      <div class="catalog-dialog-actions">
                        <button
                          type="button"
                          class="stage-context-menu-item"
                          @click=${this.#closeCatalogDialog}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          class="stage-context-menu-item"
                          @click=${this.#saveCatalogDialog}>
                          ${this.#catalogDialogMode === 'replace' ? 'Replace' : 'Add'}
                        </button>
                      </div>
                    </div>
                  </div>
                `
              : nothing}
          </div>
        </div>
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
    const openingShapes = this.#shapes.filter(
      (shape) => shape.kind === 'door' || shape.kind === 'window' || shape.kind === 'gate'
    )
    const symbolShapes = this.#shapes.filter((shape) => shape.kind === 'symbol')
    const restShapes = this.#shapes.filter(
      (shape) =>
        shape.kind !== 'wall' &&
        shape.kind !== 'door' &&
        shape.kind !== 'window' &&
        shape.kind !== 'gate' &&
        shape.kind !== 'symbol'
    )
    const wallMask = this.#hasWallOpenings() ? 'url(#wall-opening-mask)' : nothing

    const groupedTemplate = (shapes: Shape[]) => {
      const entries: Array<{ type: 'single'; shape: Shape } | { type: 'group'; groupId: string; shapes: Shape[] }> = []
      const groups = new Map<string, Shape[]>()

      for (const shape of shapes) {
        if (!shape.groupId) {
          entries.push({ type: 'single', shape })
          continue
        }

        const existing = groups.get(shape.groupId)
        if (existing) {
          existing.push(shape)
          continue
        }

        const grouped: Shape[] = [shape]
        groups.set(shape.groupId, grouped)
        entries.push({ type: 'group', groupId: shape.groupId, shapes: grouped })
      }

      return entries.map((entry) => {
        if (entry.type === 'single') {
          const shape = entry.shape
          return this.#shapeTemplate(shape, shape.id === this.#selectedId || this.#selectedIds.has(shape.id))
        }

        return svg`
          <g class="shape-group" data-group-id=${entry.groupId}>
            ${repeat(
              entry.shapes,
              (shape) => shape.id,
              (shape) => this.#shapeTemplate(shape, shape.id === this.#selectedId || this.#selectedIds.has(shape.id))
            )}
          </g>
        `
      })
    }

    return svg`
      ${this.#safeAreaTemplate()}
      <g mask=${wallMask}>
        ${groupedTemplate(wallShapes)}
      </g>
      ${groupedTemplate(restShapes)}
      ${groupedTemplate(openingShapes)}
      ${groupedTemplate(symbolShapes)}
      ${this.#bindingLabelsTemplate()}
      ${this.#projectTitleBlockTemplate()}
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
            scale: inferSymbolScale(this.#pendingCatalogSymbol.path),
            rotation: this.#symbolPlacement?.rotation
          }
        : null
    return svg`
      ${this.#draft ? this.#shapeTemplate(this.#draft, false, 'draft') : nothing}
      ${symbolPreviewShape ? this.#shapeTemplate(symbolPreviewShape, false, 'symbol-preview') : nothing}
      ${this.#snapIndicatorTemplate()}
      ${this.#wallChainPreviewTemplate()}
      ${this.#draft ? this.#measurementTemplate(this.#draft.start, this.#draft.end) : nothing}
      ${this.#wallChain ? this.#measurementTemplate(this.#wallChain.startPoint, this.#chainPreviewEnd) : nothing}
      ${this.#rubberBandTemplate()}
    `
  }

  #render() {
    this.#publishNativeSelection(this.#shapeById(this.#selectedId))
    this.#publishNativeControlsState()
    this.#primeSymbolSvgCache()
    this.requestRender()
  }

  #publishNativeControlsState() {
    pubsub.publish('native.controls.state', {
      paperPreset: this.#paperPreset,
      printMargin: this.#printMargin,
      oneWirePreset: this.#oneWirePreset,
      oneWireBindingId: this.#oneWireBindingId,
      oneWireComposeKind: this.#oneWireComposeKind,
      hasOneWireAnchor: Boolean(this.#oneWireAnchor)
    })
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
        this.#oneWireMode = 'preset'
        if (this.#tool !== 'onewire') this.#activateTool('onewire')
        else this.#render()
      }
      return
    }

    const oneWireComposeButton = target?.closest<HTMLElement>('[data-onewire-compose]')
    if (oneWireComposeButton) {
      const next = oneWireComposeButton.dataset.onewireCompose
      if (next === 'breaker' || next === 'switch' || next === 'kamrail' || next === 'load') {
        this.#oneWireMode = 'compose'
        this.#oneWireComposeKind = next
        if (this.#tool !== 'onewire') this.#activateTool('onewire')
        else this.#render()
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
        void this.#exportSvg().catch(() => window.alert('Unable to export SVG'))
        return
      case 'print-svg':
        void this.#printSvg().catch(() => window.alert('Unable to print SVG'))
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
      case 'onewire-realign':
        if (!this.#realignExistingOneWire()) window.alert('No one-wire elements to realign on this page.')
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

  #onNativeControlsCommand = (payload: {
    paper?: PaperPreset
    onewirePreset?: OneWirePreset
    onewireCompose?: 'breaker' | 'switch' | 'kamrail' | 'load'
    action?: string
  }) => {
    const paperPreset = payload.paper
    if (paperPreset && paperPreset in PAPER_PRESETS) {
      this.#paperPreset = paperPreset
      this.#persist()
      this.#render()
      return
    }

    const preset = payload.onewirePreset
    if (preset && preset in ONE_WIRE_PRESETS) {
      this.#oneWirePreset = preset
      this.#oneWireMode = 'preset'
      if (this.#tool !== 'onewire') this.#activateTool('onewire')
      else this.#render()
      return
    }

    const compose = payload.onewireCompose
    if (compose === 'breaker' || compose === 'switch' || compose === 'kamrail' || compose === 'load') {
      this.#oneWireMode = 'compose'
      this.#oneWireComposeKind = compose
      if (this.#tool !== 'onewire') this.#activateTool('onewire')
      else this.#render()
      return
    }

    switch (payload.action) {
      case 'margin-inc':
        this.#printMargin = Math.min(this.#printMargin + 1, 50)
        this.#persist()
        this.#render()
        return
      case 'margin-dec':
        this.#printMargin = Math.max(this.#printMargin - 1, 0)
        this.#persist()
        this.#render()
        return
      case 'onewire-next':
        this.#advanceOneWireBinding()
        if (this.#tool !== 'onewire') this.#activateTool('onewire')
        return
      case 'onewire-reset-panel':
        this.#oneWireAnchor = null
        this.#oneWireLastPoint = null
        this.#oneWireBusBarId = null
        if (this.#tool !== 'onewire') this.#activateTool('onewire')
        else this.#render()
        return
      case 'onewire-realign':
        if (!this.#realignExistingOneWire()) window.alert('No one-wire elements to realign on this page.')
        return
      case 'export-json':
        this.#download('cadle-drawing.json', this.#serialize(), 'application/json;charset=utf-8')
        return
      case 'export-pdf':
        void this.#exportPdf().catch(() => window.alert('Unable to export PDF'))
        return
      case 'print-svg':
        void this.#printSvg().catch(() => window.alert('Unable to print SVG'))
        return
      case 'import-json':
        this.shadowRoot?.querySelector<HTMLInputElement>('.file-input')?.click()
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

    if (this.#tool === 'wall') {
      // Wall chain must win before shape selection so existing walls can be used as click targets.
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
      this.#snapIndicatorKind = 'wall'
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

    const shapeElement = event.target instanceof Element ? event.target.closest<SVGElement>('[data-shape-id]') : null
    let shapeId = shapeElement?.dataset.shapeId ?? null
    shapeId ??= this.#shapeIdAtPoint(rawPoint)

    const labelElement = event.target instanceof Element ? event.target.closest<SVGGElement>('.binding-label') : null
    if (labelElement && event.button === 0 && shapeId) {
      const shape = this.#shapeById(shapeId)
      if (shape) {
        const labelText = labelElement.querySelector<SVGTextElement>('text')
        const labelX = Number(labelText?.getAttribute('x') ?? NaN)
        const labelY = Number(labelText?.getAttribute('y') ?? NaN)
        const bounds = shapeBounds(shape)
        const shapeCenter = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        this.#labelDrag = {
          shapeId,
          pointerStart: rawPoint,
          shapeCenter,
          initialOffset: {
            x: Number.isFinite(labelX) ? labelX - shapeCenter.x : 0,
            y: Number.isFinite(labelY) ? labelY - shapeCenter.y : 0
          }
        }
        this.#selectedId = shapeId
        this.#selectedIds = this.#expandSelectionWithGroup(shapeId)
        this.#drag = null
        this.#bandStart = null
        this.#bandEnd = null
        this.#stagePointerId = event.pointerId
        ;(stage as SVGSVGElement).setPointerCapture(event.pointerId)
        this.#render()
        return
      }
    }

    const isAdditiveSelection = (event.metaKey || event.ctrlKey) && event.button === 0

    if (
      shapeId &&
      isAdditiveSelection &&
      this.#tool !== 'onewire' &&
      !(this.#tool === 'symbol' && this.#pendingCatalogSymbol)
    ) {
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

    if (
      shapeId &&
      event.button === 0 &&
      this.#tool !== 'onewire' &&
      !(this.#tool === 'symbol' && this.#pendingCatalogSymbol)
    ) {
      if (shapeId === PROJECT_LOGO_SHAPE_ID && isProjectLogoVisible(this.#project)) {
        this.#selectedIds = new Set([PROJECT_LOGO_SHAPE_ID])
        this.#selectedId = PROJECT_LOGO_SHAPE_ID
        const logoBounds = this.#project ? getProjectLogoBounds(this.#project) : null
        this.#logoDrag =
          logoBounds !== null
            ? {
                pointerStart: rawPoint,
                initial: {
                  x: logoBounds.x + logoBounds.width / 2,
                  y: logoBounds.y + logoBounds.height / 2
                }
              }
            : null
        this.#drag = null
        this.#bandStart = null
        this.#bandEnd = null
        this.#stagePointerId = event.pointerId
        stage.setPointerCapture(event.pointerId)
        this.#render()
        return
      }

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
      const snapped = this.#snapSymbolPlacementPoint(rawPoint)
      this.#symbolPreviewPoint = snapped.point
      this.#snapTarget = snapped.snapped ? snapped.point : null
      this.#snapIndicatorKind = snapped.kind
      this.#symbolPlacement = {
        anchor: snapped.point,
        rotation: 0
      }
      this.#stagePointerId = event.pointerId
      ;(stage as SVGSVGElement).setPointerCapture(event.pointerId)
      this.#render()
      return
    }

    if (this.#tool === 'onewire') {
      if (event.button !== 0) return

      const clickedShape = shapeId ? this.#shapeById(shapeId) : null
      const clickedKamrail = this.#isKamrailShape(clickedShape)
        ? clickedShape
        : (this.#nearestKamrail(rawPoint)?.rail ?? null)
      if (clickedKamrail) {
        const defaultFamily = this.#normalizeBindingFamily(this.#oneWireBindingId) ?? 'A'
        const familyInput = window.prompt('Breaker label family (example: A, B, C)', defaultFamily)
        const family = this.#normalizeBindingFamily(familyInput)
        if (!family) return

        const ampsInput = window.prompt('Breaker amps (A)', '20')
        if (ampsInput === null) return
        const parsedAmps = Number(ampsInput.replace(',', '.'))
        const amps = Number.isFinite(parsedAmps) && parsedAmps > 0 ? parsedAmps : 20

        const created = this.#addKamrailCircuitBundle(clickedKamrail, rawPoint.x, {
          amps,
          family,
          autoIncludeFamily: true
        })
        if (created) {
          this.#pushHistory()
          this.#render()
        }
        return
      }

      const electricalPoint = this.#snapToElectricalPoints(this.#snapPoint(rawPoint)).point
      if (this.#oneWireComposeKind === 'kamrail' && this.#createKamrailAt(electricalPoint)) {
        this.#pushHistory()
        this.#render()
        return
      }
      // useDirectional=true: placement side derived from cursor direction; Shift forces nearest anchor side
      if (this.#composeOneWireAt(electricalPoint, !event.shiftKey)) {
        this.#pushHistory()
        this.#render()
        return
      }

      if (this.#composeOneWireOnKamrailAt(electricalPoint)) {
        this.#pushHistory()
        this.#render()
        return
      }

      if (this.#oneWireMode === 'compose') return

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

    if (event.button !== 0) return
    const gridSnapped = this.#snapPoint(rawPoint)
    const point =
      this.#tool === 'line'
        ? this.#snapToElectricalPoints(gridSnapped).point
        : this.#tool === 'door' || this.#tool === 'window' || this.#tool === 'gate'
          ? this.#snapToEndpoints(gridSnapped).point
          : gridSnapped
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
    this.#stageContextPastePoint = rawPoint
    pubsub.publish('shell.pointer', rawPoint)

    if (this.#labelDrag && this.#stagePointerId === event.pointerId) {
      const ld = this.#labelDrag
      const dx = rawPoint.x - ld.pointerStart.x
      const dy = rawPoint.y - ld.pointerStart.y
      const shape = this.#shapeById(ld.shapeId)
      if (shape) {
        this.#setShape({ ...shape, bindingLabelOffset: { x: ld.initialOffset.x + dx, y: ld.initialOffset.y + dy } })
      }
      this.#render()
      return
    }

    if (this.#labelDrag) {
      // stale label drag without pointer id match — clear
      this.#labelDrag = null
    }

    const drag = this.#drag
    if (drag && this.#stagePointerId === event.pointerId) {
      const movedShapes = applyDragMove(rawPoint, drag, (point) => this.#snapPoint(point), this.#shapes)
      this.#setShapes(movedShapes)
      this.#render()
      return
    }

    if (this.#logoDrag && this.#stagePointerId === event.pointerId && this.#project) {
      const dx = rawPoint.x - this.#logoDrag.pointerStart.x
      const dy = rawPoint.y - this.#logoDrag.pointerStart.y
      const snapped = this.#snapPoint({
        x: this.#logoDrag.initial.x + dx,
        y: this.#logoDrag.initial.y + dy
      })
      this.#project.logoX = snapped.x
      this.#project.logoY = snapped.y
      cadleShell.project = this.#project
      void this.#persistProjectMetadata()
      this.#render()
      return
    }

    // Symbol placement gesture: anchor stays fixed, dragging sets the rotation (Shift = free angle).
    if (this.#symbolPlacement && this.#stagePointerId === event.pointerId) {
      const dx = rawPoint.x - this.#symbolPlacement.anchor.x
      const dy = rawPoint.y - this.#symbolPlacement.anchor.y
      let rotation = 0
      if (Math.hypot(dx, dy) >= SYMBOL_PLACEMENT_ROTATE_THRESHOLD) {
        const degrees = (Math.atan2(dy, dx) * 180) / Math.PI
        const stepped = event.shiftKey ? degrees : Math.round(degrees / 15) * 15
        rotation = ((stepped % 360) + 360) % 360
      }
      if (rotation !== this.#symbolPlacement.rotation) {
        this.#symbolPlacement.rotation = rotation
        this.#renderPreviewOnly()
      }
      return
    }

    if (this.#tool === 'symbol' && this.#pendingCatalogSymbol) {
      const snapped = this.#snapSymbolPlacementPoint(rawPoint)
      const nextPreview = snapped.point
      const nextSnapTarget = snapped.snapped ? snapped.point : null
      const changed = !samePoint(this.#symbolPreviewPoint, nextPreview) || !samePoint(this.#snapTarget, nextSnapTarget)
      if (!changed) return
      this.#symbolPreviewPoint = nextPreview
      this.#snapTarget = nextSnapTarget
      this.#snapIndicatorKind = snapped.kind
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
      this.#snapIndicatorKind = 'wall'
      this.#renderPreviewOnly()
      return
    }

    // One-wire: show snap preview
    if (this.#tool === 'onewire') {
      if (this.#oneWireMode === 'compose' && this.#oneWireComposeKind === 'kamrail') {
        const snapped = this.#snapPoint(rawPoint)
        this.#snapTarget = snapped
        this.#snapIndicatorKind = 'onewire'
        this.#renderPreviewOnly()
        return
      }

      if (this.#oneWireMode === 'compose') {
        const railAnchor = this.#nearestKamrail(rawPoint)
        if (railAnchor) {
          this.#snapTarget = railAnchor.point
          this.#snapIndicatorKind = 'onewire'
          this.#renderPreviewOnly()
          return
        }
      }

      const electrical = this.#nearestElectricalAnchor(this.#snapPoint(rawPoint))
      if (electrical.snapped) {
        this.#snapTarget = electrical.point
        this.#snapIndicatorKind = 'electrical'
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
      this.#snapIndicatorKind = 'onewire'
      this.#renderPreviewOnly()
      return
    }

    if (this.#draft && this.#stagePointerId === event.pointerId) {
      let nextSnapTarget: Point | null = null
      let nextSnapKind: SnapIndicatorKind = 'wall'
      this.#draft = updateDraftShapeEnd(
        this.#draft,
        rawPoint,
        (point) => {
          const gridSnapped = this.#snapPoint(point)
          if (this.#draft?.kind === 'door' || this.#draft?.kind === 'window' || this.#draft?.kind === 'gate') {
            const snapped = this.#snapToEndpoints(gridSnapped)
            if (snapped.snapped) {
              nextSnapTarget = snapped.point
              nextSnapKind = 'wall'
            }
            return snapped.point
          }
          if (this.#draft?.kind !== 'line') return gridSnapped
          const snapped = this.#snapToElectricalPoints(gridSnapped)
          if (snapped.snapped) {
            nextSnapTarget = snapped.point
            nextSnapKind = 'electrical'
          }
          return snapped.point
        },
        event.shiftKey
      )
      this.#snapTarget = nextSnapTarget
      this.#snapIndicatorKind = nextSnapKind
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

    if (this.#labelDrag) {
      this.#labelDrag = null
      this.#stagePointerId = null
      if (stage?.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId)
      this.#pushHistory()
      this.#render()
      return
    }

    if (this.#logoDrag) {
      this.#logoDrag = null
      this.#stagePointerId = null
      if (stage?.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId)
      this.#pushHistory()
      this.#render()
      return
    }

    // Commit the symbol being placed with the rotation chosen during the drag.
    if (this.#symbolPlacement) {
      const placement = this.#symbolPlacement
      this.#symbolPlacement = null
      this.#stagePointerId = null
      if (stage?.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId)
      if (this.#pendingCatalogSymbol) {
        const shape = createSymbolShape(nextShapeId(), placement.anchor, this.#pendingCatalogSymbol)
        if (placement.rotation) shape.rotation = placement.rotation
        this.#shapes.push(shape)
        this.#selectedId = shape.id
        this.#selectedIds = new Set([shape.id])
        this.#pendingCatalogSymbol = null
        this.#symbolPreviewPoint = null
        this.#snapTarget = null
        this.#pushHistory()
      }
      this.#render()
      return
    }

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
        const draftShape = cloneShape(this.#draft)
        const committedShape =
          draftShape.kind === 'door' || draftShape.kind === 'window' || draftShape.kind === 'gate'
            ? this.#bindOpeningToWall(draftShape)
            : draftShape
        this.#shapes.push(committedShape)
        this.#selectedId = committedShape.id
        this.#selectedIds = new Set([committedShape.id])
        this.#pushHistory()
      }
      this.#draft = null
      this.#stagePointerId = null
      if (stage?.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId)
      this.#render()
      return
    }

    if (phase === 'drag' && this.#drag) {
      for (const id of this.#drag.ids) {
        const shape = this.#shapeById(id)
        if (!shape || !this.#isOpeningShape(shape)) continue
        this.#setShape(this.#bindOpeningToWall(cloneShape(shape) as LineShape))
      }
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

    const action = getNativeHotkeyAction(event)
    if (!action) return

    if (action === 'escape') {
      this.#handleEscapeKey()
      return
    }

    if (this.#applyNativeHotkey(action)) event.preventDefault()
  }
}
