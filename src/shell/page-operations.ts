import { addPage, getProjectData } from '../api/project.js'
import type { Project, UUID } from '../types.js'

const oneWirePageKey = (project: Project): string | null =>
  Object.entries(project.pages ?? {}).find(([, page]) => page.pageType === 'onewire')?.[0] ?? null

export const ensureOneWirePage = async (
  projectKey: UUID,
  currentProject: Project
): Promise<{ project: Project; pageKey: string } | null> => {
  const existing = oneWirePageKey(currentProject)
  if (existing) return { project: currentProject, pageKey: existing }

  await addPage(projectKey, 'One-wire diagram', { version: 'native-svg-1', objects: [] }, 'onewire')
  const project = await getProjectData(projectKey)
  const pageKey = oneWirePageKey(project)
  return pageKey ? { project, pageKey } : null
}
