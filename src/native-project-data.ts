import type { Project, UUID } from './types.js'
import { getProjectData, projectDataStore, projectStore, setProjectData } from './api/project.js'
import { migrateLegacyProjectToNativeState, migrateLegacySchemaToNativeState } from './native-draw/legacy-project.js'
import { parseHash } from './shell/routing.js'

export type NativePoint = { x: number; y: number }

export type NativeLineShape = {
  id: string
  kind: 'wall' | 'line' | 'door' | 'window' | 'gate'
  start: NativePoint
  end: NativePoint
  flipSide?: boolean
  bindingId?: string
}

export type NativeRectShape = {
  id: string
  kind: 'rect'
  start: NativePoint
  end: NativePoint
  bindingId?: string
}

export type NativeTextShape = {
  id: string
  kind: 'text'
  position: NativePoint
  text: string
  bindingId?: string
}

export type NativeSymbolShape = {
  id: string
  kind: 'symbol'
  position: NativePoint
  name: string
  path: string
  scale: number
  bindingId?: string
}

export type NativeImageShape = {
  id: string
  kind: 'image'
  position: NativePoint
  name: string
  path: string
  width: number
  height: number
  bindingId?: string
}

export type NativeShape = NativeLineShape | NativeRectShape | NativeTextShape | NativeSymbolShape | NativeImageShape

export type NativePaperPreset = 'a4-portrait' | 'a4-landscape' | 'a3-portrait' | 'a3-landscape'

export type NativeDocumentState = {
  version: 1
  shapes: NativeShape[]
  paperPreset: NativePaperPreset
  printMargin: number
  worldWidth: number
  worldHeight: number
}

type NativeSchemaObject = {
  kind: 'cadle-native-svg-document'
  payload: NativeDocumentState
}

type NativeLoadResult = {
  projectKey: UUID
  pageKey: UUID
  state: NativeDocumentState | null
}

const DEFAULT_PROJECT_KEY = '00000000-0000-4000-8000-000000000001' as UUID
const DEFAULT_PAGE_KEY = '00000000-0000-4000-8000-000000000002' as UUID

const isFinitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

const asNativeState = (value: unknown): NativeDocumentState | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<NativeDocumentState>
  if (!Array.isArray(candidate.shapes)) return null
  if (!isFinitePositive(candidate.worldWidth)) return null
  if (!isFinitePositive(candidate.worldHeight)) return null
  if (!isFiniteNonNegative(candidate.printMargin)) return null
  if (
    candidate.paperPreset !== 'a4-portrait' &&
    candidate.paperPreset !== 'a4-landscape' &&
    candidate.paperPreset !== 'a3-portrait' &&
    candidate.paperPreset !== 'a3-landscape'
  ) {
    return null
  }

  return {
    version: 1,
    shapes: candidate.shapes as NativeShape[],
    paperPreset: candidate.paperPreset,
    printMargin: candidate.printMargin,
    worldWidth: candidate.worldWidth,
    worldHeight: candidate.worldHeight
  }
}

const parseNativeFromSchema = (schema: unknown): NativeDocumentState | null => {
  const direct = asNativeState(schema)
  if (direct) return direct
  if (!schema || typeof schema !== 'object') return null

  const candidate = schema as { payload?: unknown; objects?: unknown[] }
  const payloadState = asNativeState(candidate.payload)
  if (payloadState) return payloadState

  if (!Array.isArray(candidate.objects)) return null
  for (const object of candidate.objects) {
    if (!object || typeof object !== 'object') continue

    const objectState = asNativeState(object)
    if (objectState) return objectState

    const schemaObject = object as Partial<NativeSchemaObject>
    if (schemaObject.kind === 'cadle-native-svg-document') {
      const parsed = asNativeState(schemaObject.payload)
      if (parsed) return parsed
    }
  }

  return null
}

