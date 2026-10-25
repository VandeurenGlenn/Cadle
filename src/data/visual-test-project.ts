import { projectDataStore, projectStore } from '../api/project.js'
import { ONE_WIRE_SOCKET_SYMBOL_PATH } from '../editor/constants.js'
import { buildKamrailCircuitBundle } from '../editor/layout/onewire-helpers.js'
import { ONE_WIRE_LAYOUT_VERSION } from '../editor/layout/onewire-layout-plan.js'
import { buildOneWireTopology } from '../editor/layout/onewire-topology.js'
import { oneWireSymbolScaleFor } from '../editor/layout/onewire-symbol-nodes.js'
import { inferSymbolScale } from '../editor/model/model.js'
import type { NativeDocumentState } from '../editor/model/document-state.js'
import type { LineShape, Shape, SymbolShape } from '../editor/model/types.js'
import type { OneWireTopologyPlan, Project, ProjectCircuitSpecification, UUID } from '../types.js'

export const VISUAL_TEST_PROJECT_KEY = '00000000-0000-4000-8000-000000000101' as UUID
export const VISUAL_TEST_GROUND_PAGE_KEY = '00000000-0000-4000-8000-000000000102' as UUID
export const VISUAL_TEST_ONEWIRE_PAGE_KEY = '00000000-0000-4000-8000-000000000103' as UUID
export const VISUAL_TEST_ONEWIRE_CIRCUITS_PAGE_KEY = '00000000-0000-4000-8000-000000000104' as UUID
export const VISUAL_TEST_ONEWIRE_CIRCUITS_ROW_2_PAGE_KEY = '00000000-0000-4000-8000-000000000105' as UUID
export const VISUAL_TEST_PROJECT_NAME = 'Cadle Visual Test'

const WORLD_WIDTH = 1600
const WORLD_HEIGHT = 1100
const PAGE_CREATED_AT = 1
const TOPOLOGY_BUS_Y = 610
const CIRCUIT_BUS_Y = 900
const BUS_STROKE_WIDTH = 4

const visualTestTopology: OneWireTopologyPlan = {
  version: 1,
  incomingCable: { conductors: 4, sectionMm2: 10, cableType: 'EXVB' },
  mainSwitch: { ratedCurrentA: 40, manufacturer: 'Schneider Electric', neutralPosition: 'left' },
  mainDifferential: {
    ratedCurrentA: 40,
    sensitivityMa: 300,
    manufacturer: 'Schneider Electric',
    neutralPosition: 'left'
  },
  residualBreaker: false,
  solar: false,
  consumers: true,
  additionalDifferentials: [
    {
      count: 1,
      railId: 'rail-1',
      ratedCurrentA: 40,
      sensitivityMa: 30,
      purpose: 'consumers',
      manufacturer: 'Schneider Electric',
      neutralPosition: 'left'
    },
    {
      count: 1,
      boardId: 'keuken',
      railId: 'rail-1',
      ratedCurrentA: 40,
      sensitivityMa: 30,
      purpose: 'consumers',
      manufacturer: 'Schneider Electric',
      neutralPosition: 'left'
    }
  ]
}

const device = (
  id: string,
  position: { x: number; y: number },
  name: string,
  path: string,
  bindingId: string,
  role: 'switch' | 'load',
  circuitType: 'lighting' | 'sockets',
  rotation?: number,
  scale = 1
): SymbolShape => ({
  id,
  kind: 'symbol',
  position,
  name,
  path,
  scale,
  ...(typeof rotation === 'number' ? { rotation } : {}),
  bindingId,
  electrical: {
    role,
    circuitType,
    oneWireEligible: true,
    manufacturer: 'Niko'
  }
})

const wall = (
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  roomName?: string
): LineShape => ({
  id,
  kind: 'wall',
  start,
  end,
  strokeWidth: 6,
  ...(roomName ? { roomName } : {})
})

