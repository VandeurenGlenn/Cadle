import { addPage, getProjectData } from '../api/project.js'
import type { PageType, Project, UUID } from '../types.js'

const oneWirePageKey = (project: Project): string | null =>
  Object.entries(project.pages ?? {}).find(([, page]) => page.pageType === 'onewire')?.[0] ?? null

type OneWirePageOperations = {
  addPage: (
    projectKey: UUID,
    pageName: string,
    schema: { version: string; objects: object[] },
    pageType: PageType
  ) => Promise<UUID>
  getProjectData: (projectKey: UUID) => Promise<Project>
}

export const ensureOneWirePage = async (
  projectKey: UUID,
  currentProject: Project,
  operations: OneWirePageOperations = { addPage, getProjectData }
): Promise<{ project: Project; pageKey: string } | null> => {
  const existing = oneWirePageKey(currentProject)
  if (existing) return { project: currentProject, pageKey: existing }

  const pageKey = await operations.addPage(
    projectKey,
    'One-wire diagram',
    { version: 'native-svg-1', objects: [] },
    'onewire'
  )
  const project = await operations.getProjectData(projectKey)
  return project.pages?.[pageKey]?.pageType === 'onewire' ? { project, pageKey } : null
}