const parseNativeFromProject = (project: Project, pageKey: UUID): NativeDocumentState | null => {
  const page = project.pages?.[pageKey]
  if (!page || typeof page !== 'object') return null
  return parseNativeFromSchema((page as { schema?: unknown }).schema)
}

const createDefaultProject = (): Project => ({
  creationTime: Date.now(),
  uuid: DEFAULT_PROJECT_KEY,
  name: 'Cadle Native',
  installer: {
    name: 'Native',
    lastname: 'Runtime'
  },
  company: 'Cadle',
  address: {
    street: '',
    number: '',
    postalCode: ''
  },
  pages: {
    [DEFAULT_PAGE_KEY]: {
      creationTime: Date.now(),
      name: 'Page 1',
      schema: {
        version: 'native-svg-1',
        objects: []
      },
      order: 0
    }
  }
})

const orderedPageEntries = (project: Project): Array<[string, Project['pages'][string]]> =>
  Object.entries(project.pages ?? {}).sort(([, a], [, b]) => {
    const orderA = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER
    const orderB = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER
    return orderA - orderB || a.creationTime - b.creationTime
  })

const firstPageKey = (project: Project): UUID | null => {
  const [first] = orderedPageEntries(project)
  return first ? (first[0] as UUID) : null
}

const ensureProjectExists = async (projectKey: UUID): Promise<void> => {
  try {
    const project = await getProjectData(projectKey)
    if (Object.keys(project.pages ?? {}).length > 0) return

    project.pages = {
      [DEFAULT_PAGE_KEY]: {
        creationTime: Date.now(),
        name: 'Page 1',
        schema: {
          version: 'native-svg-1',
          objects: []
        },
        order: 0
      }
    }
    await setProjectData(projectKey, project)
  } catch {
    const nextProject = createDefaultProject()
    if (projectKey !== DEFAULT_PROJECT_KEY) {
      nextProject.uuid = projectKey
    }

    await projectDataStore.put(projectKey, JSON.stringify(nextProject))
    await projectStore.put(projectKey, nextProject.name)
  }
}

const hashKeys = (): { projectKey?: UUID; pageKey?: UUID } => {
  const { params } = parseHash(window.location.hash)
  const rawProject = params?.project
  const rawPage = params?.page
  const projectKey = rawProject ? (rawProject as UUID) : undefined
  const pageKey = rawPage ? (rawPage as UUID) : undefined
  return { projectKey, pageKey }
}

export const loadNativeState = async (): Promise<NativeLoadResult> => {
  const { projectKey: hashProjectKey, pageKey: hashPageKey } = hashKeys()
  const projectKey = hashProjectKey ?? DEFAULT_PROJECT_KEY
  const requestedPageKey = hashPageKey ?? DEFAULT_PAGE_KEY

  await ensureProjectExists(projectKey)
  const project = await getProjectData(projectKey)
  const pageKey = project.pages?.[requestedPageKey] ? requestedPageKey : (firstPageKey(project) ?? DEFAULT_PAGE_KEY)

  return {
    projectKey,
    pageKey,
    state:
      parseNativeFromProject(project, pageKey) ??
      migrateLegacySchemaToNativeState(project.pages?.[pageKey]?.schema) ??
      migrateLegacyProjectToNativeState(project, pageKey)
  }
}

export const saveNativeState = async (projectKey: UUID, pageKey: UUID, state: NativeDocumentState): Promise<void> => {
  const project = await getProjectData(projectKey)
  if (!project.pages?.[pageKey]) {
    project.pages[pageKey] = {
      creationTime: Date.now(),
      name: 'Page 1',
      schema: {
        version: 'native-svg-1',
        objects: []
      },
      order: Object.keys(project.pages ?? {}).length
    }
  }

  project.pages[pageKey].schema = {
    version: 'native-svg-1',
    objects: [
      {
        kind: 'cadle-native-svg-document',
        payload: state
      } as NativeSchemaObject
    ]
  }

  await setProjectData(projectKey, project)
}
