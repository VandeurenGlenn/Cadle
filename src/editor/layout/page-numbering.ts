import type { Project } from '../../types.js'

export const orderedProjectPages = (project: Project | null) =>
  Object.entries(project?.pages ?? {}).sort(([, a], [, b]) =>
    (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.creationTime - b.creationTime
  )

export const projectPageNumber = (project: Project | null, currentPageKey: string, pageName = '') => {
  const pages = orderedProjectPages(project)
  let index = pages.findIndex(([key]) => key === currentPageKey)
  if (index < 0 && pageName.trim()) index = pages.findIndex(([, page]) => page.name === pageName)
  return Math.max(0, index) + 1
}

export const oneWireDestinationPageNumber = (
  project: Project | null,
  circuitPageIndex: number,
  hasTopologyPage = true
) => {
  const pages = orderedProjectPages(project)
  const destinationPageIndex = circuitPageIndex + (hasTopologyPage ? 1 : 0)
  const existingIndex = destinationPageIndex === 0
    ? pages.findIndex(([, page]) => page.pageType === 'onewire')
    : pages.findIndex(([, page]) =>
        page.pageType === 'onewire' && page.name === `One-wire diagram ${destinationPageIndex + 1}`)
  if (existingIndex >= 0) return existingIndex + 1

  let missingPagesThroughTarget = 0
  for (let index = 1; index <= destinationPageIndex; index += 1) {
    const pageName = `One-wire diagram ${index + 1}`
    if (!pages.some(([, page]) => page.pageType === 'onewire' && page.name === pageName)) {
      missingPagesThroughTarget += 1
    }
  }
  return pages.length + missingPagesThroughTarget
}