const situationShapes = (): Shape[] => [
  wall('wall-outer-top', { x: 180, y: 160 }, { x: 1420, y: 160 }, 'Living room'),
  wall('wall-outer-right', { x: 1420, y: 160 }, { x: 1420, y: 900 }, 'Kitchen'),
  wall('wall-outer-bottom', { x: 1420, y: 900 }, { x: 180, y: 900 }, 'Kitchen'),
  wall('wall-outer-left', { x: 180, y: 900 }, { x: 180, y: 160 }, 'Living room'),
  wall('wall-divider', { x: 850, y: 160 }, { x: 850, y: 900 }),
  {
    id: 'room-living-label',
    kind: 'text',
    position: { x: 470, y: 520 },
    text: 'LIVING ROOM',
    scale: 1.1,
    textAnchor: 'middle'
  },
  {
    id: 'room-kitchen-label',
    kind: 'text',
    position: { x: 1130, y: 520 },
    text: 'KITCHEN',
    scale: 1.1,
    textAnchor: 'middle'
  },
  device(
    'device-a1-push',
    { x: 240, y: 320 },
    'Push button',
    'symbols/Switches/Push button.svg',
    'A1',
    'switch',
    'lighting',
    undefined,
    0.8
  ),
  device(
    'device-a1-light',
    { x: 500, y: 330 },
    'Lighting',
    'symbols/Consumption appliances/Lighting.svg',
    'A1',
    'load',
    'lighting'
  ),
  device(
    'device-a2-push',
    { x: 240, y: 610 },
    'Illuminated push button',
    'symbols/Switches/Illuminated push button.svg',
    'A2',
    'switch',
    'lighting',
    undefined,
    1.5
  ),
  device(
    'device-a2-wall-light',
    { x: 500, y: 610 },
    'Wall light',
    'symbols/Consumption appliances/Wall light.svg',
    'A2',
    'load',
    'lighting',
    undefined,
    1.5
  ),
  device(
    'device-a3-double-push',
    { x: 240, y: 780 },
    'Double push button',
    'symbols/Switches/Double push button.svg',
    'A3',
    'switch',
    'lighting',
    undefined,
    1.5
  ),
  device(
    'device-a3-fluorescent',
    { x: 600, y: 780 },
    'Fluorescent lamp',
    'symbols/Consumption appliances/Fluorescent lamp.svg',
    'A3',
    'load',
    'lighting',
    undefined,
    1.5
  ),
  device(
    'device-b1-outlet-1',
    { x: 930, y: 250 },
    'Wall outlet with grounding',
    'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg',
    'B1',
    'load',
    'sockets',
    90
  ),
  device(
    'device-b1-outlet-2',
    { x: 1120, y: 250 },
    'Wall outlet with grounding',
    'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg',
    'B1',
    'load',
    'sockets',
    90
  ),
  device(
    'device-b2-outlet',
    { x: 1350, y: 420 },
    'Wall outlet with safety shutter',
    'symbols/Socket outlets/Wall outlet with integrated safety shutter for floorplan.svg',
    'B2',
    'load',
    'sockets'
  ),
  device(
    'device-c1-switch',
    { x: 920, y: 690 },
    'Switch',
    'symbols/Switches/Switch general symbol.svg',
    'C1',
    'switch',
    'lighting',
    undefined,
    1.3
  ),
  device(
    'device-c1-spot',
    { x: 1160, y: 690 },
    'Spot',
    'symbols/Consumption appliances/Spot.svg',
    'C1',
    'load',
    'lighting'
  ),
  device(
    'device-c2-dimmer',
    { x: 920, y: 820 },
    'Dimmer switch',
    'symbols/Switches/Dimmer switch.svg',
    'C2',
    'switch',
    'lighting',
    undefined,
    1.3
  ),
  device(
    'device-c2-spot',
    { x: 1160, y: 820 },
    'Recessed spotlight',
    'symbols/Consumption appliances/Recessed spotlight.svg',
    'C2',
    'load',
    'lighting'
  ),
  device(
    'device-board',
    { x: 790, y: 860 },
    'Distribution board',
    'symbols/Electrical devices/Distribution board.svg',
    'ALSB',
    'load',
    'sockets',
    undefined,
    1.5
  )
]

