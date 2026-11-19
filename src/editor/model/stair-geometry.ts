import type { StairVariant } from './types.js'

export const isStairVariant = (value: unknown): value is StairVariant =>
  value === 'stairs-straight' || value === 'stairs-quarter-turn' ||
  value === 'stairs-double-quarter-turn' || value === 'stairs-spiral'

type Bounds = { x: number; y: number; width: number; height: number }

export const stairGeometry = (bounds: Bounds, variant: StairVariant) => {
  const { x, y } = bounds
  const width = Math.max(1, bounds.width), height = Math.max(1, bounds.height)
  const right = x + width, bottom = y + height
  const head = Math.min(10, width / 8, height / 8)
  const treadCount = (length: number) => Math.max(2, Math.min(80, Math.round(length / 20)))
  const treads: string[] = []

  if (variant === 'stairs-spiral') {
    const cx = x + width / 2, cy = y + height / 2
    const rx = width / 2, ry = height / 2
    const post = Math.min(width, height) * 0.06
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6
      const cos = Math.cos(angle), sin = Math.sin(angle)
      treads.push(`M ${cx + post * cos} ${cy + post * sin} L ${cx + rx * cos} ${cy + ry * sin}`)
    }
    const tipX = cx + rx * 0.65
    return {
      outline: `M ${x} ${cy} A ${rx} ${ry} 0 1 1 ${right} ${cy} A ${rx} ${ry} 0 1 1 ${x} ${cy} Z M ${cx - post} ${cy} A ${post} ${post} 0 1 1 ${cx + post} ${cy} A ${post} ${post} 0 1 1 ${cx - post} ${cy} Z`,
      treads: treads.join(' '),
      arrow: `M ${cx} ${cy + ry * 0.65} A ${rx * 0.65} ${ry * 0.65} 0 1 1 ${tipX} ${cy} M ${tipX - head} ${cy - head} L ${tipX} ${cy} L ${tipX + head} ${cy - head}`
    }
  }

  if (variant === 'stairs-double-quarter-turn') {
    const flight = Math.min(width / 3, height * 0.4)
    const leftInner = x + flight, rightInner = right - flight, innerY = y + flight
    const sideCount = treadCount(height - flight), topCount = treadCount(width - 2 * flight)
    for (let i = 1; i < sideCount; i++) {
      const ty = innerY + (height - flight) * i / sideCount
      treads.push(`M ${x} ${ty} L ${leftInner} ${ty} M ${rightInner} ${ty} L ${right} ${ty}`)
    }
    for (let i = 1; i < topCount; i++) {
      const tx = leftInner + (width - 2 * flight) * i / topCount
      treads.push(`M ${tx} ${y} L ${tx} ${innerY}`)
    }
    treads.push(`M ${x} ${innerY} L ${leftInner} ${innerY} L ${leftInner} ${y} M ${x} ${y} L ${leftInner} ${innerY}`)
    treads.push(`M ${rightInner} ${y} L ${rightInner} ${innerY} L ${right} ${innerY} M ${right} ${y} L ${rightInner} ${innerY}`)
    const leftAxis = x + flight / 2, rightAxis = right - flight / 2
    const arrowY = y + flight / 2, tipY = bottom - flight / 4
    return {
      outline: `M ${x} ${bottom} L ${x} ${y} L ${right} ${y} L ${right} ${bottom} L ${rightInner} ${bottom} L ${rightInner} ${innerY} L ${leftInner} ${innerY} L ${leftInner} ${bottom} Z`,
      treads: treads.join(' '),
      arrow: `M ${leftAxis} ${tipY} L ${leftAxis} ${arrowY} L ${rightAxis} ${arrowY} L ${rightAxis} ${tipY} M ${rightAxis - head} ${tipY - head} L ${rightAxis} ${tipY} L ${rightAxis + head} ${tipY - head}`
    }
  }

  if (variant === 'stairs-quarter-turn') {
    const flight = Math.min(width, height) * 0.4
    const innerX = x + flight, innerY = y + flight
    const lowerCount = treadCount(height - flight), upperCount = treadCount(width - flight)
    for (let i = 1; i < lowerCount; i++) {
      const ty = innerY + (height - flight) * i / lowerCount
      treads.push(`M ${x} ${ty} L ${innerX} ${ty}`)
    }
    for (let i = 1; i < upperCount; i++) {
      const tx = innerX + (width - flight) * i / upperCount
      treads.push(`M ${tx} ${y} L ${tx} ${innerY}`)
    }
    treads.push(`M ${x} ${innerY} L ${innerX} ${innerY} L ${innerX} ${y} M ${x} ${y} L ${innerX} ${innerY}`)
    const arrowY = y + flight / 2, tipX = right - flight / 4
    return {
      outline: `M ${x} ${y} L ${right} ${y} L ${right} ${innerY} L ${innerX} ${innerY} L ${innerX} ${bottom} L ${x} ${bottom} Z`,
      treads: treads.join(' '),
      arrow: `M ${x + flight / 2} ${bottom - flight / 4} L ${x + flight / 2} ${arrowY} L ${tipX} ${arrowY} M ${tipX - head} ${arrowY - head} L ${tipX} ${arrowY} L ${tipX - head} ${arrowY + head}`
    }
  }

  const count = treadCount(height)
  for (let i = 1; i < count; i++) {
    const ty = y + height * i / count
    treads.push(`M ${x} ${ty} L ${right} ${ty}`)
  }
  const cx = x + width / 2, tipY = y + height * 0.08
  return {
    outline: `M ${x} ${y} L ${right} ${y} L ${right} ${bottom} L ${x} ${bottom} Z`,
    treads: treads.join(' '),
    arrow: `M ${cx} ${bottom - height * 0.08} L ${cx} ${tipY} M ${cx - head} ${tipY + head} L ${cx} ${tipY} L ${cx + head} ${tipY + head}`
  }
}
