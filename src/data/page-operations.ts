import { addPage, getProjectData, setProjectData } from '../api/project.js'
import type { PageType, Project, UUID } from '../types.js'
import { nativeStateForProjectPage } from '../editor/model/document-state.js'

export const oneWireInstallationRootKey = (project: Project, pageKey: string): string | null => {
  const first = project.pages[pageKey]
  let key = first?.pageType === 'groundplan' ? first.linkedOneWirePageKey : pageKey
  const visited = new Set<string>()
  while (key && project.pages[key]?.pageType === 'onewire' && !visited.has(key)) {
    visited.add(key)
    const page = project.pages[key]
    const parent = page.oneWireInstallationOf ?? page.oneWireOverflowOf
    if (!parent) return key
    key = parent
  }
  return null
}

export const installationOneWirePageKeys = (project: Project, pageKey: string): string[] => {
  const rootKey = oneWireInstallationRootKey(project, pageKey)
  if (!rootKey) return []
  return Object.keys(project.pages).filter((key) =>
    project.pages[key].pageType === 'onewire' && oneWireInstallationRootKey(project, key) === rootKey)
}

const hasManualOneWireSheets = (project: Project, pageKey: string): boolean =>
  installationOneWirePageKeys(project, pageKey).some((key) => Boolean(project.pages[key].oneWireInstallationOf))

export const linkedGroundplanPageKeys = (project: Project, oneWirePageKey: string): string[] => {
  const rootKey = oneWireInstallationRootKey(project, oneWirePageKey)
  if (!rootKey) return []
  return Object.entries(project.pages)
    .filter(([key, page]) =>
      page.pageType === 'groundplan' && !page.heatingPlanOf && !page.heatingScheduleOf &&
      oneWireInstallationRootKey(project, key) === rootKey
    )
    .map(([key]) => key)
}

export const electricalSettingsPageKey = (project: Project, pageKey: string): string | undefined => {
  const page = project.pages[pageKey]
  if (page?.pageType === 'groundplan' && !page.heatingPlanOf && !page.heatingScheduleOf) {
    return oneWireInstallationRootKey(project, pageKey) ?? pageKey
  }
  if (page?.pageType !== 'onewire') return undefined
  const rootKey = oneWireInstallationRootKey(project, pageKey)
  if (!rootKey) return undefined
  const root = project.pages[rootKey]
  return linkedGroundplanPageKeys(project, rootKey).length || hasManualOneWireSheets(project, rootKey) ||
    root.electricalProfile || root.circuitSpecifications || root.mainFuseA !== undefined || root.oneWirePrompt || root.oneWireTopology
    ? rootKey : undefined
}

export const explicitLinkedPageKey = (project: Project, pageKey: string): string | null => {
  const page = project.pages[pageKey]
  if (page?.pageType === 'groundplan') {
    if (page.linkedOneWirePageKey === undefined) return null
    return oneWireInstallationRootKey(project, pageKey) ?? ''
  }
  if (page?.pageType === 'onewire') {
    return linkedGroundplanPageKeys(project, pageKey)[0] ??
      (electricalSettingsPageKey(project, pageKey) ? '' : null)
  }
  return null
}