const oneWireScale = (path: string, _kind: 'breaker' | 'switch' | 'kamrail' | 'load'): number => {
  return oneWireSymbolScaleFor(path) ?? inferSymbolScale(path)
}

const oneWireRail = (
  id: string,
  y: number,
  boardId = 'main',
  railId?: string,
  startX = 120,
  endX = 1480
): LineShape => ({
  id,
  kind: 'line',
  start: { x: startX, y },
  end: { x: endX, y },
  stroke: '#000000',
  strokeWidth: BUS_STROKE_WIDTH,
  generationKey: railId ? `board:${boardId}:rail:${railId}` : 'board:main:topology:bus',
  sourceLink: { kind: 'board', id: boardId, role: railId ? `rail:${boardId}:${railId}` : 'topology:bus' }
})

const oneWireTopologyShapes = (): Shape[] => {
  let id = 0
  const nextShapeId = () => `visual-onewire-${++id}`
  const rail = oneWireRail('visual-onewire-topology-bus', TOPOLOGY_BUS_Y)
  return [
    rail,
    ...buildOneWireTopology(visualTestTopology, rail, nextShapeId, {
      gridProtectionCurrentA: 40,
      defaultPoles: 2,
      phaseConfiguration: 'L1+N',
      protectionManufacturer: 'Schneider Electric'
    })
  ]
}

const oneWireCircuitShapes = (
  boardId: 'main' | 'keuken',
  railId: 'rail-1',
  includedFamilies: ReadonlySet<'A' | 'B' | 'C'>
): Shape[] => {
  let id = 0
  const nextShapeId = () => `visual-onewire-circuit-${++id}`
  const sourceShapes = situationShapes().filter((shape): shape is SymbolShape => shape.kind === 'symbol')
  const familyConfigurations: Array<{
    family: 'A' | 'B' | 'C'
    anchorX: number
    amps: number
    cableSectionMm2: number
    description: string
  }> = [
    { family: 'A', anchorX: 330, amps: 16, cableSectionMm2: 1.5, description: 'Verlichting leefruimte' },
    { family: 'B', anchorX: 800, amps: 20, cableSectionMm2: 2.5, description: 'Stopcontacten keuken' },
    { family: 'C', anchorX: 1270, amps: 16, cableSectionMm2: 1.5, description: 'Verlichting keuken' }
  ]
  const visibleConfigurations = familyConfigurations.filter(({ family }) => includedFamilies.has(family))
  const railWidth = Math.min(
    1360,
    Math.max(360, visibleConfigurations.length * 360 + (visibleConfigurations.length - 1) * 120)
  )
  const railStart = (1600 - railWidth) / 2
  const rail = oneWireRail(
    `visual-onewire-${boardId}-${railId}-bus`,
    CIRCUIT_BUS_Y,
    boardId,
    railId,
    railStart,
    railStart + railWidth
  )
  const shapes: Shape[] = [rail]
  for (const [configurationIndex, configuration] of visibleConfigurations.entries()) {
    const anchorX = railStart + (railWidth * (configurationIndex + 1)) / (visibleConfigurations.length + 1)
    const familyComponents = sourceShapes
      .filter((shape) => {
        const bindingId = shape.bindingId ?? ''
        return bindingId.startsWith(configuration.family) && /^\d+$/.test(bindingId.slice(configuration.family.length))
      })
      .map((shape) => ({
        bindingId: shape.bindingId ?? configuration.family,
        kind: shape.electrical?.role === 'switch' ? ('switch' as const) : ('load' as const),
        sourceShapeId: shape.id,
        sourcePath: shape.path,
        sourceName: shape.name
      }))
    const bundle = buildKamrailCircuitBundle({
      rail,
      anchorX,
      options: {
        amps: configuration.amps,
        cableSectionMm2: configuration.cableSectionMm2,
        cableConductors: 3,
        hasProtectiveConductor: true,
        cableType: 'VOB',
        cableInstallation: 'conduit-recessed',
        showCableInstallation: true,
        poles: 2,
        phaseConfiguration: 'L1+N',
        manufacturer: 'Schneider Electric',
        neutralPosition: 'left',
        showPhaseLabel: true,
        breakerCurve: 'C',
        family: configuration.family,
        autoIncludeFamily: true
      },
      familyComponents,
      nextShapeId,
      oneWireComponentSymbol: (kind) => {
        if (kind === 'breaker') return { name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }
        if (kind === 'switch') return { name: 'Switch', path: 'symbols/Switches/Switch general symbol.svg' }
        if (kind === 'kamrail') return { name: 'Kamrail', path: 'symbols/Protection devices/Kamrail.svg' }
        return { name: 'Socket outlet', path: ONE_WIRE_SOCKET_SYMBOL_PATH }
      },
      oneWireSymbolScale: oneWireScale,
      symbolContentBounds: (shape) => {
        const size = 24 * shape.scale
        return { x: shape.position.x - size / 2, y: shape.position.y - size / 2, width: size, height: size }
      },
      branchStroke: '#000000'
    })
    if (bundle) {
      shapes.push(...bundle.shapes)
      const pointCount = new Set(familyComponents.map((component) => component.bindingId)).size
      shapes.push({
        id: nextShapeId(),
        kind: 'text',
        position: {
          x: anchorX,
          y: CIRCUIT_BUS_Y - 240 - Math.max(0, pointCount - 1) * 90 - 42
        },
        text: configuration.description,
        textAnchor: 'middle',
        scale: 0.9,
        fill: '#000000',
        stroke: 'none',
        sourceLink: { kind: 'board', id: configuration.family, role: 'description' },
        generationKey: `board:${configuration.family}:description`
      })
    }
  }

  return shapes
}

