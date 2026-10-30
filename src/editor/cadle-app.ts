import { LiteElement, html, customElement } from '@vandeurenglenn/lite'
import { nothing, svg } from 'lit'
import { unsafeSVG } from 'lit/directives/unsafe-svg.js'
import { repeat } from 'lit/directives/repeat.js'
import type jsPDFType from 'jspdf'
import styles from './cadle-app.css' with { type: 'css' }
import {
  loadNativeState,
  migrateOneWireProjectPages,
  nativeStateForProjectPage,
  saveNativeState,
  type NativeDocumentState
} from '../data/project-document.js'
import {
  DEFAULT_PRINT_MARGIN_MM,
  DEFAULT_WORLD_HEIGHT,
  DEFAULT_WORLD_WIDTH,
  GRID_SIZE,
  ONE_WIRE_BREAKER_WIDTH,
  ONE_WIRE_CIRCUIT_SPACING,
  ONE_WIRE_NODE_SIZE,
  ONE_WIRE_PRESETS,
  ONE_WIRE_SOCKET_SYMBOL_PATH,
  PAPER_PRESETS,
  paperWorldSize,
  nextOneWireBindingId,
  type OneWirePreset
} from './constants.js'
import { getNativeHotkeyAction, isEditableKeyboardEvent, type NativeHotkeyAction } from './keyboard/hotkeys.js'
import {
  cloneShape,
  cloneShapes,
  inferSymbolScale,
  nextShapeId,
  samePoint,
  sanitizeShapes,
  shapeBounds
} from './model/model.js'
import { parseHash } from '../shell/routing.js'
import type {
  DraftShape,
  DragState,
  LineShape,
  NativeCatalogPick,
  PaperPreset,
  Point,
  Shape,
  Snapshot,
  SymbolShape,
  TextShape,
  Tool
} from './model/types.js'
import type { Project, UUID } from '../types.js'
import { electricalMetadataFromCatalog, isDistributionBoardDevice } from './model/electrical.js'
import { setProjectData } from '../api/project.js'
import pubsub from '../pubsub.js'
import { downloadTextFile } from './export/downloads.js'
import { buildSvgDocument, safeAreaRect } from './export/svg-export.js'
import { pagePixelSize, rasterizePageSvgToPng, rasterizeSvgToPng } from './export/rasterize-svg.js'
import {
  buildProjectTitleBlockMarkup,
  getProjectLogoBounds,
  isProjectLogoVisible,
  PROJECT_LOGO_SHAPE_ID
} from './layout/project-title-block.js'
import { buildIntroPageSvg } from './intro-page.js'
import {
  buildCircuitScheduleSvgs,
  circuitScheduleEditorItems,
  type CircuitScheduleEditorItem
} from './circuit-schedule-page.js'
import {
  bindingLabelsTemplate,
  hasWallOpeningMask,
  measurementTemplate,
  rubberBandTemplate,
  safeAreaTemplate,
  selectedOutlineTemplate,
  shapeTemplate,
  roomDraftTemplate,
  roomLabelsTemplate,
  wallChainPreviewTemplate,
  wallMaskTemplate
} from './svg-templates.js'
import { translateShape } from './interaction/shape-transforms.js'
import {
  buildKamrailCircuitBundle,
  ONE_WIRE_CONDUCTOR_STROKE_WIDTH,
  oneWireProtectionSymbolPath
} from './layout/onewire-helpers.js'
import {
  applyOneWireCircuitPresentation,
  circuitKeyForShape,
  effectiveCircuitElectrical,
  effectiveStandaloneCircuitElectrical,
  updateCircuitSpecifications,
  type CircuitPropertyUpdate
} from './layout/onewire-circuit-presentation.js'
import { buildOneWireTopology } from './layout/onewire-topology.js'
import {
  ONE_WIRE_FIRST_ROW_OFFSET_Y,
  oneWireRailYForRows
} from './layout/onewire-layout-plan.js'
import { fitLegacyGroundPlanToPrintArea, fitShapesToContentArea, scaleShapesBetweenPages } from './layout/page-scaling.js'
import { paperTextScale } from './layout/page-layout.js'
import { resizedSymbolStrokeWidth } from './model/symbol-scale.js'
import { oneWireLayoutBounds, oneWireSymbolConnectionAnchors, positionOneWireSymbolForConnection } from './layout/onewire-connections.js'
import { assessOneWireCapacity } from './onewire-capacity.js'
import {
  oneWireSymbolNodeInfo,
  oneWireSymbolRotationFor,
  oneWireSymbolScaleFor,
  oneWireSymbolStrokeWidthFor,
  oneWireSymbolTerminalInfo
} from './layout/onewire-symbol-nodes.js'
import { nextPanFromPointer } from './interaction/pointer-pan.js'
import { canCommitDraft, resolvePointerUpPhase } from './interaction/pointer-up.js'
import {
  resolveSelectPointerDownState,
  resolveOneWirePointerDown,
  resolveWallPointerDown
} from './interaction/pointer-down.js'
import {
  applyDragMove,
  snapSymbolToWallOffset,
  snapWallSymbolNextToSymbol,
  updateDraftShapeEnd,
  updateWallChainPreview
} from './interaction/pointer-move.js'
import {
  allowsExistingShapeSelection,
  dragIdsForSelectedShape,
  expandSelectionWithGroup,
  shouldSelectExistingOneWireShape
} from './interaction/pointer-select.js'
import { snapPasteTranslation } from './interaction/clipboard-placement.js'
import { resolveNativeEscapeAction } from './interaction/keyboard.js'
import { convertWallsToRoom, createRoomWalls } from './interaction/room-rectangle.js'
import { bindOpeningToNearestWall } from './interaction/opening-wall.js'
import {
  createDraftShape,
  createSymbolShape,
  createTextShape,
  resolveCatalogSymbolScale
} from './interaction/pointer-down-builders.js'
import { createNativeSelectionChangedPayload } from './interaction/selection-payload.js'
import { transformShapeForSelection, type SelectionTransformAction } from './interaction/selection-transforms.js'
import { getCachedSymbolSvg, isSymbolSvgLoading, preloadSymbolSvg } from './symbol-svg-cache.js'
import { isEscape } from './keyboard/commands/escape.js'
import { isPanKeyDown, isPanKeyUp } from './keyboard/commands/pan.js'
import {
  ensureCustomCatalogLoaded,
  getStoredCustomCategories,
  getStoredCustomFolders,
  getStoredCustomSymbols,
  setStoredCustomSymbols
} from '../catalog/custom-symbols.js'
import { getCatalogSymbolStyleDefaults, setStoredCatalogSymbolStyleDefaults } from '../catalog/symbol-overrides.js'
import {
  circuitBomRows,
  type CircuitAnalysis,
  type CircuitComponent,
  type CircuitGroup,
  type BomRow
} from './circuit-analysis.js'
import { defaultHasProtectiveConductor } from './circuit-defaults.js'
import { ViewportController } from './controllers/viewport-controller.js'
import { ToolController } from './controllers/tool-controller.js'
import { CanvasDocumentController } from './controllers/canvas-document-controller.js'
import { OneWireController } from './controllers/onewire-controller.js'
import { CatalogController } from './controllers/catalog-controller.js'
import { PersistenceQueue } from './controllers/persistence-queue.js'
import { symbolContentBounds } from './layout/symbol-layout.js'
import { migrateOneWireCircuitGeometry } from './layout/onewire-circuit-migration.js'
import { updateSelectionProperties, type SelectionPropertyUpdate } from './interaction/selection-properties.js'
import { planAutomaticBindings } from './auto-bindings.js'
import { applyCircuitOperation, type CircuitOperationKind } from './circuit-operations.js'
import {
  DEFAULT_SYMBOL_STROKE_WIDTH,
  readSymbolStrokeWidth,
  writeSymbolStrokeWidth
} from '../preferences/symbol-stroke-width.js'

type SnapIndicatorKind = 'wall' | 'electrical' | 'onewire'
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
const KAMRAIL_STROKE_WIDTH = 4
const KAMRAIL_ATTACH_OFFSET = 20
const ONEWIRE_BRANCH_STROKE = '#000000'

@customElement('cadle-app')
export class CadleApp extends LiteElement {
  static styles = [styles]

  get projectKeyOverride(): string {
    return this.getAttribute('project-key') ?? ''
  }

  get pageKeyOverride(): string {
    return this.getAttribute('page-key') ?? ''
  }

  get readOnly(): boolean {
    return this.hasAttribute('read-only')
  }