export const oneWireGenerationPageKeys = (project: Project, rootKey: string): string[] => {
  rootKey = oneWireInstallationRootKey(project, rootKey) ?? rootKey
  const isLinkedBuildingPage = linkedGroundplanPageKeys(project, rootKey).length > 0 ||
    hasManualOneWireSheets(project, rootKey)
  const legacyPages = isLinkedBuildingPage ? [] : Object.entries(project.pages).flatMap(([key, page]) =>
    page.pageType === 'onewire' && !page.oneWireInstallationOf && /^One-wire diagram \d+$/.test(page.name) ? [key] : [])
  const keys = new Set([rootKey, ...legacyPages])
  for (const key of keys) {
    for (const [childKey, page] of Object.entries(project.pages)) {
      if (page.pageType === 'onewire' && !page.oneWireInstallationOf && page.oneWireOverflowOf === key) keys.add(childKey)
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
    if (page.oneWireInstallationOf) return false
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
    return pages.find(([, page]) => page.pageType === 'onewire' && !page.oneWireOverflowOf && !page.oneWireInstallationOf)?.[0] ?? null
  }
  const linkedPageKey = explicitLinkedPageKey(project, groundPlanPageKey)
  if (linkedPageKey) return linkedPageKey
  const claimedPageKeys = new Set(pages.flatMap(([key, page]) => {
    const root = page.pageType === 'groundplan' ? oneWireInstallationRootKey(project, key) : null
    return root ? [root] : []
  }))
  return pages.find(([key, page]) =>
    page.pageType === 'onewire' && !page.oneWireOverflowOf && !page.oneWireInstallationOf && !claimedPageKeys.has(key)
  )?.[0] ?? null
}

export const linkGroundPlanToOneWirePage = (
  project: Project, groundPlanPageKey: string, oneWirePageKey: string
): Project => {
  const rootKey = oneWireInstallationRootKey(project, oneWirePageKey)
  if (!rootKey || project.pages[groundPlanPageKey]?.pageType !== 'groundplan') throw new Error('Kies een geldig situatieblad en een geldige installatie.')
  oneWirePageKey = rootKey
  const pages = { ...project.pages }
  const previousSettingsPages = Object.entries(pages)
    .filter(([key, page]) =>
      key !== groundPlanPageKey && page.pageType === 'groundplan' &&
      oneWireInstallationRootKey(project, key) === oneWirePageKey
    )
    .map(([, page]) => page)
  previousSettingsPages.push(pages[groundPlanPageKey])
  const oneWirePage = pages[oneWirePageKey]
  pages[groundPlanPageKey] = {
    ...pages[groundPlanPageKey],
    linkedOneWirePageKey: oneWirePageKey as UUID
  }
  pages[oneWirePageKey] = {
    ...oneWirePage,
    electricalProfile: oneWirePage.electricalProfile ??
      previousSettingsPages.find((page) => page?.electricalProfile)?.electricalProfile,
    circuitSpecifications: oneWirePage.circuitSpecifications ??
      previousSettingsPages.find((page) => page?.circuitSpecifications)?.circuitSpecifications,
    mainFuseA: oneWirePage.mainFuseA ??
      previousSettingsPages.find((page) => page?.mainFuseA !== undefined)?.mainFuseA,
    oneWirePrompt: oneWirePage.oneWirePrompt ??
      previousSettingsPages.find((page) => page?.oneWirePrompt)?.oneWirePrompt,
    oneWireTopology: oneWirePage.oneWireTopology ??
      previousSettingsPages.find((page) => page?.oneWireTopology)?.oneWireTopology
  }
  const rootName = pages[oneWirePageKey]?.name ?? ''
  const rootNumber = /^One-wire diagram(?: (\d+))?$/.exec(rootName)
  if (rootNumber) {
    const rootIndex = Number(rootNumber[1] ?? 1)
    const claimedPageKeys = new Set<string>(Object.entries(pages).flatMap(([key, page]) => {
      const root = page.pageType === 'groundplan' ? oneWireInstallationRootKey({ ...project, pages }, key) : null
      return root ? [root] : []
    }))
    for (const [key, page] of Object.entries(pages)) {
      const legacyOverflow = /^One-wire diagram (\d+)$/.exec(page.name)
      if (page.pageType === 'onewire' && !page.oneWireOverflowOf && !page.oneWireInstallationOf && !claimedPageKeys.has(key) &&
        Number(legacyOverflow?.[1]) > rootIndex) {
        pages[key] = { ...page, oneWireOverflowOf: oneWirePageKey as UUID }
      }
    }
  }
  return { ...project, pages }
}

export const linkOneWirePageToInstallation = (project: Project, pageKey: string, targetKey: string): Project => {
  const page = project.pages[pageKey]
  const rootKey = oneWireInstallationRootKey(project, targetKey)
  if (page?.pageType !== 'onewire' || !rootKey) throw new Error('Kies een geldig eendraadsblad en een geldige installatie.')
  const oldRoot = oneWireInstallationRootKey(project, pageKey)
  if (targetKey !== pageKey && rootKey === pageKey) throw new Error('Een installatie kan niet aan haar eigen vervolgblad worden gekoppeld.')
  const source = project.pages[oldRoot ?? pageKey]
  const { oneWireInstallationOf, oneWireOverflowOf, ...standalone } = page
  const next = targetKey === pageKey
    ? {
        ...standalone,
        electricalProfile: structuredClone(source.electricalProfile),
        circuitSpecifications: structuredClone(source.circuitSpecifications),
        mainFuseA: source.mainFuseA,
        oneWirePrompt: source.oneWirePrompt,
        oneWireTopology: structuredClone(source.oneWireTopology)
      }
    : { ...standalone, oneWireInstallationOf: rootKey as UUID }
  const target = project.pages[rootKey]
  return { ...project, pages: {
    ...project.pages,
    [rootKey]: targetKey === pageKey ? target : {
      ...target,
      electricalProfile: target.electricalProfile ?? structuredClone(source.electricalProfile),
      circuitSpecifications: target.circuitSpecifications ?? structuredClone(source.circuitSpecifications),
      mainFuseA: target.mainFuseA ?? source.mainFuseA,
      oneWirePrompt: target.oneWirePrompt ?? source.oneWirePrompt,
      oneWireTopology: target.oneWireTopology ?? structuredClone(source.oneWireTopology)
    },
    [pageKey]: next
  } }
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