const state = (shapes: Shape[], oneWire = false): NativeDocumentState => ({
  version: 2,
  ...(oneWire ? { oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION } : {}),
  shapes,
  selectedId: null,
  paperPreset: 'a4-landscape',
  printMargin: 10,
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT
})

const schema = (documentState: NativeDocumentState) => ({
  version: 'native-svg-1',
  objects: [{ kind: 'cadle-native-svg-document', payload: documentState }]
})

const circuitSpecifications: Record<string, ProjectCircuitSpecification> = {
  A: {
    circuitType: 'lighting',
    breakerCurrentA: 16,
    cableSectionMm2: 1.5,
    cableConductors: 3,
    hasProtectiveConductor: true,
    cableType: 'VOB',
    cableInstallation: 'conduit-recessed',
    showCableInstallation: true,
    poles: 2,
    phaseConfiguration: 'L1+N',
    manufacturer: 'Schneider Electric',
    neutralPosition: 'left',
    showPhaseLabel: true,
    breakerCurve: 'C',
    boardId: 'main',
    railId: 'rail-1'
  },
  B: {
    circuitType: 'sockets',
    breakerCurrentA: 20,
    cableSectionMm2: 2.5,
    cableConductors: 3,
    hasProtectiveConductor: true,
    cableType: 'VOB',
    cableInstallation: 'conduit-recessed',
    showCableInstallation: true,
    poles: 2,
    phaseConfiguration: 'L1+N',
    manufacturer: 'Schneider Electric',
    neutralPosition: 'left',
    showPhaseLabel: true,
    breakerCurve: 'C',
    boardId: 'main',
    railId: 'rail-1'
  },
  C: {
    circuitType: 'lighting',
    breakerCurrentA: 16,
    cableSectionMm2: 1.5,
    cableConductors: 3,
    hasProtectiveConductor: true,
    cableType: 'VOB',
    cableInstallation: 'conduit-recessed',
    showCableInstallation: true,
    poles: 2,
    phaseConfiguration: 'L1+N',
    manufacturer: 'Schneider Electric',
    neutralPosition: 'left',
    showPhaseLabel: true,
    breakerCurve: 'C',
    boardId: 'keuken',
    railId: 'rail-1'
  }
}