  #tools = new ToolController()
  #document = new CanvasDocumentController()
  #oneWireController = new OneWireController()
  #catalogController = new CatalogController()
  #draft: DraftShape | null = null
  #drag: DragState | null = null
  #logoDrag: { pointerStart: Point; initial: Point } | null = null
  #labelDrag: {
    shapeId: string
    pointerStart: Point
    shapeCenter: Point
    initialOffset: { x: number; y: number }
  } | null = null
  #snap = true
  #stagePointerId: number | null = null
  #paperPreset: PaperPreset = 'a4-landscape'
  #printMargin = DEFAULT_PRINT_MARGIN_MM
  #worldWidth = DEFAULT_WORLD_WIDTH
  #worldHeight = DEFAULT_WORLD_HEIGHT
  #resizeObserver: ResizeObserver | null = null
  #panelSize: { width: number; height: number } | null = null
  #projectKey: UUID | null = null
  #pageKey: UUID | null = null
  #project: Project | null = null
  #persistence = new PersistenceQueue()
  #circuitUpdatePromise: Promise<void> = Promise.resolve()
  #initializePromise: Promise<void> = Promise.resolve()
  #connected = false
  #documentSizeMigrated = false
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
  #viewport = new ViewportController()
  #isPanning = false
  #panStart: { px: number; py: number; panX: number; panY: number } | null = null
  #spaceDown = false
  // Rubber-band select
  #bandStart: Point | null = null
  #bandEnd: Point | null = null
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
  #symbolStrokeWidth = DEFAULT_SYMBOL_STROKE_WIDTH
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
  #catalogDialogDraftShapes: Shape[] = []
  #catalogDialogName = ''
  #catalogDialogFolder = ''
  #catalogDialogCategory = 'My Symbols'
  #catalogDialogTargetPath = ''
  #catalogDialogFolderOptions: string[] = []
  #catalogDialogCategoryOptions: CatalogDialogCategoryOption[] = []
  #catalogDialogReplaceOptions: CatalogDialogReplaceOption[] = []

  connectedCallback() {
    super.connectedCallback()
    this.#connected = true
    this.#symbolStrokeWidth = readSymbolStrokeWidth()
    this.#bindResizeObserver()
    this.shadowRoot?.addEventListener('wheel', this.#onWheel, { passive: false })
    if (!this.readOnly) {
      window.addEventListener('hashchange', this.#onHashChange)
      window.addEventListener('keydown', this.#onKeyDown)
      window.addEventListener('keyup', this.#onKeyUp)
      pubsub.subscribe('shell.action', this.#onShellAction)
      pubsub.subscribe('shell.snap', this.#onShellSnap)
      pubsub.subscribe('native.catalog.pick', this.#onNativeCatalogPick)
      pubsub.subscribe('editor.object.update', this.#onNativeObjectUpdate)
      pubsub.subscribe('editor.circuit.operation', this.#onCircuitOperation)
      pubsub.subscribe('editor.object.delete', this.#onNativeObjectDelete)
      pubsub.subscribe('editor.object.convert-room', this.#onConvertSelectionToRoom)
      pubsub.subscribe('editor.object.flip-side', this.#onNativeObjectFlipSide)
      pubsub.subscribe('editor.controls.command', this.#onNativeControlsCommand)
      pubsub.subscribe('native.symbol-stroke-width.update', this.#onSymbolStrokeWidthUpdate)
    }
    this.#startInitialize()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.#connected = false
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    pubsub.unsubscribe('native.symbol-stroke-width.update', this.#onSymbolStrokeWidthUpdate)
    this.shadowRoot?.removeEventListener('wheel', this.#onWheel)
    window.removeEventListener('hashchange', this.#onHashChange)
    window.removeEventListener('keydown', this.#onKeyDown)
    window.removeEventListener('keyup', this.#onKeyUp)
    pubsub.unsubscribe('shell.action', this.#onShellAction)
    pubsub.unsubscribe('shell.snap', this.#onShellSnap)
    pubsub.unsubscribe('native.catalog.pick', this.#onNativeCatalogPick)
    pubsub.unsubscribe('editor.object.update', this.#onNativeObjectUpdate)
    pubsub.unsubscribe('editor.circuit.operation', this.#onCircuitOperation)
    pubsub.unsubscribe('editor.object.delete', this.#onNativeObjectDelete)
    pubsub.unsubscribe('editor.object.convert-room', this.#onConvertSelectionToRoom)
    pubsub.unsubscribe('editor.object.flip-side', this.#onNativeObjectFlipSide)
    pubsub.unsubscribe('editor.controls.command', this.#onNativeControlsCommand)
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
    await this.#ensureSymbolMarkupReady()
    const paper = this.#paperMeta()
    const resolvedOrientation =
      orientation === 'auto' ? (paper.widthMm >= paper.heightMm ? 'landscape' : 'portrait') : orientation
    const { widthPx, heightPx } = pagePixelSize(resolvedOrientation)
    const exportViewBox = this.#exportViewBox(resolvedOrientation)
    const dataUrl = await rasterizeSvgToPng(
      this.#buildSvgDocument(exportViewBox ?? undefined, monochrome),
      widthPx,
      heightPx,
      'Unable to render SVG export'
    )
    return { dataUrl, orientation: resolvedOrientation, widthPx, heightPx }
  }

  #onShellAction = (action: string) => {
    const nextTool = this.#tools.toolForShellAction(action ?? '')
    this.#activateTool(nextTool)
  }

  #onShellSnap = (enabled: boolean) => {
    const next = Boolean(enabled)
    if (next === this.#snap) return
    this.#snap = next
    this.#render()
  }

  #setSymbolStrokeWidth = (value: number) => {
    const normalized = writeSymbolStrokeWidth(value)
    if (normalized === this.#symbolStrokeWidth) return
    this.#symbolStrokeWidth = normalized
    this.#render()
  }

  #onSymbolStrokeWidthUpdate = (value: unknown) => {
    if (typeof value === 'number') {
      this.#setSymbolStrokeWidth(value)
    }
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
    this.#tools.select('symbol')
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

  #catalogDialogCategoryOptionsForFolder(): CatalogDialogCategoryOption[] {
    const folder = this.#catalogDialogFolder.trim() || undefined
    const options = this.#catalogDialogCategoryOptions.filter((entry) => (entry.folder ?? '') === (folder ?? ''))
    if (options.some((entry) => entry.name === 'My Symbols')) return options
    return [...options, { folder, name: 'My Symbols' }]
  }

  #openCatalogDialog = async (mode: CatalogDialogMode): Promise<boolean> => {
    // Catalog SVGs must inline source symbol markup. Falling back to an <image>
    // keeps the geometry but cannot carry per-instance fill/stroke overrides.
    await this.#ensureSymbolMarkupReady()
    const draft = this.#catalogController.selectionDraft(this.#document.shapes, this.#selectedShapeIds())
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
    this.#catalogDialogDraftShapes = draft.shapes
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
        shapes: this.#catalogDialogDraftShapes,
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
      shapes: this.#catalogDialogDraftShapes,
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

  #onNativeObjectUpdate = (payload: SelectionPropertyUpdate) => {
    const hasLogoSelection =
      this.#document.selectedIds.has(PROJECT_LOGO_SHAPE_ID) ||
      (this.#document.selectedIds.size === 0 && this.#document.selectedId === PROJECT_LOGO_SHAPE_ID)
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

    const selectedShape = this.#shapeById(this.#document.selectedId)
    const circuitGroup = selectedShape ? this.#circuitGroupForShape(selectedShape) : null
    const currentPageType = this.#pageKey ? this.#project?.pages?.[this.#pageKey]?.pageType : undefined
    const isProtectionSymbol =
      selectedShape?.kind === 'symbol' &&
      /automaat|breaker|protection devices/i.test(`${selectedShape.name} ${selectedShape.path}`)
    const isTopologyProtection = Boolean(
      isProtectionSymbol && /^board:main:topology:v\d+:/.test(selectedShape?.generationKey ?? '')
    )
    const standaloneCircuitKey = selectedShape ? circuitKeyForShape(selectedShape) : null
    if (payload.electrical && isTopologyProtection) {
      const nextShapes = updateSelectionProperties(this.#document.shapes, payload, {
        selectedIds: this.#document.selectedIds,
        selectedId: this.#document.selectedId,
        groupedSelection: false
      })
      if (!nextShapes) return
      this.#document.shapes = nextShapes
      const updatedProtection = nextShapes.find((shape) => shape.id === selectedShape?.id)
      const topology = this.#project?.oneWireTopology
      if (updatedProtection?.kind === 'symbol' && topology && this.#project) {
        const role = updatedProtection.sourceLink?.role ?? ''
        const ratedCurrentA = updatedProtection.electrical?.breakerCurrentA
        const sensitivityMa = updatedProtection.electrical?.rcdSensitivityMa
        const manufacturer = updatedProtection.electrical?.manufacturer
        const neutralPosition = updatedProtection.electrical?.neutralPosition
        if (role === 'main-switch') {
          const switchRating =
            ratedCurrentA ??
            topology.mainSwitch?.ratedCurrentA ??
            topology.gridProtectionCurrentA ??
            topology.mainDifferential?.ratedCurrentA ??
            40
          topology.mainSwitch = {
            ratedCurrentA: switchRating,
            ...(manufacturer ? { manufacturer } : {}),
            ...(neutralPosition ? { neutralPosition } : {})
          }
        } else if (role === 'main-differential' && topology.mainDifferential) {
          if (typeof ratedCurrentA === 'number') topology.mainDifferential.ratedCurrentA = ratedCurrentA
          if (typeof sensitivityMa === 'number') topology.mainDifferential.sensitivityMa = sensitivityMa
          if (manufacturer) topology.mainDifferential.manufacturer = manufacturer
          else delete topology.mainDifferential.manufacturer
          if (neutralPosition) topology.mainDifferential.neutralPosition = neutralPosition
          else delete topology.mainDifferential.neutralPosition
        } else if (role === 'residual-breaker' && typeof ratedCurrentA === 'number') {
          topology.residualBreakerRatedCurrentA = ratedCurrentA
          if (manufacturer) topology.residualBreakerManufacturer = manufacturer
          else delete topology.residualBreakerManufacturer
          if (neutralPosition) topology.residualBreakerNeutralPosition = neutralPosition
          else delete topology.residualBreakerNeutralPosition
        } else if (role === 'solar-breaker' && typeof ratedCurrentA === 'number') {
          topology.solarBreakerRatedCurrentA = ratedCurrentA
          if (manufacturer) topology.solarBreakerManufacturer = manufacturer
          else delete topology.solarBreakerManufacturer
          if (neutralPosition) topology.solarBreakerNeutralPosition = neutralPosition
          else delete topology.solarBreakerNeutralPosition
        } else {
          const additionalMatch = /^additional-differential-(?:consumers|ev|other)-(\d+)$/.exec(role)
          if (additionalMatch && topology.additionalDifferentials) {
            const expanded = topology.additionalDifferentials.flatMap((item) =>
              Array.from({ length: item.count }, () => ({ ...item, count: 1 }))
            )
            const evDifferentials = expanded.filter((item) => item.purpose === 'ev')
            const otherDifferentials = expanded.filter((item) => item.purpose !== 'ev')
            const middle = Math.ceil(otherDifferentials.length / 2)
            const displayedOrder = [
              ...otherDifferentials.slice(0, middle),
              ...evDifferentials,
              ...otherDifferentials.slice(middle)
            ]
            const target = displayedOrder[Number(additionalMatch[1]) - 1]
            if (target) {
              if (typeof ratedCurrentA === 'number') target.ratedCurrentA = ratedCurrentA
              else delete target.ratedCurrentA
              if (typeof sensitivityMa === 'number') target.sensitivityMa = sensitivityMa
              if (manufacturer) target.manufacturer = manufacturer
              else delete target.manufacturer
              if (neutralPosition) target.neutralPosition = neutralPosition
              else delete target.neutralPosition
              topology.additionalDifferentials = expanded
            }
          }
        }
        const capacity = assessOneWireCapacity(topology, {
          gridProtectionCurrentA: this.#project.mainFuseA
        })
        const capacityColor = topology.residualBreaker
          ? capacity.status === 'overload'
            ? '#b3261e'
            : '#000000'
          : capacity.status === 'ok'
            ? '#8a5200'
            : '#b3261e'
        this.#document.shapes = this.#document.shapes.map((shape) => {
          if (shape.kind !== 'text') return shape
          const statusRole = shape.sourceLink?.role
          if (
            statusRole === 'secondary-busbar-protection-label' ||
            statusRole === 'secondary-busbar-protection-warning'
          ) {
            return { ...shape, text: capacity.message, fill: capacityColor }
          }
          if (statusRole === 'secondary-busbar-capacity-detail') {
            return { ...shape, text: capacity.detail, fill: capacityColor }
          }
          return shape
        })
        cadleShell.project = this.#project
        void this.#persistProjectMetadata()
      }
      this.#pushHistory()
      this.#render()
      return
    }
    if (
      payload.electrical &&
      (circuitGroup || (currentPageType === 'onewire' && isProtectionSymbol && standaloneCircuitKey))
    ) {
      const { role, oneWireEligible, ratedCurrentA, ...circuitProperties } = payload.electrical
      if (Object.keys(circuitProperties).length > 0) {
        const circuitTarget =
          selectedShape?.sourceLink?.kind === 'board'
            ? selectedShape.sourceLink.id
            : (circuitGroup?.bindingId ?? standaloneCircuitKey)
        if (!circuitTarget) return
        this.#circuitUpdatePromise = this.#updateCircuitProperties(circuitTarget, circuitProperties).catch((error) => {
          console.error('Failed to update circuit properties', error)
        })
        return
      }
      void role
      void oneWireEligible
      void ratedCurrentA
    }

    const nextShapes = updateSelectionProperties(this.#document.shapes, payload, {
      selectedIds: this.#document.selectedIds,
      selectedId: this.#document.selectedId,
      groupedSelection: this.#selectedGroupId() !== null
    })
    if (!nextShapes) return
    this.#document.shapes = nextShapes
    this.#pushHistory()
    this.#render()
  }

  #onCircuitOperation = (request: { kind: CircuitOperationKind; targetFamily: string }) => {
    const currentPageType = this.#pageKey ? this.#project?.pages?.[this.#pageKey]?.pageType : undefined
    if (currentPageType === 'onewire' || currentPageType === 'circuit-schedule') {
      globalThis.alert('Circuit operations are available on floor plans.')
      return
    }
    const result = applyCircuitOperation(
      this.#document.shapes,
      new Set(this.#selectedShapeIds()),
      request.kind,
      request.targetFamily
    )
    if (result.error) {
      globalThis.alert(result.error)
      return
    }

    this.#document.shapes = result.shapes
    if (this.#project) {
      const specifications = { ...(this.#project.circuitSpecifications ?? {}) }
      for (const [previousBinding, nextBinding] of result.bindingChanges) {
        if (previousBinding === nextBinding || !specifications[previousBinding]) continue
        if (!specifications[nextBinding]) specifications[nextBinding] = { ...specifications[previousBinding] }
        delete specifications[previousBinding]
      }
      const inherited =
        specifications[result.targetFamily] ??
        result.sourceFamilies.map((family) => specifications[family]).find(Boolean)
      if (inherited && !specifications[result.targetFamily]) {
        specifications[result.targetFamily] = { ...inherited }
      }
      if (request.kind !== 'split') {
        for (const family of result.sourceFamilies) {
          if (family !== result.targetFamily) delete specifications[family]
        }
      }
      this.#project.circuitSpecifications = specifications
      cadleShell.project = this.#project
      void this.#persistProjectMetadata()
    }
    this.#pushHistory()
    this.#render()
    const action = request.kind === 'replace' ? 'Replaced' : request.kind === 'combine' ? 'Combined' : 'Split'
    globalThis.alert(
      `${action} ${result.changedShapeCount} objects into circuit ${result.targetFamily}. Regenerate the one-wire diagram to apply the change.`
    )
  }

  #onNativeObjectDelete = () => {
    if (this.#document.selectedId === PROJECT_LOGO_SHAPE_ID && this.#project) {
      this.#project.logoUrl = undefined
      this.#project.logoColor = undefined
      this.#project.logoScale = 1
      this.#project.logoX = undefined
      this.#project.logoY = undefined
      this.#document.selectedId = null
      this.#document.selectedIds = new Set()
      cadleShell.project = this.#project
      void this.#persistProjectMetadata()
      this.#render()
      return
    }
    this.#deleteNativeSelection()
  }

  #onConvertSelectionToRoom = () => {
    const ids = this.#selectedShapeIds()
    const walls = ids
      .map((id) => this.#shapeById(id))
      .filter((shape): shape is LineShape => Boolean(shape && shape.kind === 'wall'))
    if (walls.length !== ids.length) return
    const converted = convertWallsToRoom(walls, nextShapeId)
    if (!converted) return
    const updates = new Map(converted.map((wall) => [wall.id, wall]))
    this.#document.shapes = this.#document.shapes.map((shape) => updates.get(shape.id) ?? shape)
    this.#pushHistory()
    this.#render()
  }

  #onNativeObjectFlipSide = () => {
    const shape = this.#shapeById(this.#document.selectedId)
    if (!shape || (shape.kind !== 'door' && shape.kind !== 'gate')) return
    const updated: LineShape = { ...shape, flipSide: !shape.flipSide }
    this.#setShape(updated)
    this.#pushHistory()
    this.#render()
  }

  async #initialize() {
    this.#document.history.reset()
    this.#draft = null
    this.#drag = null
    this.#document.selectedId = null
    this.#document.selectedIds = new Set()

    await this.#restore()
    if (this.#documentSizeMigrated) {
      this.#documentSizeMigrated = false
      await this.#persist()
    }
    this.#pushHistory(false)
    this.#render()
    await this.#syncWorldSizeSettled()
    this.#autoCenterView()
    this.#render()
  }

  async #syncWorldSizeSettled(maxFrames = 8): Promise<void> {
    const initialPanel = this.shadowRoot?.querySelector<HTMLElement>('.panel')
    if (initialPanel) {
      const initialRect = initialPanel.getBoundingClientRect()
      if (Math.round(initialRect.width) > 32 && Math.round(initialRect.height) > 32) {
        this.#syncWorldSize()
        return
      }
    }

    let previousWidth = -1
    let previousHeight = -1
    let stableFrames = 0

    for (let index = 0; index < maxFrames; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const panel = this.shadowRoot?.querySelector<HTMLElement>('.panel')
      if (!panel) continue
      const rect = panel.getBoundingClientRect()
      const width = Math.max(1, Math.round(rect.width))
      const height = Math.max(1, Math.round(rect.height))

      if (width === previousWidth && height === previousHeight) stableFrames += 1
      else stableFrames = 0

      previousWidth = width
      previousHeight = height

      if (stableFrames >= 1) break
    }

    this.#syncWorldSize()
  }

  #startInitialize() {
    this.#initializePromise = this.#initialize()
  }

  async waitForPageReady(pageKey: string): Promise<boolean> {
    await this.#initializePromise
    return this.#pageKey === pageKey
  }

  async loadReadOnlyPage(projectKey: string, pageKey: string): Promise<void> {
    if (!this.readOnly) return
    this.setAttribute('project-key', projectKey)
    this.setAttribute('page-key', pageKey)
    this.#startInitialize()
    await this.#initializePromise
  }

  async flushPendingSave(): Promise<void> {
    await this.#persistence.flush()
  }

  async flushPendingCircuitUpdates(): Promise<void> {
    await this.#circuitUpdatePromise
  }

  #persist() {
    if (this.readOnly) return
    const payload = this.#nativeDocumentState()

    if (!this.#projectKey || !this.#pageKey) return
    const projectKey = this.#projectKey
    const pageKey = this.#pageKey
    const page = this.#project?.pages[pageKey]
    if (page) {
      page.schema = {
        version: 'native-svg-1',
        objects: [{ kind: 'cadle-native-svg-document', payload }]
      }
    }

    void this.#persistence.enqueue(() => saveNativeState(projectKey, pageKey, payload))
  }

  async #persistProjectMetadata() {
    if (!this.#projectKey || !this.#project) return
    const projectKey = this.#projectKey
    const project = structuredClone(this.#project)
    await this.#persistence.enqueue(() => setProjectData(projectKey, project))
  }

  async #restore() {
    const loaded = await loadNativeState({
      ...(this.projectKeyOverride ? { projectKey: this.projectKeyOverride as UUID } : {}),
      ...(this.pageKeyOverride ? { pageKey: this.pageKeyOverride as UUID } : {})
    })
    if (!loaded) {
      this.#projectKey = '' as UUID
      this.#pageKey = '' as UUID
      this.#project = {} as Project
      const shell = globalThis as unknown as { cadleShell?: { project?: Project | null; projectName?: string } }
      if (shell.cadleShell) {
        shell.cadleShell.project = null as unknown as Project
        shell.cadleShell.projectName = ''
      }
      this.#resetPageState()
      return
    }

    this.#projectKey = loaded.projectKey
    this.#pageKey = loaded.pageKey
    const shell = globalThis as unknown as { cadleShell?: { project?: Project | null } }
    this.#project = loaded.project
    if (shell.cadleShell && !this.readOnly) shell.cadleShell.project = loaded.project

    if (!this.readOnly) await this.#migrateOneWirePagesOnProjectLoad()

    const restoredState = nativeStateForProjectPage(this.#project, this.#pageKey)
    if (restoredState) {
      this.#applyPersistedState(restoredState)
      return
    }

    this.#resetPageState()
  }

  async #migrateOneWirePagesOnProjectLoad(): Promise<void> {
    if (!this.#projectKey || !this.#project) return
    const requestedPageKey = this.#pageKey
    let changed = false

    try {
      changed = migrateOneWireProjectPages(this.#project, this.#oneWireController.layoutVersion, (state, pageKey) => {
        this.#pageKey = pageKey
        this.#documentSizeMigrated = false
        return this.#applyPersistedState(state) ? this.#nativeDocumentState() : null
      })
    } finally {
      this.#pageKey = requestedPageKey
      this.#documentSizeMigrated = false
    }

    if (changed) {
      const project = structuredClone(this.#project)
      await this.#persistence.enqueue(() => setProjectData(this.#projectKey!, project))
    }
  }

  #onHashChange = () => {
    if (!this.#connected) return
    const { route } = parseHash(window.location.hash)
    if (route !== 'editor/model') return
    this.#startInitialize()
  }

  #applyPersistedState(parsed: Partial<NativeDocumentState>): boolean {
    let migrationComplete = true
    let dimensionsChanged = false
    this.#resetPageState()
    if (Array.isArray(parsed.shapes)) this.#document.shapes = sanitizeShapes(parsed.shapes)
    this.#rebindAllOpeningsToWalls()
    if (parsed.paperPreset && parsed.paperPreset in PAPER_PRESETS) {
      this.#paperPreset = parsed.paperPreset
    }
    if (typeof parsed.printMargin === 'number' && Number.isFinite(parsed.printMargin) && parsed.printMargin >= 0) {
      this.#printMargin = Math.max(DEFAULT_PRINT_MARGIN_MM, Math.min(50, parsed.printMargin))
    }
    const target = paperWorldSize(this.#paperPreset)
    const previousWidth =
      typeof parsed.worldWidth === 'number' && parsed.worldWidth > 0 ? parsed.worldWidth : target.width
    const previousHeight =
      typeof parsed.worldHeight === 'number' && parsed.worldHeight > 0 ? parsed.worldHeight : target.height
    if (Math.abs(previousWidth - target.width) > 1 || Math.abs(previousHeight - target.height) > 1) {
      const scale = Math.min(target.width / previousWidth, target.height / previousHeight)
      const offsetX = (target.width - previousWidth * scale) / 2
      const offsetY = (target.height - previousHeight * scale) / 2
      this.#document.shapes = scaleShapesBetweenPages(this.#document.shapes, scale, offsetX, offsetY)
      dimensionsChanged = true
      this.#documentSizeMigrated = true
    }
    this.#worldWidth = target.width
    this.#worldHeight = target.height
    const pageType = this.#pageKey ? this.#project?.pages?.[this.#pageKey]?.pageType : undefined
    const oneWireLayoutVersion = parsed.oneWireLayoutVersion ?? 0
    if (pageType === 'onewire' && (oneWireLayoutVersion < this.#oneWireController.layoutVersion || dimensionsChanged)) {
      this.#document.shapes = migrateOneWireCircuitGeometry(this.#document.shapes, {
        nextShapeId,
        oneWireComponentSymbol: (kind) => this.#oneWireComponentSymbol(kind),
        oneWireSymbolScale: (path, kind) => this.#oneWireSymbolScale(path, kind),
        symbolContentBounds,
        branchStroke: '#000000',
        minimumRowY: this.#safeAreaRect().y
      })
      const families = new Set(
        this.#document.shapes.flatMap((shape) => (shape.sourceLink?.role === 'breaker' ? [shape.sourceLink.id] : []))
      )
      const analysis = this.analyzeBindings()
      for (const family of families) {
        const stored = this.#project?.circuitSpecifications?.[family]
        const groupSpecification = analysis.groups.find((group) => group.family === family)?.specification
        if (!stored && !groupSpecification) continue
        this.#document.shapes = applyOneWireCircuitPresentation({
          shapes: this.#document.shapes,
          circuitKey: family,
          stored,
          groupSpecification,
          profile: this.#project?.electricalProfile
        }).shapes
      }
      const hasOneWireShapes = this.#document.shapes.some((shape) => shape.groupId?.startsWith('onewire-'))
      const hasCircuitLayout =
        this.#document.shapes.some((shape) => shape.kind === 'line' && this.#isKamrailShape(shape)) &&
        this.#document.shapes.some(
          (shape) => shape.kind === 'symbol' && shape.sourceLink?.role === 'breaker' && Boolean(shape.generationKey)
        )
      let migrated = this.#rebuildExistingOneWireTopology()
      if (!migrated && hasCircuitLayout) {
        this.#compactExistingOneWireRail()
        migrated = true
      }
      migrationComplete = migrated || !hasOneWireShapes
      if (migrationComplete) this.#documentSizeMigrated = true
    }
    if (parsed.version !== 2 && pageType !== 'onewire' && pageType !== 'circuit-schedule') {
      const paper = PAPER_PRESETS[this.#paperPreset]
      const fitted = fitLegacyGroundPlanToPrintArea(this.#document.shapes, {
        width: this.#worldWidth,
        height: this.#worldHeight,
        widthMm: paper.widthMm,
        heightMm: paper.heightMm,
        marginMm: this.#printMargin
      })
      if (fitted.changed) {
        this.#document.shapes = fitted.shapes
        this.#documentSizeMigrated = true
      }
    }
    if (parsed.paperLayoutVersion !== 1) {
      const fitted = fitShapesToContentArea(this.#document.shapes, this.#safeAreaRect())
      this.#document.shapes = fitted.shapes
      this.#documentSizeMigrated = true
    }
    return migrationComplete
  }

  #resetPageState() {
    this.#document.shapes = []
    this.#document.selectedId = null
    this.#document.selectedIds = new Set()
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
    this.#document.history.push(
      {
        shapes: this.#document.shapes,
        selectedId: this.#document.selectedId,
        worldWidth: this.#worldWidth,
        worldHeight: this.#worldHeight
      },
      replaceCurrent
    )
    if (persist) this.#persist()
  }

  #restoreSnapshot(snapshot: Snapshot) {
    this.#document.shapes = cloneShapes(snapshot.shapes)
    this.#rebindAllOpeningsToWalls()
    this.#document.selectedId = snapshot.selectedId
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
    requestAnimationFrame(() => {
      const panel = this.shadowRoot?.querySelector<HTMLElement>('.panel')
      if (!panel || !this.#resizeObserver) return
      this.#resizeObserver.observe(panel)
      this.#syncWorldSize()
    })
  }

  #syncWorldSize() {
    const panel = this.shadowRoot?.querySelector<HTMLElement>('.panel')
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    const nextSize = { width: rect.width, height: rect.height }
    if (this.#panelSize) this.#viewport.preserveCenter(this.#panelSize, nextSize)
    this.#panelSize = nextSize
    this.#render()
  }

  #undo() {
    const snapshot = this.#document.history.undo()
    if (snapshot) this.#restoreSnapshot(snapshot)
  }

  #redo() {
    const snapshot = this.#document.history.redo()
    if (snapshot) this.#restoreSnapshot(snapshot)
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
    const worldPt = this.#viewport.screenToWorld({ x: screenX, y: screenY })
    return {
      x: Math.max(0, Math.min(this.#worldWidth, worldPt.x)),
      y: Math.max(0, Math.min(this.#worldHeight, worldPt.y))
    }
  }

  // ── Zoom & pan helpers ────────────────────────────────────────────────────

  // Zoom centred on a screen-space point (px, py are relative to the panel element).
  #zoomAt(px: number, py: number, factor: number) {
    if (this.#viewport.zoomAt({ x: px, y: py }, factor)) this.#render()
  }

  #zoomFromCenter = (factor: number) => {
    const panel = this.shadowRoot?.querySelector<HTMLElement>('.panel')
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    this.#zoomAt(rect.width / 2, rect.height / 2, factor)
  }

  #zoomIn = () => this.#zoomFromCenter(1.2)

  #zoomOut = () => this.#zoomFromCenter(1 / 1.2)

  #fitViewport = () => {
    this.#fitPageView()
    this.#render()
  }

  #focusSelection() {
    const center = this.#selectionCenter()
    const panel = this.shadowRoot?.querySelector<HTMLElement>('.panel')
    if (!center || !panel) return
    const rect = panel.getBoundingClientRect()
    const { zoom } = this.#viewport.state
    this.#viewport.setPan(rect.width / 2 - center.x * zoom, rect.height / 2 - center.y * zoom)
    this.#render()
  }

  focusBinding(bindingId: string): boolean {
    const normalizedBindingId = bindingId.trim().toUpperCase()
    if (!normalizedBindingId) return false
    const match = this.#document.shapes.find((shape) => {
      const shapeBindingId = shape.bindingId?.trim().toUpperCase()
      const sourceBindingId = shape.sourceLink?.id?.trim().toUpperCase()
      return shapeBindingId === normalizedBindingId || sourceBindingId === normalizedBindingId
    })
    if (!match) return false
    this.#document.selectedId = match.id
    this.#document.selectedIds = new Set([match.id])
    this.#focusSelection()
    return true
  }

  #autoCenterView() {
    this.#fitPageView()
  }

  #fitPageView() {
    const panel = this.shadowRoot?.querySelector<HTMLElement>('.panel')
    if (!panel) return

    const rect = panel.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    this.#viewport.fit(
      { width: rect.width, height: rect.height },
      { width: this.#worldWidth, height: this.#worldHeight }
    )
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
      this.#viewport.panBy(-event.deltaX, -event.deltaY)
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
    for (const shape of this.#document.shapes) {
      if (shape.locked) continue
      const bounds = shapeBounds(shape)
      if (bounds.x + bounds.width >= minX && bounds.x <= maxX && bounds.y + bounds.height >= minY && bounds.y <= maxY) {
        ids.push(shape.id)
      }
    }
    return ids
  }

  // ── Space-key pan ──────────────────────────────────────────────────────────

  #onKeyUp = (event: KeyboardEvent) => {
    if (isPanKeyUp(event)) {
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
    return this.#document.shapes.find((shape) => shape?.id === id) ?? null
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

  #isOpeningShape(shape: Shape): shape is LineShape {
    return shape.kind === 'door' || shape.kind === 'window' || shape.kind === 'gate'
  }

  #bindOpeningToWall(shape: LineShape): LineShape {
    if (!this.#isOpeningShape(shape)) return shape
    const walls = this.#document.shapes.filter((candidate): candidate is LineShape => candidate.kind === 'wall')
    return bindOpeningToNearestWall(shape, walls)
  }

  #rebindAllOpeningsToWalls() {
    if (!this.#document.shapes.length) return
    this.#document.shapes = this.#document.shapes.map((shape) => {
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
    const tolerance = Math.max(6, 12 / this.#viewport.state.zoom)
    for (let index = this.#document.shapes.length - 1; index >= 0; index -= 1) {
      const shape = this.#document.shapes[index]
      if (shape.hidden || shape.locked) continue
      if (shape.kind === 'text' && shape.generationKey && shape.sourceLink) continue
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
    if (!this.#tools.select(tool)) return
    const shellAction = this.#tools.shellAction()
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
    const ids =
      this.#document.selectedIds.size > 0
        ? [...this.#document.selectedIds]
        : this.#document.selectedId
          ? [this.#document.selectedId]
          : []
    return ids.filter((id) => !this.#shapeById(id)?.locked)
  }

  #expandSelectionWithGroup(shapeId: string): Set<string> {
    return expandSelectionWithGroup(this.#document.shapes, shapeId)
  }

  #selectedGroupIds(): string[] {
    const ids = new Set<string>()
    for (const id of this.#selectedShapeIds()) {
      const groupId = this.#shapeById(id)?.groupId
      // Exclude one-wire layout groups from regular grouping operations
      if (groupId && !groupId.startsWith('onewire-')) ids.add(groupId)
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
    const selectedIds = this.#selectedShapeIds()
    if (!selectedIds.length) return false

    // First, check if we're ungrouping symbols with catalogShapes
    let unpackedAny = false
    const groupId = `group-${nextShapeId()}`
    const unpackedIds: string[] = []
    for (const id of selectedIds) {
      const shape = this.#shapeById(id)
      if (!shape || shape.kind !== 'symbol' || !shape.catalogShapes?.length) continue

      // Unpack catalog shapes: translate them to symbol position and place as group
      const symbolPosition = shape.position
      const unpacked = shape.catalogShapes.map((catalogShape) => {
        const cloned = cloneShape(catalogShape)
        cloned.id = nextShapeId()
        cloned.groupId = groupId
        unpackedIds.push(cloned.id)
        // Translate shapes to symbol's position
        return this.#translateShape(cloned, symbolPosition.x, symbolPosition.y)
      })

      // Add unpacked shapes to canvas
      this.#document.shapes.push(...unpacked)

      // Remove the symbol
      this.#document.shapes = this.#document.shapes.filter((s) => s.id !== id)
      unpackedAny = true
    }

    if (unpackedAny) {
      // Select the unpacked shapes as a group
      this.#document.selectedIds = new Set(unpackedIds)
      this.#document.selectedId = unpackedIds[0] ?? null
      this.#pushHistory()
      this.#render()
      return true
    }

    // Otherwise, handle regular groups
    const groupIds = this.#selectedGroupIds()
    if (!groupIds.length) return false

    const targetGroups = new Set(groupIds)
    let ungroupedAny = false

    for (const shape of this.#document.shapes) {
      if (!shape.groupId || !targetGroups.has(shape.groupId)) continue
      const updated = { ...shape }
      delete updated.groupId
      this.#setShape(updated)
      ungroupedAny = true
    }

    if (ungroupedAny) {
      this.#pushHistory()
      this.#render()
    }

    return ungroupedAny
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
            rotation: ((((shape.rotation ?? 0) + deltaDegrees) % 360) + 360) % 360
          })
          break
        }
        case 'text':
        case 'symbol':
          this.#setShape({
            ...shape,
            position: this.#rotatePointAround(shape.position, center, deltaDegrees),
            rotation: ((((shape.rotation ?? 0) + deltaDegrees) % 360) + 360) % 360
          })
          break
        case 'image':
          this.#setShape({
            ...shape,
            position: this.#rotatePointAround(shape.position, center, deltaDegrees),
            rotation: ((((shape.rotation ?? 0) + deltaDegrees) % 360) + 360) % 360
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
            scale: Math.max(0.1, Math.min(20, shape.scale * factor)),
            ...(typeof shape.strokeWidth === 'number'
              ? { strokeWidth: resizedSymbolStrokeWidth(shape, Math.max(0.1, Math.min(20, shape.scale * factor))) }
              : {})
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
    if (this.#tools.current === 'symbol' && this.#pendingCatalogSymbol) {
      this.#pendingCatalogSymbol = null
      this.#symbolPreviewPoint = null
      this.#symbolPlacement = null
      this.#snapTarget = null
      this.#stagePointerId = null
      this.#tools.select('select')
      this.#render()
      return
    }
    const shapeElement = event.target instanceof Element ? event.target.closest<SVGElement>('[data-shape-id]') : null
    const shapeId = shapeElement?.dataset.shapeId ?? null

    if (shapeId) {
      if (!this.#document.selectedIds.has(shapeId)) this.#document.selectedIds = this.#expandSelectionWithGroup(shapeId)
      this.#document.selectedId = shapeId
    }

    this.#stageContextPastePoint = this.#pointFromEvent(event as PointerEvent)

    this.#openStageContextMenu(event.clientX, event.clientY)
  }

  #onStageDoubleClick = async (event: MouseEvent) => {
    const point = this.#pointFromEvent(event as PointerEvent)
    if (!point) return

    const shapeElement = event.target instanceof Element ? event.target.closest<SVGElement>('[data-shape-id]') : null
    let shapeId = shapeElement?.dataset.shapeId ?? null
    shapeId ??= this.#shapeIdAtPoint(point)
    if (!shapeId) {
      const selectable = this.#document.shapes.filter((shape) => !shape.locked)
      this.#document.selectedIds = new Set(selectable.map((shape) => shape.id))
      this.#document.selectedId = selectable[0]?.id ?? null
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
      const values = await globalThis.cadleShell.requestInput({
        title: 'Edit text',
        submitLabel: 'Update text',
        fields: [{ name: 'text', label: 'Text', value: shape.text, required: true }]
      })
      const nextText = values?.text
      if (!nextText || nextText === shape.text) {
        this.#document.selectedId = shape.id
        this.#document.selectedIds = new Set([shape.id])
        this.#render()
        return
      }

      this.#setShape({ ...shape, text: nextText } as TextShape)
      this.#document.selectedId = shape.id
      this.#document.selectedIds = new Set([shape.id])
      this.#pushHistory()
      this.#render()
      return
    }

    if (!shape.groupId) return

    // In a group: double-click isolates one shape for direct edit/delete operations.
    this.#document.selectedIds = new Set([shapeId])
    this.#document.selectedId = shapeId
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
      const snappedTranslation = snapPasteTranslation(
        this.#nativeClipboard,
        { x: dx, y: dy },
        { x: minX, y: minY },
        GRID_SIZE
      )
      dx = snappedTranslation.x
      dy = snappedTranslation.y
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
    this.#document.shapes.push(...pasted)
    this.#document.selectedIds = new Set(pasted.map((shape) => shape.id))
    this.#document.selectedId = pasted[0]?.id ?? null
    this.#pushHistory()
    this.#render()
    return true
  }

  #deleteNativeSelection(): boolean {
    const ids = new Set(this.#selectedShapeIds())
    if (!ids.size) return false
    const currentPageType = this.#pageKey ? this.#project?.pages?.[this.#pageKey]?.pageType : undefined
    const circuitTargets = new Set<string>()
    const affectedRailIds = new Set<string>()
    if (currentPageType === 'onewire') {
      for (const shape of this.#document.shapes) {
        if (!ids.has(shape.id) || !shape.groupId?.startsWith('onewire-')) continue
        if (shape.kind === 'symbol' && shape.sourceLink?.role === 'breaker') {
          const terminal = oneWireSymbolTerminalInfo(shape.path, shape.scale)?.bottom
          const terminalPoint = {
            x: shape.position.x + (terminal?.x ?? 0),
            y: shape.position.y + (terminal?.y ?? 0)
          }
          const railId = shape.oneWireRailId ?? this.#nearestKamrail(terminalPoint)?.rail.id
          if (railId) affectedRailIds.add(railId)
        }
        if (shape.sourceLink?.kind === 'board' || shape.sourceLink?.kind === 'circuit') {
          circuitTargets.add(shape.sourceLink.id)
        }
      }
    }
    this.#document.shapes = this.#document.shapes.filter((shape) => !ids.has(shape.id))
    for (const railId of affectedRailIds) this.#resizeOneWireRailsToBreakers(railId, false)
    this.#document.selectedId = null
    this.#document.selectedIds = new Set()
    this.#pushHistory()
    this.#render()
    if (circuitTargets.size) {
      const clearedOneWireProperties: CircuitPropertyUpdate = {
        breakerCurrentA: null,
        cableSectionMm2: null,
        cableConductors: null,
        hasProtectiveConductor: null,
        cableType: null,
        cableInstallation: null,
        showCableInstallation: null,
        poles: null,
        phaseConfiguration: null,
        showPhaseLabel: null,
        breakerCurve: null,
        rcdSensitivityMa: null,
        rcdType: null,
        boardId: null,
        railId: null,
        notes: null
      }
      for (const circuitTarget of circuitTargets) {
        this.#circuitUpdatePromise = this.#updateCircuitProperties(
          circuitTarget,
          clearedOneWireProperties,
          false
        ).catch((error) => {
          console.error('Failed to clear deleted one-wire circuit data', error)
        })
      }
    }
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

  #arrangeNativeSelection(action: 'bring-forward' | 'bring-to-front' | 'send-backwards' | 'send-to-back'): boolean {
    const selected = new Set(this.#selectedShapeIds())
    if (!selected.size) return false

    if (action === 'bring-to-front') {
      const rest = this.#document.shapes.filter((shape) => !selected.has(shape.id))
      const picked = this.#document.shapes.filter((shape) => selected.has(shape.id))
      this.#document.shapes = [...rest, ...picked]
      this.#pushHistory()
      this.#render()
      return true
    }

    if (action === 'send-to-back') {
      const picked = this.#document.shapes.filter((shape) => selected.has(shape.id))
      const rest = this.#document.shapes.filter((shape) => !selected.has(shape.id))
      this.#document.shapes = [...picked, ...rest]
      this.#pushHistory()
      this.#render()
      return true
    }

    const next = [...this.#document.shapes]
    let changed = false
    if (action === 'bring-forward') {
      for (let index = next.length - 2; index >= 0; index -= 1) {
        if (!selected.has(next[index].id) || selected.has(next[index + 1].id)) continue
        ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
        changed = true
      }
    } else {
      for (let index = 1; index < next.length; index += 1) {
        if (!selected.has(next[index].id) || selected.has(next[index - 1].id)) continue
        ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
        changed = true
      }
    }

    if (!changed) return false
    this.#document.shapes = next
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
        {
          const selectable = this.#document.shapes.filter((shape) => !shape.locked)
          this.#document.selectedIds = new Set(selectable.map((shape) => shape.id))
          this.#document.selectedId = selectable[0]?.id ?? null
        }
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
      case 'bring-forward':
        return this.#arrangeNativeSelection('bring-forward')
      case 'bring-to-front':
        return this.#arrangeNativeSelection('bring-to-front')
      case 'send-backwards':
        return this.#arrangeNativeSelection('send-backwards')
      case 'send-to-back':
        return this.#arrangeNativeSelection('send-to-back')
      case 'print':
        void this.#printSvg().catch(() => window.alert('Unable to print SVG'))
        return true
      case 'escape':
        return false
    }
  }

  #handleEscapeKey() {
    const action = resolveNativeEscapeAction({
      tool: this.#tools.current,
      hasPendingCatalogSymbol: Boolean(this.#pendingCatalogSymbol),
      hasSymbolPreviewPoint: Boolean(this.#symbolPreviewPoint),
      hasWallChain: Boolean(this.#wallChain),
      hasDraft: Boolean(this.#draft),
      hasDrag: Boolean(this.#drag),
      selectedId: this.#document.selectedId,
      selectedCount: this.#document.selectedIds.size,
      hasBandStart: Boolean(this.#bandStart),
      hasOneWireAnchor: Boolean(this.#oneWireAnchor)
    })

    if (action === 'cancel-symbol') {
      this.#pendingCatalogSymbol = null
      this.#symbolPreviewPoint = null
      this.#symbolPlacement = null
      this.#tools.select('select')
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
      this.#document.selectedId = null
      this.#document.selectedIds = new Set()
      this.#bandStart = null
      this.#bandEnd = null
      this.#snapTarget = null
      this.#snapIndicatorKind = 'wall'
      this.#stagePointerId = null
      this.#render()
      return
    }

    if (this.#tools.current !== 'select') {
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
    for (const shape of this.#document.shapes) {
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
      lower.includes('/photovoltaic devices') ||
      lower.includes('/socket outlets/') ||
      lower.includes('/one-wire/')
    )
  }

  #symbolConnectionPoints(shape: SymbolShape): Point[] {
    return this.#symbolConnectionAnchors(shape).map((anchor) => anchor.point)
  }

  #symbolConnectionAnchors(shape: SymbolShape) {
    return this.#isElectricalSymbolPath(shape.path) ? oneWireSymbolConnectionAnchors(shape) : []
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

    for (const shape of this.#document.shapes) {
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

  #snapSymbolToWallOffset(
    point: Point,
    symbolHalfExtent: number,
    symbol: SymbolShape | null = null
  ): ReturnType<typeof snapSymbolToWallOffset> {
    return snapSymbolToWallOffset(point, symbolHalfExtent, this.#document.shapes, this.#viewport.state.zoom, symbol)
  }

  // Snap the symbol center onto a nearby line axis (one-wire branch/feeder/bus).
  // Keeps the along-line coordinate on the grid so symbols line up in columns.
  #snapSymbolToBranchLine(point: Point): { point: Point; snapped: boolean } {
    const SNAP_RADIUS = 18
    let best: Point | null = null
    let bestDistance = SNAP_RADIUS

    for (const shape of this.#document.shapes) {
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
    const symbolScale = this.#pendingCatalogSymbol ? resolveCatalogSymbolScale(this.#pendingCatalogSymbol) : 1
    const symbolHalfExtent = (24 * Math.max(0.4, symbolScale)) / 2
    const previewShape = this.#pendingCatalogSymbol
      ? createSymbolShape('symbol-preview', rawPoint, this.#pendingCatalogSymbol)
      : null

    const wall = this.#snapSymbolToWallOffset(rawPoint, symbolHalfExtent, previewShape)
    if (
      wall.snapped &&
      this.#pendingCatalogSymbol &&
      /\/(?:switches|socket outlets)\//i.test(this.#pendingCatalogSymbol.path)
    ) {
      const symbol = snapWallSymbolNextToSymbol(
        wall.point,
        {
          id: 'symbol-preview',
          kind: 'symbol',
          position: wall.point,
          name: this.#pendingCatalogSymbol.name,
          path: this.#pendingCatalogSymbol.path,
          scale: symbolScale
        },
        this.#document.shapes,
        new Set(),
        this.#viewport.state.zoom,
        wall.wall
      )
      if (symbol.snapped) return { point: symbol.point, snapped: true, kind: 'wall' }
    }

    // The wall position remains authoritative when no safe adjacent symbol anchor is available.
    if (wall.snapped) return { point: wall.point, snapped: true, kind: 'wall' }

    if (this.#pendingCatalogSymbol && /\/(?:switches|socket outlets)\//i.test(this.#pendingCatalogSymbol.path)) {
      const symbol = snapWallSymbolNextToSymbol(
        rawPoint,
        {
          id: 'symbol-preview',
          kind: 'symbol',
          position: rawPoint,
          name: this.#pendingCatalogSymbol.name,
          path: this.#pendingCatalogSymbol.path,
          scale: symbolScale
        },
        this.#document.shapes,
        new Set(),
        this.#viewport.state.zoom
      )
      if (symbol.snapped) return { point: symbol.point, snapped: true, kind: 'wall' }
    }

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
    if (!this.#snapTarget || !this.#snap || this.#tools.current === 'select') return false
    if (this.#tools.current === 'wall') return Boolean(this.#wallChain)
    if (
      this.#tools.current === 'door' ||
      this.#tools.current === 'window' ||
      this.#tools.current === 'gate' ||
      this.#tools.current === 'line'
    ) {
      return Boolean(this.#draft)
    }
    if (this.#tools.current === 'symbol') return Boolean(this.#pendingCatalogSymbol)
    if (this.#tools.current === 'onewire') return true
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
      return { name: 'Socket outlet', path: ONE_WIRE_SOCKET_SYMBOL_PATH }
    }
    if (this.#oneWirePreset === 'motor') {
      return { name: 'Motor', path: 'symbols/Consumption appliances/Motor.svg' }
    }
    return { name: 'Lighting', path: 'symbols/Consumption appliances/Lighting.svg' }
  }

  #oneWireSymbolScale(path: string, _kind: 'breaker' | 'switch' | 'kamrail' | 'load'): number {
    return oneWireSymbolScaleFor(path) ?? inferSymbolScale(path)
  }

  #rebuildExistingOneWireTopology(): boolean {
    const bus = this.#document.shapes.find(
      (shape): shape is LineShape => shape.kind === 'line' && shape.generationKey === 'board:main:topology:bus'
    )
    const topology = this.#project?.oneWireTopology
    if (!bus || !topology) return false

    const busWidth = Math.min(620, this.#worldWidth - 240)
    const safeArea = this.#safeAreaRect()
    const busY = safeArea.y + safeArea.height * 0.55
    const freshBus: LineShape = {
      ...bus,
      id: nextShapeId(),
      start: { x: (this.#worldWidth - busWidth) / 2, y: busY },
      end: { x: (this.#worldWidth + busWidth) / 2, y: busY },
      strokeWidth: KAMRAIL_STROKE_WIDTH
    }
    const analysis = this.analyzeBindings()
    const evGroup = analysis.groups.find((group) =>
      group.components.some((component) =>
        /(?:elektrische\s+(?:wagen|auto)|laadpaal|wallbox|\bev\b)/i.test(`${component.name} ${component.path ?? ''}`)
      )
    )
    const evComponent = evGroup?.components.find(
      (component) =>
        Boolean(component.path) &&
        /(?:elektrische\s+(?:wagen|auto)|laadpaal|wallbox|\bev\b)/i.test(`${component.name} ${component.path}`)
    )
    const previous = this.#document.shapes.filter(
      (shape) => shape.id === bus.id || shape.groupId?.startsWith('onewire-topology-')
    )
    const retained = this.#document.shapes.filter(
      (shape) => shape.id !== bus.id && !shape.groupId?.startsWith('onewire-topology-')
    )
    const fresh: Shape[] = [
      freshBus,
      ...buildOneWireTopology(topology, freshBus, nextShapeId, {
        gridProtectionCurrentA: this.#project?.mainFuseA,
        defaultPoles: this.#project?.electricalProfile?.defaultPoles,
        phaseConfiguration: this.#project?.electricalProfile?.phaseConfiguration,
        protectionManufacturer: 'Schneider Electric',
        ...(evGroup && evComponent?.path
          ? {
              ev: {
                bindingId: evGroup.bindingId,
                name: evComponent.name,
                path: evComponent.path,
                scale: oneWireSymbolScaleFor(evComponent.path) ?? 1.35
              }
            }
          : {})
      })
    ]
    const reconciled = this.#oneWireController.reconcile(previous, fresh)
    this.#document.shapes = [...retained, ...reconciled.shapes]
    return true
  }

  #resizeOneWireRailsToBreakers(targetRailId?: string, preserveExisting = Boolean(targetRailId)): boolean {
    let changed = false
    this.#document.shapes = this.#document.shapes.map((shape) => {
      if (shape.kind !== 'line' || !this.#isKamrailShape(shape)) return shape
      if (targetRailId && shape.id !== targetRailId) return shape
      const anchorXs = this.#document.shapes.flatMap((candidate) => {
        if (candidate.kind !== 'symbol' || candidate.sourceLink?.role !== 'breaker') return []
        if (candidate.oneWireRailId) {
          if (candidate.oneWireRailId !== shape.id) return []
        }
        const terminal = oneWireSymbolTerminalInfo(candidate.path, candidate.scale)?.bottom
        const y = candidate.position.y + (terminal?.y ?? 0)
        if (
          !candidate.oneWireRailId &&
          Math.abs(y - shape.start.y) > KAMRAIL_ATTACH_OFFSET + (shape.strokeWidth ?? KAMRAIL_STROKE_WIDTH)
        ) {
          return []
        }
        return [candidate.position.x + (terminal?.x ?? 0)]
      })
      if (!anchorXs.length) return shape
      const span = this.#oneWireController.railSpanForAnchors(
        anchorXs,
        { startX: shape.start.x, endX: shape.end.x },
        preserveExisting
      )
      if (!span) return shape
      const { startX, endX } = span
      if (Math.abs(shape.start.x - startX) < 0.01 && Math.abs(shape.end.x - endX) < 0.01) return shape
      changed = true
      return { ...shape, start: { ...shape.start, x: startX }, end: { ...shape.end, x: endX } }
    })
    return changed
  }

  #compactExistingOneWireRail(): boolean {
    const rails = this.#document.shapes.filter(
      (shape): shape is LineShape => shape.kind === 'line' && this.#isKamrailShape(shape)
    )
    if (!rails.length) return false

    const nearestRail = (y: number): LineShape =>
      rails.reduce((nearest, candidate) =>
        Math.abs(candidate.start.y - y) < Math.abs(nearest.start.y - y) ? candidate : nearest
      )
    const anchors = this.#document.shapes.flatMap((shape) => {
      if (shape.kind !== 'symbol' || shape.sourceLink?.role !== 'breaker' || !shape.generationKey) return []
      const family = this.#normalizeBindingFamily(shape.bindingId ?? '')
      if (!family) return []
      const bottom = oneWireSymbolTerminalInfo(shape.path, shape.scale)?.bottom
      const y = shape.position.y + (bottom?.y ?? 0)
      const persistedRail = shape.oneWireRailId ? rails.find((rail) => rail.id === shape.oneWireRailId) : undefined
      const rail = persistedRail ?? nearestRail(y)
      return [
        {
          id: shape.id,
          groupId: shape.groupId,
          railId: rail.id,
          family,
          x: shape.position.x + (bottom?.x ?? 0),
          y
        }
      ]
    })
    if (!anchors.length) return false

    const shapePoint = (shape: Shape): Point => {
      if ('start' in shape && 'end' in shape) {
        return { x: (shape.start.x + shape.end.x) / 2, y: Math.max(shape.start.y, shape.end.y) }
      }
      return shape.position
    }
    const anchorForShape = (shape: Shape, family: string) => {
      const matching = anchors.filter((anchor) => anchor.family === family)
      if (!matching.length) return undefined
      if (shape.oneWireRailId) {
        const onPersistedRail = matching.filter((anchor) => anchor.railId === shape.oneWireRailId)
        if (onPersistedRail.length === 1) return onPersistedRail[0]
        if (onPersistedRail.length > 1) matching.splice(0, matching.length, ...onPersistedRail)
      }
      const grouped = matching.find((anchor) => anchor.groupId && anchor.groupId === shape.groupId)
      if (grouped) return grouped
      const point = shapePoint(shape)
      return matching.reduce((nearest, candidate) => {
        const nearestDistance = Math.hypot(nearest.x - point.x, nearest.y - point.y)
        const candidateDistance = Math.hypot(candidate.x - point.x, candidate.y - point.y)
        return candidateDistance < nearestDistance ? candidate : nearest
      })
    }

    const anchorOffsets = new Map<string, number>()
    const descriptionPlacements = new Map<string, Point>()
    const familyForShape = (shape: Shape) => this.#normalizeBindingFamily(
      shape.bindingId ?? (shape.sourceLink?.kind === 'board' ? shape.sourceLink.id : '')
    )
    const railUpdates = new Map<string, LineShape>()
    for (const rail of rails) {
      const railAnchors = anchors.filter((anchor) => anchor.railId === rail.id).sort((a, b) => a.x - b.x)
      if (!railAnchors.length) continue
      const familyShapes = (anchor: typeof railAnchors[number]) => this.#document.shapes.filter((shape) =>
        !shape.hidden && !this.#isKamrailShape(shape) &&
        familyForShape(shape) === anchor.family && anchorForShape(shape, anchor.family)?.id === anchor.id
      )
      const contentTop = Math.min(...railAnchors.flatMap((anchor) => familyShapes(anchor)
        .filter((shape) => shape.sourceLink?.role !== 'description')
        .map((shape) => oneWireLayoutBounds(shape).y)))
      const familyBounds = railAnchors.map((anchor) => {
        const members = familyShapes(anchor)
        const boxes = members.filter((shape) => shape.sourceLink?.role !== 'description').map(oneWireLayoutBounds)
        const xs = boxes.flatMap((bounds) => [bounds.x, bounds.x + bounds.width])
        const center = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : anchor.x
        for (const description of members.filter((shape) => shape.kind === 'text' && shape.sourceLink?.role === 'description')) {
          const bounds = oneWireLayoutBounds(description)
          xs.push(center - bounds.width / 2, center + bounds.width / 2)
          descriptionPlacements.set(description.id, { x: center, y: contentTop - 24 })
        }
        return {
          family: anchor.id,
          anchorX: anchor.x,
          minX: xs.length ? Math.min(...xs) : anchor.x,
          maxX: xs.length ? Math.max(...xs) : anchor.x
        }
      })
      const safeArea = this.#safeAreaRect()
      const geometry = this.#oneWireController.packFamilies(
        familyBounds,
        Math.round((safeArea.x + safeArea.width / 2) / GRID_SIZE) * GRID_SIZE
      )
      railAnchors.forEach((anchor) => {
        const targetX = geometry.familyXs.get(anchor.id)
        if (typeof targetX === 'number') anchorOffsets.set(anchor.id, targetX - anchor.x)
      })
      railUpdates.set(rail.id, {
        ...rail,
        start: { ...rail.start, x: geometry.startX },
        end: { ...rail.end, x: geometry.endX }
      })
    }
    if (!anchorOffsets.size) return false

    let changed = false
    this.#document.shapes = this.#document.shapes.map((shape) => {
      const rail = railUpdates.get(shape.id)
      if (rail) {
        if (shape.kind !== 'line' || rail.start.x !== shape.start.x || rail.end.x !== shape.end.x) changed = true
        return rail
      }
      const family = familyForShape(shape)
      const anchor = family ? anchorForShape(shape, family) : undefined
      const dx = anchor ? anchorOffsets.get(anchor.id) : undefined
      if (!anchor || typeof dx !== 'number') return shape
      const description = descriptionPlacements.get(shape.id)
      if (description && shape.kind === 'text') {
        const position = { x: description.x + dx, y: description.y }
        if (shape.position.x === position.x && shape.position.y === position.y && shape.textAnchor === 'middle' && shape.oneWireRailId === anchor.railId) return shape
        changed = true
        return { ...shape, position, textAnchor: 'middle', oneWireRailId: anchor.railId }
      }
      const translated = Math.abs(dx) < 0.01 ? shape : translateShape(shape, dx, 0)
      if (translated.oneWireRailId === anchor.railId && translated === shape) return shape
      changed = true
      return { ...translated, oneWireRailId: anchor.railId }
    })
    return changed
  }

  // Trikker-style cleanup for existing one-wire groups: symbols are centered on
  // their row axis and each horizontal wire is re-cut into segments that stop at
  // the visible edges of the symbols sitting on it. Wires never cross symbols.
  #realignExistingOneWire(): boolean {
    const compacted = this.#compactExistingOneWireRail()
    const isOneWire = (shape: Shape) => typeof shape.groupId === 'string' && shape.groupId.startsWith('onewire-')
    const groupedOneWireShapes = this.#document.shapes.filter(
      (shape) => isOneWire(shape) && !shape.groupId!.startsWith('onewire-kamrail-')
    )
    const bindingFallbackShapes = this.#document.shapes.filter((shape) => {
      if (shape.kind !== 'line' && shape.kind !== 'symbol') return false
      if (typeof shape.groupId === 'string' && shape.groupId.startsWith('onewire-kamrail-')) return false
      return typeof shape.bindingId === 'string' && shape.bindingId.trim().length > 0
    })
    const oneWireShapes = groupedOneWireShapes.length ? groupedOneWireShapes : bindingFallbackShapes
    if (!oneWireShapes.length) return compacted

    const symbols = oneWireShapes.filter((shape): shape is SymbolShape => shape.kind === 'symbol')
    const horizontalWires = oneWireShapes.filter(
      (shape): shape is LineShape => shape.kind === 'line' && Math.abs(shape.end.y - shape.start.y) < 1
    )
    if (!horizontalWires.length && !symbols.length) return compacted

    const AXIS_RADIUS = 20
    const updatedShapes = new Map<string, Shape>()
    const removedIds = new Set<string>()
    const addedShapes: Shape[] = []

    for (const shape of oneWireShapes) {
      if (shape.kind === 'line' && shape.strokeWidth !== ONE_WIRE_CONDUCTOR_STROKE_WIDTH) {
        updatedShapes.set(shape.id, { ...shape, strokeWidth: ONE_WIRE_CONDUCTOR_STROKE_WIDTH })
      }
    }

    const nodeOffsetFor = (symbol: SymbolShape): Point =>
      oneWireSymbolNodeInfo(symbol.path, symbol.scale, symbol.rotation, symbol.flipX, symbol.flipY)?.offset ?? { x: 0, y: 0 }

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
        const node = oneWireSymbolNodeInfo(symbol.path, symbol.scale, symbol.rotation, symbol.flipX, symbol.flipY)
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
          end: { x: segment.to, y },
          strokeWidth: ONE_WIRE_CONDUCTOR_STROKE_WIDTH
        } as LineShape)
      }
    }

    if (!updatedShapes.size && !removedIds.size) {
      if (!compacted) return false
      this.#document.selectedId = null
      this.#document.selectedIds = new Set()
      this.#pushHistory()
      this.#render()
      return true
    }

    this.#document.shapes = this.#document.shapes
      .filter((shape) => !removedIds.has(shape.id))
      .map((shape) => updatedShapes.get(shape.id) ?? shape)
    this.#document.shapes.push(...addedShapes)
    this.#document.selectedId = null
    this.#document.selectedIds = new Set()
    this.#pushHistory()
    this.#render()
    return true
  }

  #isKamrailShape(shape: Shape | null): shape is LineShape {
    return this.#oneWireController.isRail(shape)
  }

  #normalizeBindingFamily(value: string | null): string | null {
    return this.#oneWireController.familyKey(value)
  }

  #nextUnlabeledBreakerKey(): string {
    const usedKeys = new Set(
      this.#document.shapes.flatMap((shape) => {
        const linkedKey = shape.sourceLink?.kind === 'board' ? shape.sourceLink.id.trim().toUpperCase() : ''
        const bindingKey = shape.bindingId?.trim().toUpperCase() ?? ''
        return [linkedKey, bindingKey].filter(Boolean)
      })
    )
    for (const key of Object.keys(this.#project?.circuitSpecifications ?? {})) {
      usedKeys.add(key.trim().toUpperCase())
    }

    let index = 1
    while (usedKeys.has(`BRK${index}`)) index += 1
    return `BRK${index}`
  }

  #composeKindForShape(shape: Shape): 'switch' | 'load' {
    if (shape.kind === 'door' || shape.kind === 'gate') return 'switch'
    if (shape.kind !== 'symbol') return 'load'
    const lower = `${shape.name} ${shape.path}`.toLowerCase()
    return lower.includes('switch') || lower.includes('schakel') || lower.includes('knop') ? 'switch' : 'load'
  }

  #groundplanShapePool(): Shape[] {
    const currentPageType = this.#pageKey ? this.#project?.pages?.[this.#pageKey]?.pageType : undefined
    // Separate page coordinate spaces before room inference. Ground plans often
    // reuse the same A4 coordinates, so flattening them directly could assign a
    // device on page 2 to a room drawn at the same position on page 1.
    const pageOffset = (shapes: readonly Shape[], pageIndex: number): Shape[] =>
      shapes.map((shape) => translateShape(cloneShape(shape), pageIndex * 10_000_000, 0))
    const pageKeys = Object.keys(this.#project?.pages ?? {}) as UUID[]
    const currentPageIndex = this.#pageKey ? Math.max(0, pageKeys.indexOf(this.#pageKey)) : 0
    const pool: Shape[] = currentPageType === 'onewire' ? [] : pageOffset(this.#document.shapes, currentPageIndex)
    if (!this.#project?.pages) return pool

    for (const [pageIndex, pageKey] of pageKeys.entries()) {
      if (pageKey === this.#pageKey) continue
      const page = this.#project.pages[pageKey]
      if (page?.pageType === 'onewire') continue
      const state = this.#nativeStateForPage(pageKey)
      if (!state || !Array.isArray(state.shapes)) continue
      pool.push(...pageOffset(sanitizeShapes(state.shapes), pageIndex))
    }

    return pool
  }

  analyzeBindings(): CircuitAnalysis {
    return this.#oneWireController.analyze(
      this.#groundplanShapePool(),
      this.#project?.electricalProfile,
      this.#project?.circuitSpecifications
    )
  }

  autoNameElectrical(lightingCircuitCount: number): { labeled: number; circuitCount: number; message: string } {
    const currentPageType = this.#pageKey ? this.#project?.pages?.[this.#pageKey]?.pageType : undefined
    if (currentPageType === 'onewire' || currentPageType === 'circuit-schedule') {
      return { labeled: 0, circuitCount: 0, message: 'Open a floor plan before automatically naming circuits.' }
    }

    const plan = planAutomaticBindings(this.#document.shapes, lightingCircuitCount)
    if (!plan.assignments.size) {
      return { labeled: 0, circuitCount: 0, message: 'All recognized electrical symbols already have a label.' }
    }

    this.#document.shapes = this.#document.shapes.map((shape) => {
      const bindingId = plan.assignments.get(shape.id)
      return bindingId ? { ...shape, bindingId } : shape
    })
    this.#pushHistory()
    this.#render()
    return {
      labeled: plan.assignments.size,
      circuitCount: plan.circuitCount,
      message: `Named ${plan.assignments.size} electrical symbols across ${plan.circuitCount} circuits.`
    }
  }

  getBOMRows(): BomRow[] {
    return circuitBomRows(this.analyzeBindings())
  }

  getCircuitScheduleEditorItems(): CircuitScheduleEditorItem[] {
    return circuitScheduleEditorItems(this.#project, this.analyzeBindings())
  }

  generateAutoOneWire(pageIndex = 0): {
    generated: boolean
    circuitCount: number
    pageCount?: number
    message?: string
  } {
    const currentPageType = this.#pageKey ? this.#project?.pages?.[this.#pageKey]?.pageType : undefined
    if (currentPageType !== 'onewire') {
      return { generated: false, circuitCount: 0, message: 'Open a one-wire page before generating.' }
    }

    const analysis = this.analyzeBindings()
    if (!analysis.valid) {
      const detail = analysis.issues.find((issue) => issue.severity === 'error')?.message
      return {
        generated: false,
        circuitCount: analysis.totalGroups,
        message: detail ?? 'No valid bound floor-plan circuits were found.'
      }
    }

    const { generated: previousGenerated, retained: retainedShapes } =
      this.#oneWireController.partitionRegenerationShapes(this.#document.shapes)
    const previousShapes = this.#document.shapes
    const previousSelectedId = this.#document.selectedId
    const previousSelectedIds = this.#document.selectedIds

    try {
      this.#document.shapes = [...retainedShapes]
      const railWidth = Math.min(1200, Math.max(500, this.#worldWidth - 160))
      const railStartX = (this.#worldWidth - railWidth) / 2
      const railEndX = railStartX + railWidth
      const usableWidth = Math.max(1, railEndX - railStartX)
      const safeArea = this.#safeAreaRect()
      const usableHeight = Math.max(ONE_WIRE_FIRST_ROW_OFFSET_Y, safeArea.height)
      const layoutPlan = this.#oneWireController.plan(
        analysis.families.map((family) => {
          const groups = analysis.groups.filter((group) => group.family === family)
          const boardIds = new Set(groups.map((group) => group.specification.boardId).filter(Boolean))
          const railIds = new Set(groups.map((group) => group.specification.railId).filter(Boolean))
          const boardId = boardIds.size === 1 ? [...boardIds][0] : undefined
          const railId = railIds.size === 1 ? [...railIds][0] : undefined
          return {
            family,
            circuitCount: groups.length,
            requiredWidth: this.#oneWireFamilyRequiredWidth(family),
            ...(boardId ? { boardId } : {}),
            ...(railId ? { railId } : {})
          }
        }),
        usableWidth,
        usableHeight
      )
      const topology = this.#project?.oneWireTopology
      const topologyPage = Boolean(topology) && pageIndex === 0
      const circuitPageIndex = topology ? pageIndex - 1 : pageIndex
      const totalPageCount = layoutPlan.pageCount + (topology ? 1 : 0)
      const electricalSheetNumber = (layoutPageIndex: number) => layoutPageIndex + (topology ? 2 : 1)
      const destinationSheetLabels = Object.fromEntries(
        layoutPlan.placements.map((placement) => [
          `${placement.boardId ?? 'main'}::${placement.railId ?? '__unassigned__'}`,
          `E${electricalSheetNumber(placement.pageIndex)}`
        ])
      )
      const visiblePlacements = topologyPage
        ? []
        : layoutPlan.placements.filter((placement) => placement.pageIndex === circuitPageIndex)
      if (!topologyPage && !visiblePlacements.length) {
        this.#document.shapes = previousShapes
        return {
          generated: false,
          circuitCount: analysis.totalGroups,
          pageCount: totalPageCount,
          message: 'No circuits are assigned to this one-wire page.'
        }
      }

      const rails = new Map<number, LineShape>()
      if (topologyPage && topology) {
        const busWidth = Math.min(620, this.#worldWidth - 240)
        const busY = safeArea.y + safeArea.height * 0.55
        const topologyBus: LineShape = {
          id: nextShapeId(),
          kind: 'line',
          start: { x: (this.#worldWidth - busWidth) / 2, y: busY },
          end: { x: (this.#worldWidth + busWidth) / 2, y: busY },
          stroke: '#111111',
          strokeWidth: KAMRAIL_STROKE_WIDTH,
          groupId: `onewire-topology-${nextShapeId()}`,
          generationKey: 'board:main:topology:bus',
          sourceLink: { kind: 'board', id: 'main', role: 'topology-bus' }
        }
        this.#document.shapes.push(topologyBus)
        const evGroup = analysis.groups.find((group) =>
          group.components.some((component) =>
            /(?:elektrische\s+(?:wagen|auto)|laadpaal|wallbox|\bev\b)/i.test(
              `${component.name} ${component.path ?? ''}`
            )
          )
        )
        const evComponent = evGroup?.components.find(
          (component) =>
            Boolean(component.path) &&
            /(?:elektrische\s+(?:wagen|auto)|laadpaal|wallbox|\bev\b)/i.test(`${component.name} ${component.path}`)
        )
        this.#document.shapes.push(
          ...buildOneWireTopology(topology, topologyBus, nextShapeId, {
            gridProtectionCurrentA: this.#project?.mainFuseA,
            defaultPoles: this.#project?.electricalProfile?.defaultPoles,
            phaseConfiguration: this.#project?.electricalProfile?.phaseConfiguration,
            protectionManufacturer: 'Schneider Electric',
            destinationSheetLabels,
            ...(evGroup && evComponent?.path
              ? {
                  ev: {
                    bindingId: evGroup.bindingId,
                    name: evComponent.name,
                    path: evComponent.path,
                    scale: oneWireSymbolScaleFor(evComponent.path) ?? 1.35
                  }
                }
              : {})
          })
        )
      } else {
        for (const railIndex of new Set(visiblePlacements.map((placement) => placement.railIndex))) {
          const placement = visiblePlacements.find((candidate) => candidate.railIndex === railIndex)
          const boardId = placement?.boardId ?? 'main'
          const railId = placement?.railId
          const destinationId = railId ? `${boardId}:${railId}` : boardId
          const railPlacements = visiblePlacements.filter((candidate) => candidate.railIndex === railIndex)
          const rows = Math.max(
            1,
            ...railPlacements.map((candidate) => Math.ceil(candidate.circuitCount / 2))
          )
          const railY = oneWireRailYForRows(rows, safeArea)
          const rail: LineShape = {
            id: nextShapeId(),
            kind: 'line',
            start: { x: railStartX, y: railY },
            end: { x: railEndX, y: railY },
            stroke: '#111111',
            strokeWidth: KAMRAIL_STROKE_WIDTH,
            groupId: `onewire-kamrail-${nextShapeId()}`,
            generationKey: `board:${boardId}:rail:${railId ?? railIndex}`,
            sourceLink: {
              kind: 'board',
              id: boardId,
              role: railId ? `rail:${destinationId}` : `board:${destinationId}`
            }
          }
          rails.set(railIndex, rail)
          this.#document.shapes.push(rail)
          const destinationPages = [
            ...new Set(
              layoutPlan.placements
                .filter(
                  (candidate) =>
                    (candidate.boardId ?? 'main') === boardId &&
                    (candidate.railId ?? '__unassigned__') === (railId ?? '__unassigned__')
                )
                .map((candidate) => electricalSheetNumber(candidate.pageIndex))
            )
          ].sort((a, b) => a - b)
          const currentSheet = pageIndex + 1
          const previousSheet = destinationPages.filter((sheet) => sheet < currentSheet).at(-1) ?? (topology ? 1 : null)
          const nextSheet = destinationPages.find((sheet) => sheet > currentSheet)
          const boardLabel = boardId
            .replace(/^(?:kast|board)[-\s]*/i, '')
            .replace(/-/g, ' ')
            .toUpperCase()
          const railLabel = railId
            ?.replace(/^(?:rij|rail)[-\s]*/i, '')
            .replace(/-/g, ' ')
            .toUpperCase()
          const references = [
            `KAST ${boardLabel || 'MAIN'}`,
            railLabel ? `RIJ ${railLabel}` : '',
            `BLAD E${currentSheet}`,
            previousSheet ? `VAN E${previousSheet}` : '',
            nextSheet ? `VERVOLG E${nextSheet}` : ''
          ].filter(Boolean)
          const sheetReference: TextShape = {
            id: nextShapeId(),
            kind: 'text',
            position: { x: rail.start.x, y: rail.start.y + 42 },
            text: references.join(' · '),
            scale: paperTextScale(2.5),
            fill: '#000000',
            stroke: 'none',
            groupId: rail.groupId,
            generationKey: `board:${destinationId}:sheet-reference`,
            sourceLink: { kind: 'board', id: boardId, role: `sheet-reference:${destinationId}` }
          }
          this.#document.shapes.push(sheetReference)
        }
      }

      let generatedFamilies = 0
      for (const placement of visiblePlacements) {
        const family = placement.family
        const rail = rails.get(placement.railIndex)
        if (!rail) throw new Error(`Missing one-wire rail ${placement.railIndex}.`)
        const x = rail.start.x + placement.centerOffset - placement.requiredWidth / 2 + 30
        const familyGroups = analysis.groups
          .filter((group) => group.family === family)
          .sort((a, b) => a.bindingId.localeCompare(b.bindingId, undefined, { numeric: true }))
          .slice(placement.circuitStart, placement.circuitStart + placement.circuitCount)
        const isMainDistributionBoard =
          family.toUpperCase() === 'ALSB' &&
          familyGroups.some((group) =>
            group.components.some(
              (component) => component.path && isDistributionBoardDevice(component.name, component.path)
            )
          )
        const familyCurrent = Math.max(...familyGroups.map((group) => group.specification.breakerCurrentA))
        const generated = this.#addKamrailCircuitBundle(rail, x, {
          amps: familyCurrent,
          cableSectionMm2: Math.max(...familyGroups.map((group) => group.specification.cableSectionMm2)),
          cableConductors: Math.max(...familyGroups.map((group) => group.specification.cableConductors)),
          hasProtectiveConductor: familyGroups[0]?.specification.hasProtectiveConductor ?? true,
          cableType: familyGroups[0]?.specification.cableType ?? 'VOB',
          cableInstallation: familyGroups[0]?.specification.cableInstallation ?? 'conduit-recessed',
          showCableInstallation: familyGroups[0]?.specification.showCableInstallation ?? true,
          breakerCurve: familyGroups[0]?.specification.breakerCurve ?? 'C',
          poles: Math.max(...familyGroups.map((group) => group.specification.poles)),
          phaseConfiguration: familyGroups.some(
            (group) =>
              group.specification.phaseConfiguration === 'three-phase' ||
              group.specification.phaseConfiguration === 'L1+L2+L3+N'
          )
            ? 'three-phase'
            : familyGroups[0]?.specification.phaseConfiguration,
          manufacturer: familyGroups[0]?.specification.manufacturer ?? 'Schneider Electric',
          neutralPosition: familyGroups[0]?.specification.neutralPosition ?? 'left',
          showPhaseLabel: familyGroups[0]?.specification.showPhaseLabel ?? true,
          family,
          autoIncludeFamily: true,
          omitBreaker: isMainDistributionBoard,
          bindingIds: familyGroups.map((group) => group.bindingId)
        })
        if (!generated) throw new Error(`Unable to generate one-wire family ${family}.`)
        generatedFamilies += 1
      }
      if (generatedFamilies !== visiblePlacements.length) {
        throw new Error('One-wire regeneration produced an incomplete result.')
      }
      this.#compactExistingOneWireRail()

      const freshGenerated = this.#document.shapes.slice(retainedShapes.length)
      const reconciled = this.#oneWireController.reconcile(previousGenerated, freshGenerated)
      this.#document.shapes = [...retainedShapes, ...reconciled.shapes]
      this.#document.selectedId = null
      this.#document.selectedIds = new Set()

      this.#pushHistory()
      this.#render()
      return {
        generated: true,
        circuitCount: analysis.totalGroups,
        pageCount: totalPageCount
      }
    } catch (error) {
      this.#document.shapes = previousShapes
      this.#document.selectedId = previousSelectedId
      this.#document.selectedIds = previousSelectedIds
      this.#render()
      console.error('One-wire regeneration failed; keeping the existing drawing.', error)
      return {
        generated: false,
        circuitCount: analysis.totalGroups,
        message: error instanceof Error ? error.message : 'One-wire regeneration failed.'
      }
    }
  }

  #groundplanComponentsForFamily(family: string): Array<{
    bindingId: string
    kind: 'switch' | 'load' | 'empty'
    sourceShapeId?: string
    sourcePath?: string
    sourceName?: string
    breakerCurrentA: number
    cableSectionMm2: number
    poles: number
    breakerCurve?: string
  }> {
    const entries: Array<{
      bindingId: string
      kind: 'switch' | 'load' | 'empty'
      sourceShapeId?: string
      sourcePath?: string
      sourceName?: string
      breakerCurrentA: number
      cableSectionMm2: number
      poles: number
      breakerCurve?: string
    }> = []
    for (const group of this.analyzeBindings().groups.filter((candidate) => candidate.family === family)) {
      const drawable = group.components.filter(
        (
          component
        ): component is CircuitComponent & { role: 'switch' | 'load' | 'protection' | 'junction'; path: string } =>
          ((component.role === 'switch' || component.role === 'load' || component.role === 'protection') &&
            Boolean(component.path)) ||
          (component.role === 'junction' &&
            Boolean(component.path) &&
            isDistributionBoardDevice(component.name, component.path))
      )
      if (drawable.length === 0) {
        entries.push({
          bindingId: group.bindingId,
          kind: 'empty',
          breakerCurrentA: group.specification.breakerCurrentA,
          cableSectionMm2: group.specification.cableSectionMm2,
          poles: group.specification.poles,
          breakerCurve: group.specification.breakerCurve
        })
        continue
      }
      for (const component of drawable) {
        const sourcePath =
          component.role === 'protection' ? oneWireProtectionSymbolPath(component.name, component.path) : component.path
        entries.push({
          bindingId: group.bindingId,
          kind: component.role === 'switch' ? 'switch' : 'load',
          sourceShapeId: component.shapeId,
          breakerCurrentA: group.specification.breakerCurrentA,
          cableSectionMm2: group.specification.cableSectionMm2,
          poles: group.specification.poles,
          breakerCurve: group.specification.breakerCurve,
          sourcePath,
          sourceName: component.name
        })
      }
    }
    return entries
  }

  #addKamrailCircuitBundle(
    rail: LineShape,
    anchorX: number,
    options: {
      amps: number
      cableSectionMm2?: number
      cableConductors?: number
      hasProtectiveConductor?: boolean
      cableType?: string
      cableInstallation?: 'conduit' | 'conduit-recessed' | 'without-conduit' | 'on-wall' | 'recessed' | 'underground'
      showCableInstallation?: boolean
      breakerCurve?: 'B' | 'C' | 'D' | 'other'
      poles?: number
      phaseConfiguration?: 'single-phase' | 'three-phase' | 'L1+N' | 'L2+N' | 'L3+N' | 'L1+L2+L3+N'
      manufacturer?: string
      neutralPosition?: 'left' | 'right'
      showPhaseLabel?: boolean
      family: string
      autoIncludeFamily: boolean
      omitBreaker?: boolean
      hideFamilyLabel?: boolean
      allowEmptyFamily?: boolean
      bindingIds?: string[]
    }
  ): boolean {
    const requestedX = Math.round(anchorX / GRID_SIZE) * GRID_SIZE
    const includedBindings = options.bindingIds?.length ? new Set(options.bindingIds) : null
    const familyComponents = options.autoIncludeFamily
      ? this.#groundplanComponentsForFamily(options.family).filter(
          (component) => !includedBindings || includedBindings.has(component.bindingId)
        )
      : []
    if (options.allowEmptyFamily && familyComponents.length === 0) {
      familyComponents.push({
        bindingId: options.family,
        kind: 'empty',
        breakerCurrentA: options.amps,
        cableSectionMm2: options.cableSectionMm2 ?? 2.5,
        poles: options.poles ?? 2,
        breakerCurve: options.breakerCurve ?? 'C'
      })
    }
    const result = buildKamrailCircuitBundle({
      rail,
      anchorX: requestedX,
      options,
      familyComponents,
      minimumRowY: this.#safeAreaRect().y,
      nextShapeId,
      oneWireComponentSymbol: (kind) => this.#oneWireComponentSymbol(kind),
      oneWireSymbolScale: (path, kind) => this.#oneWireSymbolScale(path, kind),
      symbolContentBounds,
      branchStroke: ONEWIRE_BRANCH_STROKE
    })

    if (!result) return false
    const horizontalPoints = (shapes: readonly Shape[]): number[] =>
      shapes.flatMap((shape) => {
        if (shape.hidden) return []
        const bounds = oneWireLayoutBounds(shape)
        return [bounds.x, bounds.x + bounds.width]
      })
    const bundledShapes = result.shapes.map((shape): Shape => ({ ...shape, oneWireRailId: rail.id }))
    const newPoints = horizontalPoints(bundledShapes)
    const railFamilies = new Set(
      this.#document.shapes.flatMap((shape) => {
        if (shape.kind !== 'symbol' || shape.sourceLink?.role !== 'breaker') return []
        const terminal = oneWireSymbolTerminalInfo(shape.path, shape.scale)?.bottom
        const terminalY = shape.position.y + (terminal?.y ?? 0)
        const family = this.#normalizeBindingFamily(shape.bindingId ?? '')
        return family && Math.abs(terminalY - rail.start.y) <= (rail.strokeWidth ?? KAMRAIL_STROKE_WIDTH)
          ? [family]
          : []
      })
    )
    const occupiedPoints = horizontalPoints(
      this.#document.shapes.filter((shape) => {
        if (!shape.groupId?.startsWith('onewire-') || this.#isKamrailShape(shape)) return false
        if (shape.oneWireRailId) return shape.oneWireRailId === rail.id
        const family = this.#normalizeBindingFamily(shape.bindingId ?? '')
        return Boolean(family && railFamilies.has(family))
      })
    )
    const dx =
      occupiedPoints.length && newPoints.length
        ? this.#oneWireController.appendFamilyOffset(Math.min(...newPoints), Math.max(...occupiedPoints))
        : 0
    const placedShapes = dx ? bundledShapes.map((shape) => translateShape(shape, dx, 0)) : bundledShapes
    this.#document.shapes.push(...placedShapes)
    this.#resizeOneWireRailsToBreakers(rail.id)
    this.#document.selectedId = result.selectedId
    this.#document.selectedIds = new Set(result.createdIds)
    this.#oneWireBindingId = this.#nextOneWireBindingId()
    return true
  }

  #oneWireFamilyRequiredWidth(family: string): number {
    const familyComponents = this.#groundplanComponentsForFamily(family)
    const rows = new Map<string, typeof familyComponents>()
    for (const component of familyComponents) {
      const row = rows.get(component.bindingId)
      if (row) row.push(component)
      else rows.set(component.bindingId, [component])
    }
    let widestRow = 180
    for (const components of rows.values()) {
      let rowWidth = 84
      for (const component of components) {
        if (component.kind === 'empty') continue
        const fallback = this.#oneWireComponentSymbol(component.kind)
        const path = component.sourcePath ?? fallback.path
        const name = component.sourceName ?? fallback.name
        const scale = this.#oneWireSymbolScale(path, component.kind)
        const bounds = symbolContentBounds({
          id: 'measure',
          kind: 'symbol',
          position: { x: 0, y: 0 },
          name,
          path,
          scale
        })
        rowWidth += bounds.width + 20
      }
      widestRow = Math.max(widestRow, rowWidth)
    }
    return widestRow + 40
  }

  #nearestKamrail(point: Point): { rail: LineShape; point: Point } | null {
    const SNAP_RADIUS = 72
    let best: { rail: LineShape; point: Point } | null = null
    let bestDistance = SNAP_RADIUS

    for (const shape of this.#document.shapes) {
      if (shape.kind !== 'line') continue
      if (!this.#isKamrailShape(shape)) continue
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

    this.#document.shapes.push(rail)
    this.#document.selectedId = rail.id
    this.#document.selectedIds = new Set([rail.id])
    return true
  }

  #composeOneWireOnKamrailAt(point: Point): boolean {
    if (this.#oneWireComposeKind === 'kamrail') return false
    const railAnchor = this.#nearestKamrail(point)
    if (!railAnchor) return false

    // Keep room for another breaker/device at either end of a manually drawn
    // busbar. Extend the existing rail before placing a component when the
    // snapped point is too close to an endpoint.
    const rail = railAnchor.rail
    const minX = Math.min(rail.start.x, rail.end.x)
    const maxX = Math.max(rail.start.x, rail.end.x)
    const edgeClearance = 64
    const extension = 160
    if (railAnchor.point.x - minX < edgeClearance) {
      rail.start = { ...rail.start, x: Math.max(0, minX - extension) }
    } else if (maxX - railAnchor.point.x < edgeClearance) {
      rail.end = { ...rail.end, x: Math.min(this.#worldWidth, maxX + extension) }
    }

    const component = this.#oneWireComponentSymbol(this.#oneWireComposeKind)
    const scale = this.#oneWireSymbolScale(component.path, this.#oneWireComposeKind)
    const placeBelowRail = false
    const rotation = oneWireSymbolRotationFor(component.path)
    const node = oneWireSymbolNodeInfo(component.path, scale, rotation)
    const breakerTerminal =
      this.#oneWireComposeKind === 'breaker' ? oneWireSymbolTerminalInfo(component.path, scale)?.bottom : undefined
    const attachmentOffset = breakerTerminal ?? node?.offset
    const targetNode: Point = {
      x: railAnchor.point.x,
      y: railAnchor.point.y + (placeBelowRail ? KAMRAIL_ATTACH_OFFSET : -KAMRAIL_ATTACH_OFFSET)
    }

    const bindingId = this.#oneWireBindingId
    const groupId = `onewire-${nextShapeId()}`

    const symbol: SymbolShape = {
      id: nextShapeId(),
      kind: 'symbol',
      position: attachmentOffset
        ? { x: targetNode.x - attachmentOffset.x, y: targetNode.y - attachmentOffset.y }
        : targetNode,
      name: component.name,
      path: component.path,
      scale,
      bindingId,
      groupId,
      oneWireRailId: rail.id
    }
    if (typeof rotation === 'number') symbol.rotation = rotation
    symbol.sourceLink = { kind: 'circuit', id: bindingId, role: this.#oneWireComposeKind }
    const contentBounds = symbolContentBounds(symbol)

    const cutHalfWidth = node?.cutHalfWidth
    const connectorEndY = breakerTerminal
      ? targetNode.y
      : placeBelowRail
        ? cutHalfWidth === null
          ? targetNode.y
          : targetNode.y - (cutHalfWidth ?? 0)
        : cutHalfWidth === null
          ? targetNode.y
          : targetNode.y + (cutHalfWidth ?? 0)
    const connector: LineShape = {
      id: nextShapeId(),
      kind: 'line',
      start: {
        x: targetNode.x,
        y: railAnchor.point.y + ((placeBelowRail ? 1 : -1) * (rail.strokeWidth ?? KAMRAIL_STROKE_WIDTH)) / 2
      },
      end: { x: targetNode.x, y: connectorEndY },
      stroke: ONEWIRE_BRANCH_STROKE,
      strokeWidth: ONE_WIRE_CONDUCTOR_STROKE_WIDTH,
      bindingId,
      groupId,
      oneWireRailId: rail.id,
      sourceLink: { kind: 'circuit', id: bindingId, role: 'connector' }
    }

    const labelText = bindingId
    const label: TextShape = {
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
      groupId,
      oneWireRailId: rail.id,
      sourceLink: { kind: 'circuit', id: bindingId, role: 'label' }
    }

    this.#document.shapes.push(connector, symbol, label)
    this.#document.selectedId = symbol.id
    this.#document.selectedIds = new Set([connector.id, symbol.id, label.id])
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
    const hostAnchors = this.#symbolConnectionAnchors(anchor.hostSymbol)
    const hasFixedTerminals = Boolean(oneWireSymbolTerminalInfo(anchor.hostSymbol.path, anchor.hostSymbol.scale))
    const attachAnchor = hasFixedTerminals ? null : hostAnchors.find((a) => a.side === side) ?? hostAnchors[0]
    const attachPoint = attachAnchor?.point ?? anchor.point
    const bindingId = anchor.hostSymbol.bindingId ?? this.#oneWireBindingId
    const groupId = anchor.hostSymbol.groupId ?? `onewire-${nextShapeId()}`
    const placed = positionOneWireSymbolForConnection({
      id: nextShapeId(),
      kind: 'symbol',
      position: { x: 0, y: 0 },
      name: component.name,
      path: component.path,
      scale,
      rotation: oneWireSymbolRotationFor(component.path),
      strokeWidth: oneWireSymbolStrokeWidthFor(component.path, scale),
      bindingId,
      groupId,
      oneWireRailId: anchor.hostSymbol.oneWireRailId,
      sourceLink: { kind: 'circuit', id: bindingId, role: this.#oneWireComposeKind }
    }, attachPoint, side, anchor.hostSymbol)
    const newSymbol = placed.symbol
    const connectorEnd = placed.connection
    const connector: LineShape = {
      id: nextShapeId(),
      kind: 'line',
      start: attachPoint,
      end: connectorEnd,
      stroke: '#000000',
      strokeWidth: ONE_WIRE_CONDUCTOR_STROKE_WIDTH,
      bindingId,
      groupId,
      oneWireRailId: anchor.hostSymbol.oneWireRailId
    }

    this.#document.shapes.push(connector, newSymbol)
    this.#document.selectedId = newSymbol.id
    this.#document.selectedIds = new Set([connector.id, newSymbol.id])
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
    for (const shape of this.#document.shapes) {
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
    const index = this.#document.shapes.findIndex((item) => item?.id === shape.id)
    if (index < 0) return
    this.#document.shapes[index] = shape
  }

  #setShapes(shapes: Shape[]) {
    if (!shapes.length) return
    const updates = new Map(shapes.map((shape) => [shape.id, shape]))
    this.#document.shapes = this.#document.shapes.map((shape) => updates.get(shape.id) ?? shape)
  }

  #shapeTemplate(shape: Shape, selected: boolean, extraClass = '') {
    return shapeTemplate(shape, selected, extraClass, this.#symbolStrokeWidth)
  }

  #bindingLabelsTemplate() {
    return bindingLabelsTemplate(this.#document.shapes)
  }

  #selectedOutlineTemplate(selection: Shape | readonly Shape[] | null) {
    return selectedOutlineTemplate(selection)
  }

  #safeAreaTemplate() {
    return safeAreaTemplate(this.#safeAreaRect())
  }

  #circuitGroupForShape(shape: Shape): CircuitGroup | null {
    const analysis = this.analyzeBindings()
    if (shape.sourceLink?.kind === 'device') {
      return (
        analysis.groups.find((group) => group.components.some((item) => item.shapeId === shape.sourceLink?.id)) ?? null
      )
    }
    if (shape.sourceLink?.kind === 'circuit') {
      return analysis.groups.find((group) => group.bindingId === shape.sourceLink?.id) ?? null
    }
    const binding = shape.bindingId?.trim().toUpperCase()
    if (binding) {
      const exact = analysis.groups.find((group) => group.bindingId === binding)
      if (exact) return exact
      const familyMatches = analysis.groups.filter((group) => group.family === binding)
      if (familyMatches.length === 1) return familyMatches[0]
    }
    if (shape.sourceLink?.kind === 'board') {
      const familyMatches = analysis.groups.filter((group) => group.family === shape.sourceLink?.id)
      if (familyMatches.length) return familyMatches[0]
    }
    return null
  }

  async #updateCircuitProperties(
    bindingId: string,
    update: CircuitPropertyUpdate,
    updateOneWirePresentation = true
  ): Promise<void> {
    if (!this.#projectKey || !this.#project) return
    const result = updateCircuitSpecifications(this.#project.circuitSpecifications, bindingId, update)
    if (!result) return
    const { circuitKey, circuitSpecifications } = result
    this.#project.circuitSpecifications = circuitSpecifications
    cadleShell.project = this.#project
    const currentPageType = this.#pageKey ? this.#project.pages[this.#pageKey]?.pageType : undefined
    // Update the visible drawing synchronously. Storage can finish afterward;
    // object-pane input must never wait on IndexedDB before repainting labels.
    const presentationChanged =
      currentPageType === 'onewire' && updateOneWirePresentation
        ? this.#updateOneWireCircuitPresentation(circuitKey, false)
        : false
    const projectKey = this.#projectKey
    const project = structuredClone(this.#project)
    await this.#persistence.enqueue(() => setProjectData(projectKey, project))
    if (presentationChanged) this.#persist()
  }

  #updateOneWireCircuitPresentation(circuitKey: string, persist = true): boolean {
    const groups = this.analyzeBindings().groups.filter((group) => group.family === circuitKey)
    const result = applyOneWireCircuitPresentation({
      shapes: this.#document.shapes,
      circuitKey,
      stored: this.#project?.circuitSpecifications?.[circuitKey],
      groupSpecification: groups[0]?.specification,
      profile: this.#project?.electricalProfile
    })
    if (!result.changed) return false
    this.#document.shapes = result.shapes
    this.#pushHistory(persist)
    this.#render()
    return true
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
    if (this.#document.selectedId === PROJECT_LOGO_SHAPE_ID && isProjectLogoVisible(this.#project)) {
      const logoBounds = getProjectLogoBounds(this.#project)
      const logoScaleRaw =
        typeof this.#project?.logoScale === 'number' && Number.isFinite(this.#project.logoScale)
          ? this.#project.logoScale
          : 1
      const logoColor = this.#project?.logoColor?.trim() ?? ''
      pubsub.publish('editor.selection.changed', {
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
    const selectedShapes = this.#selectedShapeIds()
      .map((id) => this.#shapeById(id))
      .filter((shape): shape is Shape => Boolean(shape))
    const canConvertToRoom =
      !groupedSelection && selectedShapes.length >= 3 && selectedShapes.every((shape) => shape.kind === 'wall')
    const circuitGroup = selectedShape ? this.#circuitGroupForShape(selectedShape) : null
    const isProtectionText =
      selectedShape?.kind === 'symbol' &&
      /automaat|breaker|protection devices/i.test(`${selectedShape.name} ${selectedShape.path}`)
    const isTopologyProtection = Boolean(
      isProtectionText && /^board:main:topology:v\d+:/.test(selectedShape?.generationKey ?? '')
    )
    const currentPageType = this.#pageKey ? this.#project?.pages?.[this.#pageKey]?.pageType : undefined
    const circuitPropertiesEditable = currentPageType === 'onewire' && Boolean(isProtectionText)
    const effectiveElectrical =
      selectedShape?.kind === 'symbol' && circuitPropertiesEditable
        ? isTopologyProtection
          ? (selectedShape.electrical ??
            electricalMetadataFromCatalog(undefined, selectedShape.name, selectedShape.path))
          : circuitGroup
            ? effectiveCircuitElectrical(selectedShape, circuitGroup)
            : effectiveStandaloneCircuitElectrical(
                selectedShape,
                this.#project?.circuitSpecifications,
                this.#project?.electricalProfile
              )
        : undefined
    pubsub.publish('editor.selection.changed', {
      ...createNativeSelectionChangedPayload(selectedShape, groupedSelection ? 1 : this.#document.selectedIds.size, {
        kindOverride: groupedSelection ? 'group' : undefined,
        bindingIdOverride: groupedSelection
          ? this.#selectedGroupBindingId()
          : (circuitGroup?.bindingId ?? (selectedShape ? (circuitKeyForShape(selectedShape) ?? undefined) : undefined)),
        electricalOverride: effectiveElectrical,
        circuitPropertiesEditable,
        hideSymbolTextFields: Boolean(isProtectionText),
        canConvertToRoom
      }),
      pageKey: this.#pageKey
    })
  }

  #nativeDocumentState(): NativeDocumentState {
    const pageType = this.#pageKey ? this.#project?.pages?.[this.#pageKey]?.pageType : undefined
    return {
      version: 2,
      paperLayoutVersion: 1,
      ...(pageType === 'onewire' ? { oneWireLayoutVersion: this.#oneWireController.layoutVersion } : {}),
      shapes: this.#document.shapes,
      selectedId: null,
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

  #exportViewBox(orientation: 'portrait' | 'landscape') {
    // Export the sheet, independent of the number or extent of its shapes.
    const landscape = this.#worldWidth >= this.#worldHeight
    if (landscape === (orientation === 'landscape')) {
      return { x: 0, y: 0, width: this.#worldWidth, height: this.#worldHeight }
    }
    const ratio = orientation === 'landscape' ? 297 / 210 : 210 / 297
    const width = Math.max(this.#worldWidth, this.#worldHeight * ratio)
    const height = Math.max(this.#worldHeight, this.#worldWidth / ratio)
    return { x: (this.#worldWidth - width) / 2, y: (this.#worldHeight - height) / 2, width, height }
  }

  #buildSvgDocument(
    viewBox?: { x: number; y: number; width: number; height: number },
    monochrome = false,
    pageName?: string,
    pageKey?: string
  ) {
    const buildDocument = buildSvgDocument as unknown as (options: Record<string, unknown>) => string
    const exportOptions: Record<string, unknown> = {
      shapes: this.#document.shapes,
      selectedShape: this.#shapeById(this.#document.selectedId),
      paper: this.#paperMeta(),
      worldWidth: this.#worldWidth,
      worldHeight: this.#worldHeight,
      project: this.#project,
      printMargin: this.#printMargin,
      viewBox,
      symbolStrokeWidth: this.#symbolStrokeWidth,
      monochrome,
      pageName,
      pageKey
    }

    return buildDocument(exportOptions)
  }

  #nativeStateForPage(pageKey: UUID): Partial<NativeDocumentState> | null {
    return this.#project ? nativeStateForProjectPage(this.#project, pageKey) : null
  }

  #projectTitleBlockTemplate() {
    if (!this.#project) return nothing
    return unsafeSVG(
      buildProjectTitleBlockMarkup(
        this.#project,
        this.#project?.pages?.[this.#pageKey ?? '']?.name ?? '',
        this.#worldWidth,
        this.#worldHeight,
        this.#pageKey ?? '',
        1,
        0,
        0,
        this.#printMargin
      )
    )
  }

  async #ensureSymbolMarkupReady() {
    const symbolPaths = new Set<string>()
    for (const shape of this.#document.shapes) {
      if (shape.kind === 'symbol') symbolPaths.add(shape.path)
    }
    if (this.#pendingCatalogSymbol?.path) symbolPaths.add(this.#pendingCatalogSymbol.path)
    const projectLogoUrl = this.#project?.logoUrl?.trim() ?? ''
    if (projectLogoUrl && /^(data:image\/svg\+xml|.*\.svg(?:$|[?#]))/i.test(projectLogoUrl)) {
      symbolPaths.add(projectLogoUrl)
    }
    if (/^DIMAC(?:\s|$)/i.test(this.#project?.company?.trim() ?? '')) symbolPaths.add('assets/dimac.svg')
    if (!symbolPaths.size) return

    await Promise.all([...symbolPaths].map((path) => preloadSymbolSvg(path)))
  }

  #primeSymbolSvgCache() {
    const symbolPaths = new Set<string>()
    for (const shape of this.#document.shapes) {
      if (shape.kind === 'symbol') symbolPaths.add(shape.path)
    }
    if (this.#pendingCatalogSymbol?.path) symbolPaths.add(this.#pendingCatalogSymbol.path)
    const projectLogoUrl = this.#project?.logoUrl?.trim() ?? ''
    if (projectLogoUrl && /^(data:image\/svg\+xml|.*\.svg(?:$|[?#]))/i.test(projectLogoUrl)) {
      symbolPaths.add(projectLogoUrl)
    }
    if (/^DIMAC(?:\s|$)/i.test(this.#project?.company?.trim() ?? '')) symbolPaths.add('assets/dimac.svg')

    for (const path of symbolPaths) {
      if (getCachedSymbolSvg(path) || isSymbolSvgLoading(path)) continue
      void preloadSymbolSvg(path).then(() => this.#renderPreviewOnly())
    }
  }

  #safeAreaRect() {
    return safeAreaRect(this.#paperMeta(), this.#printMargin, this.#worldWidth, this.#worldHeight)
  }

  async #svgToPagePng(svgString: string, orientation: 'landscape' | 'portrait' = 'landscape'): Promise<string> {
    return rasterizePageSvgToPng(svgString, orientation, 'Unable to render intro page SVG')
  }

  async exportProjectPdf(filename = `cadle-${this.#paperPreset}.pdf`) {
    await this.#ensureSymbolMarkupReady()
    const { default: jsPDF } = await import('jspdf')
    const originalPageKey = this.#pageKey
    const originalState = this.#nativeDocumentState()
    const originalSelectedIds = new Set(this.#document.selectedIds)
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
    const originalSizeMigrated = this.#documentSizeMigrated
    const projectPages = Object.entries(this.#project?.pages ?? {}).sort(([, a], [, b]) => {
      const orderA = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER
      const orderB = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER
      return orderA - orderB || a.creationTime - b.creationTime
    })

    let pdf: jsPDFType | null = null
    let pageIndex = 0

    try {
      // ── Cover / intro page (AREI) ──────────────────────────────────────
      const introSvg = buildIntroPageSvg(this.#project)
      const introDataUrl = await this.#svgToPagePng(introSvg)
      pdf = new jsPDF({ format: 'a4', unit: 'px', orientation: 'landscape', compress: true })
      const introPw = pdf.internal.pageSize.getWidth()
      const introPh = pdf.internal.pageSize.getHeight()
      pdf.setFillColor(255, 255, 255)
      pdf.rect(0, 0, introPw, introPh, 'F')
      pdf.addImage(introDataUrl, 'PNG', 0, 0, introPw, introPh, 'intro-page', 'FAST')
      pageIndex = 1

      // ── Distribution-board circuit schedule ───────────────────────────
      const scheduleSvgs = buildCircuitScheduleSvgs(this.#project, this.analyzeBindings())
      for (const [scheduleIndex, scheduleSvg] of scheduleSvgs.entries()) {
        const scheduleDataUrl = await this.#svgToPagePng(scheduleSvg, 'portrait')
        pdf.addPage('a4', 'portrait')
        const scheduleWidth = pdf.internal.pageSize.getWidth()
        const scheduleHeight = pdf.internal.pageSize.getHeight()
        pdf.setFillColor(255, 255, 255)
        pdf.rect(0, 0, scheduleWidth, scheduleHeight, 'F')
        pdf.addImage(
          scheduleDataUrl,
          'PNG',
          0,
          0,
          scheduleWidth,
          scheduleHeight,
          `circuit-schedule-${scheduleIndex}`,
          'FAST'
        )
        pageIndex += 1
      }

      for (const [pageKey, page] of projectPages) {
        // The circuit overview is rendered from live project data above; its
        // project-page entry only stores navigation/order and must not become
        // an extra blank drawing page in the dossier.
        if (page.pageType === 'circuit-schedule') continue
        // For the currently active page use the captured in-memory state so unsaved
        // edits are included. For all other pages read from the stored project schema.
        const state =
          pageKey === (originalPageKey as string) ? originalState : this.#nativeStateForPage(pageKey as UUID)
        if (!state) continue

        this.#pageKey = pageKey as UUID
        this.#applyPersistedState(state)
        this.#document.selectedId = null
        this.#document.selectedIds = new Set()
        await this.#ensureSymbolMarkupReady()

        const exportViewBox = this.#exportViewBox(this.#worldWidth >= this.#worldHeight ? 'landscape' : 'portrait')
        const svgString = this.#buildSvgDocument(exportViewBox ?? undefined, false, page.name, pageKey)
        const orientation: 'landscape' | 'portrait' = this.#worldWidth >= this.#worldHeight ? 'landscape' : 'portrait'
        const dataUrl = await rasterizePageSvgToPng(svgString, orientation, `Failed to render page ${page.name}`)

        pdf.addPage(this.#paperPreset.startsWith('a3') ? 'a3' : 'a4', orientation)
        const pageWidth = pdf.internal.pageSize.getWidth()
        const pageHeight = pdf.internal.pageSize.getHeight()
        pdf.setFillColor(255, 255, 255)
        pdf.rect(0, 0, pageWidth, pageHeight, 'F')
        pdf.addImage(dataUrl, 'PNG', 0, 0, pageWidth, pageHeight, `page-${pageIndex}`, 'FAST')
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

      pdf.save(filename)
    } finally {
      this.#pageKey = originalPageKey
      this.#applyPersistedState(originalState)
      this.#document.selectedId = originalState.selectedId ?? null
      this.#document.selectedIds = originalSelectedIds
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
      this.#documentSizeMigrated = originalSizeMigrated
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

        if (Array.isArray(nativeShapes)) this.#applyPersistedState({ shapes: nativeShapes })
        else return
        this.#document.selectedId = null
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

  render() {
    const selectedShape = this.#shapeById(this.#document.selectedId)
    const { zoom, panX, panY } = this.#viewport.state
    const worldTransform = `translate(${panX} ${panY}) scale(${zoom})`
    const minorGrid = GRID_SIZE * 4 * zoom
    const majorGrid = GRID_SIZE * 20 * zoom
    const gridStyle =
      `left:${panX}px;top:${panY}px;width:${this.#worldWidth * zoom}px;height:${this.#worldHeight * zoom}px; ` +
      `background-position: 0 0; ` +
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
              shape-rendering="geometricPrecision"
              style="cursor: ${cursor}; --symbol-stroke-width: ${this
                .#symbolStrokeWidth}; shape-rendering: geometricPrecision; image-rendering: auto"
              @pointerdown=${this.#onPointerDown}
              @pointermove=${this.#onPointerMove}
              @pointerup=${this.#onPointerUp}
              @pointercancel=${this.#onPointerUp}
              @dblclick=${this.#onStageDoubleClick}
              @contextmenu=${this.#onStageContextMenu}>
              <defs>
                ${this.#wallMaskTemplate()}
                <clipPath id="page-clip">
                  <rect
                    width=${this.#worldWidth}
                    height=${this.#worldHeight}></rect>
                </clipPath>
              </defs>
              <g
                class="world"
                transform=${worldTransform}
                clip-path="url(#page-clip)">
                ${this.#committedTemplate(selectedShape)} ${this.#previewTemplate()}
              </g>
            </svg>
            <div
              class="zoom-controls"
              role="group"
              aria-label="Zoom controls">
              <button
                type="button"
                aria-label="Zoom out"
                title="Zoom out"
                @click=${this.#zoomOut}>
                <custom-icon icon="zoom_out"></custom-icon>
              </button>
              <output aria-label="Current zoom">${Math.round(zoom * 100)}%</output>
              <button
                type="button"
                aria-label="Zoom in"
                title="Zoom in"
                @click=${this.#zoomIn}>
                <custom-icon icon="zoom_in"></custom-icon>
              </button>
              <button
                type="button"
                aria-label="Fit page"
                title="Fit page"
                @click=${this.#fitViewport}>
                <custom-icon icon="zoom_in_map"></custom-icon>
              </button>
            </div>
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
    return hasWallOpeningMask(this.#document.shapes)
  }

  #wallMaskTemplate() {
    return wallMaskTemplate(this.#document.shapes, this.#worldWidth, this.#worldHeight)
  }

  #committedTemplate(selectedShape: Shape | null) {
    const wallShapes = this.#document.shapes.filter((shape) => shape.kind === 'wall')
    const openingShapes = this.#document.shapes.filter(
      (shape) => shape.kind === 'door' || shape.kind === 'window' || shape.kind === 'gate'
    )
    const symbolShapes = this.#document.shapes.filter((shape) => shape.kind === 'symbol')
    const restShapes = this.#document.shapes.filter(
      (shape) =>
        shape.kind !== 'wall' &&
        shape.kind !== 'door' &&
        shape.kind !== 'window' &&
        shape.kind !== 'gate' &&
        shape.kind !== 'symbol'
    )
    const wallMask = this.#hasWallOpenings() ? 'url(#wall-opening-mask)' : nothing
    const selectedGroupId = this.#selectedGroupId()
    const selectedGroupShapes = selectedGroupId
      ? this.#document.shapes.filter((shape) => shape.groupId === selectedGroupId)
      : null
    const selectedShapes =
      selectedGroupShapes ??
      this.#document.shapes.filter(
        (shape) => shape.id === this.#document.selectedId || this.#document.selectedIds.has(shape.id)
      )
    const isIndividuallySelected = (shape: Shape): boolean =>
      selectedGroupId === null && (shape.id === this.#document.selectedId || this.#document.selectedIds.has(shape.id))

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
          return this.#shapeTemplate(shape, isIndividuallySelected(shape))
        }

        return svg`
          <g class="shape-group" data-group-id=${entry.groupId}>
            ${repeat(
              entry.shapes,
              (shape) => shape.id,
              (shape) => this.#shapeTemplate(shape, isIndividuallySelected(shape))
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
      ${roomLabelsTemplate(this.#document.shapes)}
      ${this.#bindingLabelsTemplate()}
      ${this.#projectTitleBlockTemplate()}
      ${this.#selectedOutlineTemplate(selectedShapes.length ? selectedShapes : selectedShape)}
    `
  }

  #previewTemplate() {
    let symbolPreviewShape: SymbolShape | null = null
    if (this.#tools.current === 'symbol' && this.#pendingCatalogSymbol && this.#symbolPreviewPoint) {
      symbolPreviewShape = createSymbolShape('__symbol-preview__', this.#symbolPreviewPoint, this.#pendingCatalogSymbol)
      if (this.#symbolPlacement?.rotation) symbolPreviewShape.rotation = this.#symbolPlacement.rotation
    }
    return svg`
      ${
        this.#draft
          ? this.#tools.current === 'room' && this.#draft.kind === 'rect'
            ? roomDraftTemplate(this.#draft.start, this.#draft.end)
            : this.#shapeTemplate(this.#draft, false, 'draft')
          : nothing
      }
      ${symbolPreviewShape ? this.#shapeTemplate(symbolPreviewShape, false, 'symbol-preview') : nothing}
      ${this.#snapIndicatorTemplate()}
      ${this.#wallChainPreviewTemplate()}
      ${this.#draft ? this.#measurementTemplate(this.#draft.start, this.#draft.end) : nothing}
      ${this.#wallChain ? this.#measurementTemplate(this.#wallChain.startPoint, this.#chainPreviewEnd) : nothing}
      ${this.#rubberBandTemplate()}
    `
  }

  #render() {
    this.#publishNativeSelection(this.#shapeById(this.#document.selectedId))
    this.#publishNativeControlsState()
    this.#primeSymbolSvgCache()
    this.requestRender()
  }

  #publishNativeControlsState() {
    pubsub.publish('editor.controls.state', {
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

  #nextOneWireBindingId(): string {
    return nextOneWireBindingId(this.#oneWireBindingId, this.#oneWirePreset)
  }

  #advanceOneWireBinding() {
    this.#oneWireBindingId = this.#nextOneWireBindingId()
    this.#render()
  }

  #onNativeControlsCommand = (payload: {
    paper?: PaperPreset
    onewirePreset?: OneWirePreset
    onewireCompose?: 'breaker' | 'switch' | 'kamrail' | 'load'
    action?: string
  }) => {
    const paperPreset = payload.paper
    if (paperPreset && paperPreset in PAPER_PRESETS) {
      const previousWidth = this.#worldWidth
      const previousHeight = this.#worldHeight
      const target = paperWorldSize(paperPreset)
      const offsetX = (target.width - previousWidth) / 2
      const offsetY = (target.height - previousHeight) / 2
      this.#document.shapes = scaleShapesBetweenPages(this.#document.shapes, 1, offsetX, offsetY)
      this.#paperPreset = paperPreset
      this.#worldWidth = target.width
      this.#worldHeight = target.height
      this.#autoCenterView()
      this.#persist()
      this.#render()
      return
    }

    const preset = payload.onewirePreset
    if (preset && preset in ONE_WIRE_PRESETS) {
      this.#oneWirePreset = preset
      this.#oneWireMode = 'preset'
      if (this.#tools.current !== 'onewire') this.#activateTool('onewire')
      else this.#render()
      return
    }

    const compose = payload.onewireCompose
    if (compose === 'breaker' || compose === 'switch' || compose === 'kamrail' || compose === 'load') {
      this.#oneWireMode = 'compose'
      this.#oneWireComposeKind = compose
      if (this.#tools.current !== 'onewire') this.#activateTool('onewire')
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
        this.#printMargin = Math.max(this.#printMargin - 1, DEFAULT_PRINT_MARGIN_MM)
        this.#persist()
        this.#render()
        return
      case 'onewire-next':
        this.#advanceOneWireBinding()
        if (this.#tools.current !== 'onewire') this.#activateTool('onewire')
        return
      case 'onewire-reset-panel':
        this.#oneWireAnchor = null
        this.#oneWireLastPoint = null
        this.#oneWireBusBarId = null
        if (this.#tools.current !== 'onewire') this.#activateTool('onewire')
        else this.#render()
        return
      case 'onewire-realign':
        if (!this.#realignExistingOneWire()) window.alert('No one-wire elements to realign on this page.')
        return
      case 'focus-selection':
        this.#focusSelection()
        return
      case 'export-json':
        this.#download('cadle-drawing.json', this.#serialize(), 'application/json;charset=utf-8')
        return
      case 'export-pdf':
        void globalThis.cadleShell.exportProjectPdf().catch(() => window.alert('Unable to export PDF'))
        return
      case 'print-svg':
        void this.#printSvg().catch(() => window.alert('Unable to print SVG'))
        return
      case 'import-json':
        this.shadowRoot?.querySelector<HTMLInputElement>('.file-input')?.click()
        return
      case 'clear':
        if (!window.confirm('Clear the drawing?')) return
        this.#document.shapes = []
        this.#document.selectedId = null
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

  #onPointerDown = async (event: PointerEvent) => {
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
          panX: this.#viewport.state.panX,
          panY: this.#viewport.state.panY
        }
        this.#stagePointerId = event.pointerId
        ;(stage as SVGSVGElement).setPointerCapture(event.pointerId)
      }
      return
    }

    const rawPoint = this.#pointFromEvent(event)
    if (!rawPoint) return

    if (this.#tools.current === 'wall') {
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
        this.#document.shapes.push(wallResult.committedWall)
        this.#document.selectedId = wallResult.committedWall.id
        this.#pushHistory()
      }
      this.#render()
      return
    }

    const shapeElement = event.target instanceof Element ? event.target.closest<SVGElement>('[data-shape-id]') : null
    let shapeId = shapeElement?.dataset.shapeId ?? null
    shapeId ??= this.#shapeIdAtPoint(rawPoint)
    const canSelectExistingShape = allowsExistingShapeSelection(
      this.#tools.current,
      Boolean(this.#pendingCatalogSymbol)
    )

    const labelElement = event.target instanceof Element ? event.target.closest<SVGGElement>('.binding-label') : null
    if (canSelectExistingShape && labelElement && event.button === 0 && shapeId) {
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
        this.#document.selectedId = shapeId
        this.#document.selectedIds = this.#expandSelectionWithGroup(shapeId)
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

    if (shapeId && isAdditiveSelection && canSelectExistingShape) {
      const expanded = this.#expandSelectionWithGroup(shapeId)
      const next = new Set(
        this.#document.selectedIds.size
          ? this.#document.selectedIds
          : this.#document.selectedId
            ? [this.#document.selectedId]
            : []
      )
      const shouldRemove = [...expanded].every((id) => next.has(id))

      if (shouldRemove) {
        for (const id of expanded) next.delete(id)
      } else {
        for (const id of expanded) next.add(id)
      }

      this.#document.selectedIds = next
      this.#document.selectedId = next.values().next().value ?? null
      this.#drag = null
      this.#bandStart = null
      this.#bandEnd = null
      this.#stagePointerId = null
      this.#render()
      return
    }

    if (shapeId && event.button === 0 && canSelectExistingShape) {
      if (shapeId === PROJECT_LOGO_SHAPE_ID && isProjectLogoVisible(this.#project)) {
        this.#document.selectedIds = new Set([PROJECT_LOGO_SHAPE_ID])
        this.#document.selectedId = PROJECT_LOGO_SHAPE_ID
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
      this.#document.selectedIds = expanded
      this.#document.selectedId = shapeId
      const dragIds = dragIdsForSelectedShape(this.#document.shapes, shapeId, expanded)
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

    if (this.#tools.current === 'text') {
      const values = await globalThis.cadleShell.requestInput({
        title: 'Add text',
        submitLabel: 'Place text',
        fields: [{ name: 'text', label: 'Text', value: 'Label', required: true }]
      })
      const value = values?.text
      if (!value) return
      this.#document.shapes.push(createTextShape(nextShapeId(), rawPoint, value))
      this.#document.selectedId = this.#document.shapes[this.#document.shapes.length - 1]?.id ?? null
      this.#pushHistory()
      this.#render()
      return
    }

    if (this.#tools.current === 'symbol' && event.button === 0 && this.#pendingCatalogSymbol) {
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

    if (this.#tools.current === 'onewire') {
      if (event.button !== 0) return

      const clickedShape = shapeId ? this.#shapeById(shapeId) : null
      const clickedShapeIsKamrail = this.#isKamrailShape(clickedShape)
      if (shapeId && shouldSelectExistingOneWireShape(clickedShape, clickedShapeIsKamrail)) {
        if (
          this.#oneWireMode === 'compose' &&
          (this.#oneWireComposeKind === 'switch' || this.#oneWireComposeKind === 'load') &&
          clickedShape?.kind === 'symbol' &&
          this.#isElectricalSymbolPath(clickedShape.path)
        ) {
          const anchors = this.#symbolConnectionAnchors(clickedShape)
          const preferredSide = clickedShape.sourceLink?.role === 'breaker' ? 'top' : 'right'
          const anchor = anchors.find((candidate) => candidate.side === preferredSide)
          const extensionPoint = anchor
            ? {
                x: anchor.point.x + (preferredSide === 'right' ? 1 : 0),
                y: anchor.point.y - (preferredSide === 'top' ? 1 : 0)
              }
            : null
          if (extensionPoint && this.#composeOneWireAt(extensionPoint, true)) {
            this.#pushHistory()
            this.#render()
            return
          }
        }

        const expanded = this.#expandSelectionWithGroup(shapeId)
        this.#document.selectedIds = expanded
        this.#document.selectedId = shapeId
        const dragIds = dragIdsForSelectedShape(this.#document.shapes, shapeId, expanded)
        const initial = dragIds
          .map((id) => this.#shapeById(id))
          .filter((shape): shape is Shape => Boolean(shape))
          .map((shape) => cloneShape(shape))
        this.#drag = { ids: dragIds, pointerStart: rawPoint, initial }
        this.#bandStart = null
        this.#bandEnd = null
        this.#stagePointerId = event.pointerId
        stage.setPointerCapture(event.pointerId)
        this.#render()
        return
      }
      const clickedKamrail = this.#isKamrailShape(clickedShape)
        ? clickedShape
        : (this.#nearestKamrail(rawPoint)?.rail ?? null)
      if (clickedKamrail) {
        if (this.#oneWireComposeKind === 'kamrail') return
        const followUpKind = this.#oneWireComposeKind === 'breaker' ? null : this.#oneWireComposeKind

        const defaultFamily = this.#normalizeBindingFamily(this.#oneWireBindingId) ?? 'A'
        const values = await globalThis.cadleShell.requestInput({
          title: followUpKind ? 'Add breaker first' : 'Add breaker',
          description: followUpKind
            ? `A ${followUpKind === 'switch' ? 'switch' : 'load'} must be connected after a breaker. Add the breaker here and Cadle will connect the selected component automatically.`
            : 'Use a circuit family such as A, B or C. Leave it blank for an unlabelled breaker.',
          submitLabel: 'Add breaker',
          fields: [{ name: 'family', label: 'Circuit family', value: defaultFamily, placeholder: 'A' }]
        })
        const familyInput = values?.family
        if (familyInput === undefined) return
        const hideFamilyLabel = familyInput.trim() === ''
        const family = hideFamilyLabel ? this.#nextUnlabeledBreakerKey() : this.#normalizeBindingFamily(familyInput)
        if (!family) return

        const familyGroups = hideFamilyLabel
          ? []
          : this.analyzeBindings().groups.filter((group) => group.family === family)
        const primarySpecification = familyGroups[0]?.specification
        const amps = familyGroups.length
          ? Math.max(...familyGroups.map((group) => group.specification.breakerCurrentA))
          : 20
        const cableSectionMm2 = familyGroups.length
          ? Math.max(...familyGroups.map((group) => group.specification.cableSectionMm2))
          : 2.5
        const cableConductors = familyGroups.length
          ? Math.max(...familyGroups.map((group) => group.specification.cableConductors))
          : 3
        const hasProtectiveConductor =
          primarySpecification?.hasProtectiveConductor ?? defaultHasProtectiveConductor(cableConductors)
        const poles = familyGroups.length
          ? Math.max(...familyGroups.map((group) => group.specification.poles))
          : (this.#project?.electricalProfile?.defaultPoles ?? 2)
        const phaseConfiguration = familyGroups.some(
          (group) =>
            group.specification.phaseConfiguration === 'three-phase' ||
            group.specification.phaseConfiguration === 'L1+L2+L3+N'
        )
          ? 'L1+L2+L3+N'
          : (primarySpecification?.phaseConfiguration ?? this.#project?.electricalProfile?.phaseConfiguration ?? 'L1+N')
        const showPhaseLabel = primarySpecification?.showPhaseLabel ?? true
        const showCableInstallation = primarySpecification?.showCableInstallation ?? true

        const created = this.#addKamrailCircuitBundle(clickedKamrail, rawPoint.x, {
          amps,
          cableSectionMm2,
          cableConductors,
          hasProtectiveConductor,
          cableType: primarySpecification?.cableType ?? 'VOB',
          cableInstallation: primarySpecification?.cableInstallation ?? 'conduit-recessed',
          showCableInstallation,
          breakerCurve: primarySpecification?.breakerCurve ?? 'C',
          poles,
          phaseConfiguration,
          showPhaseLabel,
          family,
          autoIncludeFamily: followUpKind ? false : !hideFamilyLabel,
          hideFamilyLabel,
          allowEmptyFamily: Boolean(followUpKind) || hideFamilyLabel || familyGroups.length === 0
        })
        if (created) {
          if (followUpKind) {
            const breaker = this.#shapeById(this.#document.selectedId)
            if (breaker?.kind === 'symbol') {
              const topAnchor = this.#symbolConnectionAnchors(breaker).find((anchor) => anchor.side === 'top')
              if (topAnchor) this.#composeOneWireAt({ x: topAnchor.point.x, y: topAnchor.point.y - 1 }, true)
            }
          }
          for (const circuitKey of Object.keys(this.#project?.circuitSpecifications ?? {})) {
            this.#updateOneWireCircuitPresentation(circuitKey, false)
          }
          this.#pushHistory()
          this.#render()
        }
        return
      }

      const electricalPoint = this.#snapToElectricalPoints(this.#snapPoint(rawPoint)).point
      if (!clickedShape && this.#oneWireMode === 'preset' && this.#createKamrailAt(electricalPoint)) {
        this.#pushHistory()
        this.#render()
        return
      }
      if (this.#oneWireComposeKind === 'kamrail' && this.#createKamrailAt(electricalPoint)) {
        for (const circuitKey of Object.keys(this.#project?.circuitSpecifications ?? {})) {
          this.#updateOneWireCircuitPresentation(circuitKey, false)
        }
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

      this.#document.shapes.push(...onewire.shapes)
      this.#document.selectedId = onewire.selectedId
      this.#document.selectedIds = onewire.selectedIds
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
          this.#document.shapes.push({ id: busBarId, kind: 'line', start: busStart, end: busEnd } as LineShape)
        }
      }

      this.#pushHistory()
      this.#render()
      return
    }

    if (canSelectExistingShape) {
      const selectResult = resolveSelectPointerDownState({
        shapeId,
        rawPoint,
        selectedIds: this.#document.selectedIds,
        selectedId: this.#document.selectedId,
        shapes: this.#document.shapes,
        pointerId: event.pointerId
      })
      if (shapeId) {
        const expanded = this.#expandSelectionWithGroup(shapeId)
        this.#document.selectedIds = expanded
        this.#document.selectedId = shapeId
        const dragIds = dragIdsForSelectedShape(this.#document.shapes, shapeId, expanded)
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
        this.#document.selectedIds = selectResult.selectedIds
        this.#document.selectedId = selectResult.selectedId
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
      this.#tools.current === 'line'
        ? this.#snapToElectricalPoints(gridSnapped).point
        : this.#tools.current === 'door' || this.#tools.current === 'window' || this.#tools.current === 'gate'
          ? this.#snapToEndpoints(gridSnapped).point
          : gridSnapped
    this.#draft = createDraftShape(nextShapeId(), point, this.#tools.current)
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
        this.#viewport.setPan(next.panX, next.panY)
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
      const movedShapes = applyDragMove(
        rawPoint,
        drag,
        (point) => this.#snapPoint(point),
        this.#document.shapes,
        this.#viewport.state.zoom
      )
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

    if (this.#tools.current === 'symbol' && this.#pendingCatalogSymbol) {
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
    if (this.#tools.current === 'wall' && this.#wallChain) {
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
    if (this.#tools.current === 'onewire') {
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
        this.#document.shapes.push(shape)
        this.#document.selectedId = shape.id
        this.#document.selectedIds = new Set([shape.id])
        this.#symbolPreviewPoint = placement.anchor
        this.#snapTarget = null
        this.#pushHistory()
        pubsub.publish('editor.symbol.placed', { shapeId: shape.id })
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
      this.#document.selectedIds = new Set(ids)
      this.#document.selectedId = ids[0] ?? null
      this.#bandStart = null
      this.#bandEnd = null
      this.#stagePointerId = null
      if (stage?.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId)
      this.#render()
      return
    }

    if (phase === 'draft' && this.#draft) {
      if (
        this.#tools.current === 'room' &&
        this.#draft.kind === 'rect' &&
        Math.abs(this.#draft.end.x - this.#draft.start.x) >= 2 &&
        Math.abs(this.#draft.end.y - this.#draft.start.y) >= 2
      ) {
        const walls = createRoomWalls(this.#draft.start, this.#draft.end, nextShapeId)
        this.#document.shapes.push(...walls)
        this.#document.selectedId = walls[0]?.id ?? null
        this.#document.selectedIds = new Set(walls.map((wall) => wall.id))
        this.#pushHistory()
      } else if (canCommitDraft(this.#draft) && this.#tools.current !== 'room') {
        const draftShape = cloneShape(this.#draft)
        const committedShape =
          draftShape.kind === 'door' || draftShape.kind === 'window' || draftShape.kind === 'gate'
            ? this.#bindOpeningToWall(draftShape)
            : draftShape
        this.#document.shapes.push(committedShape)
        this.#document.selectedId = committedShape.id
        this.#document.selectedIds = new Set([committedShape.id])
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

    if (isEscape(event) && this.#stageContextMenuOpen) {
      this.#hideStageContextMenu()
      return
    }

    if (isPanKeyDown(event) && !this.#spaceDown) {
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
