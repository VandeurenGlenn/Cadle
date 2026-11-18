import type { Project, ProjectRecoveryEntry, UUID } from '../types.js'

const MAX_RECOVERY_ENTRIES = 10

export const oneWireSourceFingerprint = async (project: Project): Promise<string> => {
  const pages = Object.entries(project.pages).filter(([, page]) =>
    page.pageType !== 'onewire' && page.pageType !== 'circuit-schedule' && !page.heatingPlanOf && !page.heatingScheduleOf)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, page]) => [key, page.schema])
  const content = JSON.stringify([pages, project.electricalProfile, project.circuitSpecifications])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const projectWithRecoveryPoint = (
  project: Project,
  pageKey: UUID,
  label: string
): Project => {
  const { recovery = [], ...snapshot } = project
  const entry: ProjectRecoveryEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    label,
    pageKey,
    project: structuredClone(snapshot)
  }
  return { ...project, recovery: [entry, ...recovery].slice(0, MAX_RECOVERY_ENTRIES) }
}

export const projectFromRecoveryPoint = (project: Project, id: string): { project: Project; pageKey: UUID } => {
  const entry = project.recovery?.find((candidate) => candidate.id === id)
  if (!entry || !entry.project.pages[entry.pageKey]) throw new Error('Dit herstelpunt is niet meer beschikbaar.')
  return {
    project: { ...structuredClone(entry.project), recovery: structuredClone(project.recovery) },
    pageKey: entry.pageKey
  }
}
