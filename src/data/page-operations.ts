import { addPage, getProjectData } from '../api/project.js'
import type { PageType, Project, UUID } from '../types.js'
import { nativeStateForProjectPage } from '../editor/model/document-state.js'

export const oneWireGenerationPageKeys = (project: Project, rootKey: string): string[] => {
  const keys = new Set([rootKey, ...Object.entries(project.pages).flatMap(([key, page]) =>
    page.pageType === 'onewire' && /^One-wire diagram \d+$/.test(page.name) ? [key] : [])])
  for (const key of keys) {
    for (const [childKey, page] of Object.entries(project.pages)) {
      if (page.pageType === 'onewire' && page.oneWireOverflowOf === key) keys.add(childKey)
    }
  }
  return [...keys]
}

export const redundantOneWirePageKeys = (
  project: Project, previousKeys: readonly string[], usedKeys: ReadonlySet<string>
): string[] => {
  const generatedKeys = new Set([...usedKeys].flatMap((key) =>
    nativeStateForProjectPage(project, key)?.shapes.flatMap((shape) => shape.generationKey ? [shape.generationKey] : []) ?? []))
  return previousKeys.filter((key) => {
    const page = project.pages[key]
    if (usedKeys.has(key) || page?.pageType !== 'onewire') return false
    const objects = page.schema.objects
    if (!objects.length) return true
    if (objects.length !== 1 || !('kind' in objects[0]) || objects[0].kind !== 'cadle-native-svg-document' ||
      !('payload' in objects[0])) return false
    const payload = objects[0].payload
    if (!payload || typeof payload !== 'object' || !('shapes' in payload) || !Array.isArray(payload.shapes)) return false
    const shapes = nativeStateForProjectPage(project, key)?.shapes
    return Boolean(shapes && shapes.length === payload.shapes.length && shapes.every((shape) =>
      !shape.locked && (shape.sourceLink?.role === 'overflow-reference' ||
        Boolean(shape.generationKey && generatedKeys.has(shape.generationKey)))))
  })
}

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