export const createVisualTestProject = (): Project => ({
  creationTime: PAGE_CREATED_AT,
  uuid: VISUAL_TEST_PROJECT_KEY,
  name: VISUAL_TEST_PROJECT_NAME,
  customer: { name: 'Visual', lastname: 'Test' },
  installer: { name: 'Cadle', lastname: 'QA' },
  company: 'Cadle',
  eanCode: '541234567890123456',
  mainFuseA: 40,
  address: { street: 'Teststraat', number: '1', postalCode: '1000', city: 'Brussel' },
  electricalProfile: {
    standard: 'AREI',
    edition: '2023',
    distributor: 'Test grid',
    supplyConfiguration: '1x230V+N',
    supplyVoltageV: 230,
    phaseConfiguration: 'L1+N',
    earthingSystem: 'TT',
    defaultPoles: 2,
    boards: [
      {
        id: 'main',
        name: 'Main distribution board',
        rails: [{ id: 'rail-1', name: 'Rij 1' }],
        mainDifferential: { id: 'diff-main', ratedCurrentA: 40, sensitivityMa: 300, poles: 2, type: 'A' },
        additionalDifferentials: [
          { id: 'diff-row-1', railId: 'rail-1', ratedCurrentA: 40, sensitivityMa: 30, poles: 2, type: 'A' }
        ]
      },
      {
        id: 'keuken',
        name: 'Verdeelkast keuken',
        parentBoardId: 'main',
        rails: [{ id: 'rail-1', name: 'Rij 1' }],
        mainDifferential: {
          id: 'diff-kitchen',
          railId: 'rail-1',
          ratedCurrentA: 40,
          sensitivityMa: 30,
          poles: 2,
          type: 'A'
        }
      }
    ]
  },
  oneWireTopology: visualTestTopology,
  circuitSpecifications,
  pages: {
    [VISUAL_TEST_GROUND_PAGE_KEY]: {
      creationTime: PAGE_CREATED_AT,
      name: 'Situation plan',
      pageType: 'groundplan',
      schema: schema(state(situationShapes())),
      order: 0
    },
    [VISUAL_TEST_ONEWIRE_PAGE_KEY]: {
      creationTime: PAGE_CREATED_AT + 1,
      name: 'One-wire distribution',
      pageType: 'onewire',
      schema: schema(state(oneWireTopologyShapes(), true)),
      order: 1
    },
    [VISUAL_TEST_ONEWIRE_CIRCUITS_PAGE_KEY]: {
      creationTime: PAGE_CREATED_AT + 2,
      name: 'One-wire circuits',
      pageType: 'onewire',
      schema: schema(state(oneWireCircuitShapes('main', 'rail-1', new Set(['A', 'B'])), true)),
      order: 2
    },
    [VISUAL_TEST_ONEWIRE_CIRCUITS_ROW_2_PAGE_KEY]: {
      creationTime: PAGE_CREATED_AT + 3,
      name: 'One-wire circuits kitchen',
      pageType: 'onewire',
      schema: schema(state(oneWireCircuitShapes('keuken', 'rail-1', new Set(['C'])), true)),
      order: 3
    }
  }
})

export const ensureVisualTestProject = async (): Promise<void> => {
  const project = createVisualTestProject()
  await projectDataStore.put(VISUAL_TEST_PROJECT_KEY, JSON.stringify(project))
  await projectStore.put(VISUAL_TEST_PROJECT_KEY, VISUAL_TEST_PROJECT_NAME)
}
