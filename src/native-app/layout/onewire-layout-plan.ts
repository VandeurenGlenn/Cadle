export type OneWireFamilyDemand = { family: string; circuitCount: number }
export type OneWireFamilyPlacement = { family: string; pageIndex: number; railIndex: number; slotIndex: number }

export type OneWireLayoutPlan = {
  placements: OneWireFamilyPlacement[]
  pageCount: number
  railsPerPage: number
  slotsPerRail: number
}

export const planOneWireLayout = (
  families: readonly OneWireFamilyDemand[],
  options: { usableWidth: number; usableHeight: number; minBranchWidth?: number; railHeight?: number }
): OneWireLayoutPlan => {
  const minBranchWidth = Math.max(120, options.minBranchWidth ?? 220)
  const railHeight = Math.max(220, options.railHeight ?? 320)
  const slotsPerRail = Math.max(1, Math.floor(options.usableWidth / minBranchWidth))
  const railsPerPage = Math.max(1, Math.floor(options.usableHeight / railHeight))
  const placements: OneWireFamilyPlacement[] = []
  let absoluteRail = 0
  let slotIndex = 0

  for (const demand of families) {
    const requiredWidthSlots = Math.max(1, Math.ceil(demand.circuitCount / 4))
    if (slotIndex > 0 && slotIndex + requiredWidthSlots > slotsPerRail) {
      absoluteRail += 1
      slotIndex = 0
    }
    placements.push({
      family: demand.family,
      pageIndex: Math.floor(absoluteRail / railsPerPage),
      railIndex: absoluteRail % railsPerPage,
      slotIndex
    })
    slotIndex += requiredWidthSlots
    if (slotIndex >= slotsPerRail) {
      absoluteRail += 1
      slotIndex = 0
    }
  }

  const pageCount = placements.length ? Math.max(...placements.map((placement) => placement.pageIndex)) + 1 : 0
  return { placements, pageCount, railsPerPage, slotsPerRail }
}
