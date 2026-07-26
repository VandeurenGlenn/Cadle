import type { Project, UUID } from './types.js'
import { getProjectData, projectDataStore, projectStore, setProjectData } from './api/project.js'
import { parseHash } from './shell/routing.js'
import { asNativeState, type NativeDocumentState } from './editor/model/document-state.js'

export { asNativeState, type NativeDocumentState } from './editor/model/document-state.js'

type NativeSchemaObject = {
  kind: 'cadle-native-svg-document'
  payload: NativeDocumentState
}

type NativeLoadResult = {
  projectKey: UUID
  pageKey: UUID
  project: Project
  state: NativeDocumentState | null
}

const DEFAULT_PROJECT_KEY = '00000000-0000-4000-8000-000000000001' as UUID
const DEFAULT_PAGE_KEY = '00000000-0000-4000-8000-000000000002' as UUID

const createDefaultPage = (name = 'Page 1', order = 0) => ({
  creationTime: Date.now(),
  name,
  pageType: 'groundplan' as const,
  schema: {
    version: 'native-svg-1',
    objects: []
  },
  order
})

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
  customer: {
    name: '',
    lastname: ''
  },
  installer: {
    name: 'Native',
    lastname: 'Runtime'
  },
  company: 'Cadle',
  address: {
    street: '',
    number: '',
    postalCode: '',
    city: ''
  },
  pages: {
    [DEFAULT_PAGE_KEY]: {
      creationTime: Date.now(),
      name: 'Page 1',
      pageType: 'groundplan',
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
      [DEFAULT_PAGE_KEY]: createDefaultPage()
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
  if (Object.keys(project.pages ?? {}).length === 0) {
    project.pages = {
      [requestedPageKey]: createDefaultPage()
    }
    await setProjectData(projectKey, project)
  }
  const pageKey = project.pages?.[requestedPageKey] ? requestedPageKey : (firstPageKey(project) ?? DEFAULT_PAGE_KEY)

  return {
    projectKey,
    pageKey,
    project,
    state: parseNativeFromProject(project, pageKey)
  }
}

export const saveNativeState = async (projectKey: UUID, pageKey: UUID, state: NativeDocumentState): Promise<void> => {
  const project = await getProjectData(projectKey)
  const pages = project.pages ?? (project.pages = {})
  if (!pages[pageKey]) {
    pages[pageKey] = createDefaultPage('Page 1', Object.keys(pages).length)
  }

  pages[pageKey].schema = {
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
