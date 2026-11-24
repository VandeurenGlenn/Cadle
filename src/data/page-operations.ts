import { addPage, getProjectData, setProjectData } from '../api/project.js'
import type { PageType, Project, UUID } from '../types.js'
import { nativeStateForProjectPage } from '../editor/model/document-state.js'

export const explicitLinkedPageKey = (project: Project, pageKey: string): string | null => {
  const page = project.pages[pageKey]
  if (page?.pageType === 'groundplan') {
    if (page.linkedOneWirePageKey === undefined) return null
    const linkedKey = page.linkedOneWirePageKey
    return linkedKey && project.pages[linkedKey]?.pageType === 'onewire' ? linkedKey : ''
  }
  if (page?.pageType === 'onewire') {
    const rootKey = page.oneWireOverflowOf ?? pageKey
    return Object.entries(project.pages).find(([, candidate]) =>
      candidate.pageType === 'groundplan' && candidate.linkedOneWirePageKey === rootKey
    )?.[0] ?? null
  }
  return null
}

export const oneWireGenerationPageKeys = (project: Project, rootKey: string): string[] => {
  const isLinkedBuildingPage = Object.values(project.pages).some((page) =>
    page.pageType === 'groundplan' && page.linkedOneWirePageKey === rootKey)
  const legacyPages = isLinkedBuildingPage ? [] : Object.entries(project.pages).flatMap(([key, page]) =>
    page.pageType === 'onewire' && /^One-wire diagram \d+$/.test(page.name) ? [key] : [])
  const keys = new Set([rootKey, ...legacyPages])
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
        (shape.kind === 'text' && shape.generationKey && shape.sourceLink?.role.startsWith('sheet-reference:')) ||
        Boolean(shape.generationKey && generatedKeys.has(shape.generationKey)))))
  })
}

const oneWirePageKey = (project: Project, groundPlanPageKey?: string): string | null => {
  const pages = Object.entries(project.pages ?? {})
  if (!groundPlanPageKey) {
    return pages.find(([, page]) => page.pageType === 'onewire' && !page.oneWireOverflowOf)?.[0] ?? null
  }
  const linkedPageKey = explicitLinkedPageKey(project, groundPlanPageKey)
  if (linkedPageKey) return linkedPageKey
  const claimedPageKeys = new Set<string>(pages.flatMap(([, page]) =>
    page.pageType === 'groundplan' && page.linkedOneWirePageKey ? [page.linkedOneWirePageKey] : []))
  return pages.find(([key, page]) =>
    page.pageType === 'onewire' && !page.oneWireOverflowOf && !claimedPageKeys.has(key)
  )?.[0] ?? null
}

const linkGroundPlanToOneWirePage = (project: Project, groundPlanPageKey: string, oneWirePageKey: string): Project => {
  const pages = { ...project.pages }
  pages[groundPlanPageKey] = {
    ...pages[groundPlanPageKey],
    linkedOneWirePageKey: oneWirePageKey as UUID
  }
  const rootName = pages[oneWirePageKey]?.name ?? ''
  const rootNumber = /^One-wire diagram(?: (\d+))?$/.exec(rootName)
  if (rootNumber) {
    const rootIndex = Number(rootNumber[1] ?? 1)
    const claimedPageKeys = new Set<string>(Object.values(pages).flatMap((page) =>
      page.pageType === 'groundplan' && page.linkedOneWirePageKey ? [page.linkedOneWirePageKey] : []))
    for (const [key, page] of Object.entries(pages)) {
      const legacyOverflow = /^One-wire diagram (\d+)$/.exec(page.name)
      if (page.pageType === 'onewire' && !page.oneWireOverflowOf && !claimedPageKeys.has(key) &&
        Number(legacyOverflow?.[1]) > rootIndex) {
        pages[key] = { ...page, oneWireOverflowOf: oneWirePageKey as UUID }
      }
    }
  }
  return { ...project, pages }
}

type OneWirePageOperations = {
  addPage: (
    projectKey: UUID,
    pageName: string,
    schema: { version: string; objects: object[] },
    pageType: PageType
  ) => Promise<UUID>
  getProjectData: (projectKey: UUID) => Promise<Project>
  setProjectData: (projectKey: UUID, project: Project) => Promise<unknown>
}

export const ensureOneWirePage = async (
  projectKey: UUID,
  currentProject: Project,
  operations: OneWirePageOperations = { addPage, getProjectData, setProjectData },
  groundPlanPageKey?: string
): Promise<{ project: Project; pageKey: string } | null> => {
  if (groundPlanPageKey && currentProject.pages[groundPlanPageKey]?.pageType !== 'groundplan') return null
  const existing = oneWirePageKey(currentProject, groundPlanPageKey)
  if (existing) {
    if (!groundPlanPageKey || currentProject.pages[groundPlanPageKey]?.linkedOneWirePageKey === existing) {
      return { project: currentProject, pageKey: existing }
    }
    const project = linkGroundPlanToOneWirePage(currentProject, groundPlanPageKey, existing)
    await operations.setProjectData(projectKey, project)
    return { project, pageKey: existing }
  }

  const pageName = groundPlanPageKey
    ? `One-wire diagram · ${currentProject.pages[groundPlanPageKey].name}`
    : 'One-wire diagram'
  const pageKey = await operations.addPage(
    projectKey,
    pageName,
    { version: 'native-svg-1', objects: [] },
    'onewire'
  )
  let project = await operations.getProjectData(projectKey)
  if (project.pages?.[pageKey]?.pageType !== 'onewire') return null
  if (groundPlanPageKey) {
    project = linkGroundPlanToOneWirePage(project, groundPlanPageKey, pageKey)
    await operations.setProjectData(projectKey, project)
  }
  return { project, pageKey }
}
