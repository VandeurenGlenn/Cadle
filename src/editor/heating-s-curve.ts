/** Two opposing circular bends and their common tangent. A small lane change
 * does not require a 180-degree return or a lateral offset of two radii. All
 * values use grid cells; the longitudinal endpoint stays on the same grid. */
export const heatingLaneShift = (radius: number, lateral: number) => {
  if (radius <= 0 || lateral <= 0 || lateral >= 2 * radius) return undefined
  const maximumAngle = Math.acos(1 - lateral / (2 * radius))
  const run = Math.ceil(2 * radius * Math.sin(maximumAngle) - 1e-8)
  let low = 0, high = maximumAngle
  for (let i = 0; i < 40; i++) {
    const angle = (low + high) / 2
    if (2 * radius * Math.tan(angle / 2) + lateral / Math.tan(angle) > run) low = angle
    else high = angle
  }
  const angle = (low + high) / 2, cut = radius * Math.tan(angle / 2)
  const bendX = radius * Math.sin(angle), bendY = radius * (1 - Math.cos(angle))
  const samples: [number, number][] = [[0, 0]], steps = Math.max(6, Math.ceil(radius * angle * 2))
  for (let i = 1; i <= steps; i++) {
    const theta = angle * i / steps
    samples.push([radius * Math.sin(theta), radius * (1 - Math.cos(theta))])
  }
  const straight = Math.hypot(run - 2 * bendX, lateral - 2 * bendY), pieces = Math.max(1, Math.ceil(straight * 2))
  for (let i = 1; i <= pieces; i++) samples.push([bendX + (run - 2 * bendX) * i / pieces, bendY + (lateral - 2 * bendY) * i / pieces])
  for (let i = 1; i <= steps; i++) {
    const theta = angle * (1 - i / steps)
    samples.push([run - radius * Math.sin(theta), lateral - radius * (1 - Math.cos(theta))])
  }
  return { run, lateral, cut, samples, length: radius * angle * 2 + straight }
}
