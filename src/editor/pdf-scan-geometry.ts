import type { PdfVectorLine } from './pdf-vector-conversion.js'

type PixelData = {
  data: Uint8ClampedArray
  width: number
  height: number
}

type Run = { axis: number; start: number; end: number }
type Cluster = { firstAxis: number; lastAxis: number; start: number; end: number; runs: number }

export type PdfScanGeometryOptions = {
  darknessThreshold?: number
  minimumLengthRatio?: number
  maximumGap?: number
  detectDiagonals?: boolean
  mergeGapRatio?: number
}

const darkPixelMap = (image: PixelData, threshold: number): Uint8Array => {
  const dark = new Uint8Array(image.width * image.height)
  for (let index = 0; index < dark.length; index += 1) {
    const offset = index * 4
    const alpha = image.data[offset + 3] / 255
    const luminance = image.data[offset] * 0.2126 + image.data[offset + 1] * 0.7152 + image.data[offset + 2] * 0.0722
    dark[index] = alpha >= 0.25 && luminance < threshold ? 1 : 0
  }
  return dark
}

const findRuns = (
  dark: Uint8Array,
  width: number,
  height: number,
  horizontal: boolean,
  minimumLength: number,
  maximumGap: number
): Run[] => {
  const outerSize = horizontal ? height : width
  const innerSize = horizontal ? width : height
  const runs: Run[] = []
  const isDark = (axis: number, position: number) => horizontal
    ? dark[axis * width + position] === 1
    : dark[position * width + axis] === 1
  for (let axis = 0; axis < outerSize; axis += 1) {
    let start = -1
    let lastDark = -1
    for (let position = 0; position <= innerSize; position += 1) {
      if (position < innerSize && isDark(axis, position)) {
        if (start < 0) start = position
        lastDark = position
        continue
      }
      if (start < 0) continue
      const gap = position - lastDark
      if (position < innerSize && gap <= maximumGap) continue
      if (lastDark - start + 1 >= minimumLength) runs.push({ axis, start, end: lastDark })
      start = -1
      lastDark = -1
    }
  }
  return runs
}

const clusterRuns = (runs: Run[]): Cluster[] => {
  const clusters: Cluster[] = []
  for (const run of runs) {
    const candidate = clusters.find((cluster) => {
      if (run.axis - cluster.lastAxis > 1) return false
      const overlap = Math.min(run.end, cluster.end) - Math.max(run.start, cluster.start) + 1
      const shorter = Math.min(run.end - run.start + 1, cluster.end - cluster.start + 1)
      return overlap / Math.max(1, shorter) >= 0.75
    })
    if (!candidate) {
      clusters.push({ firstAxis: run.axis, lastAxis: run.axis, start: run.start, end: run.end, runs: 1 })
      continue
    }
    candidate.lastAxis = run.axis
    candidate.start = Math.round((candidate.start * candidate.runs + run.start) / (candidate.runs + 1))
    candidate.end = Math.round((candidate.end * candidate.runs + run.end) / (candidate.runs + 1))
    candidate.runs += 1
  }
  return clusters
}

type DiagonalRun = Run & { direction: 1 | -1 }

const findDiagonalRuns = (
  dark: Uint8Array,
  width: number,
  height: number,
  direction: 1 | -1,
  minimumLength: number,
  maximumGap: number
): DiagonalRun[] => {
  const runs: DiagonalRun[] = []
  const firstAxis = direction === 1 ? -(height - 1) : 0
  const lastAxis = direction === 1 ? width - 1 : width + height - 2
  for (let axis = firstAxis; axis <= lastAxis; axis += 1) {
    const firstY = direction === 1 ? Math.max(0, -axis) : Math.max(0, axis - width + 1)
    const lastY = direction === 1 ? Math.min(height - 1, width - 1 - axis) : Math.min(height - 1, axis)
    let start = -1
    let lastDark = -1
    for (let y = firstY; y <= lastY + 1; y += 1) {
      const x = direction === 1 ? y + axis : axis - y
      const isDark = y <= lastY && dark[y * width + x] === 1
      if (isDark) {
        if (start < 0) start = y
        lastDark = y
        continue
      }
      if (start < 0) continue
      if (y <= lastY && y - lastDark <= maximumGap) continue
      if (lastDark - start + 1 >= minimumLength) runs.push({ axis, start, end: lastDark, direction })
      start = -1
      lastDark = -1
    }
  }
  return runs
}

const angleDistance = (left: number, right: number): number => {
  const difference = Math.abs(left - right) % Math.PI
  return Math.min(difference, Math.PI - difference)
}

export const mergePdfScanLines = (
  source: readonly PdfVectorLine[],
  maximumGap: number,
  maximumOffset = Math.max(1, maximumGap * 0.5)
): PdfVectorLine[] => {
  const ordered = source.map((line) => ({ ...line })).sort((left, right) => {
    const leftAngle = Math.atan2(left.y2 - left.y1, left.x2 - left.x1)
    const rightAngle = Math.atan2(right.y2 - right.y1, right.x2 - right.x1)
    return leftAngle - rightAngle || Math.min(left.x1, left.x2) - Math.min(right.x1, right.x2) || Math.min(left.y1, left.y2) - Math.min(right.y1, right.y2)
  })
  const merged: PdfVectorLine[] = []
  for (const incoming of ordered) {
    let combined = false
    for (let leftIndex = 0; leftIndex < merged.length; leftIndex += 1) {
      const left = merged[leftIndex]
      const dx = left.x2 - left.x1
      const dy = left.y2 - left.y1
      const length = Math.hypot(dx, dy)
      if (length === 0) continue
      const ux = dx / length
      const uy = dy / length
      const angle = Math.atan2(uy, ux)
      const project = (x: number, y: number) => (x - left.x1) * ux + (y - left.y1) * uy
      const offset = (x: number, y: number) => Math.abs((x - left.x1) * -uy + (y - left.y1) * ux)
      if (angleDistance(angle, Math.atan2(incoming.y2 - incoming.y1, incoming.x2 - incoming.x1)) > Math.PI / 90) continue
      if (Math.max(offset(incoming.x1, incoming.y1), offset(incoming.x2, incoming.y2)) > maximumOffset) continue
      const projections = [0, length, project(incoming.x1, incoming.y1), project(incoming.x2, incoming.y2)]
        const rightMin = Math.min(projections[2], projections[3])
        const rightMax = Math.max(projections[2], projections[3])
        if (Math.max(0, rightMin - length, -rightMax) > maximumGap) continue
        const minimum = Math.min(...projections)
        const maximum = Math.max(...projections)
        merged[leftIndex] = {
          x1: left.x1 + ux * minimum,
          y1: left.y1 + uy * minimum,
          x2: left.x1 + ux * maximum,
          y2: left.y1 + uy * maximum,
          lineWidth: Math.max(left.lineWidth, incoming.lineWidth)
        }
        combined = true
        break
    }
    if (!combined) merged.push(incoming)
  }
  return merged
}

export const detectPdfScanGeometry = (
  image: PixelData,
  target: { width: number; height: number },
  options: PdfScanGeometryOptions = {}
): PdfVectorLine[] => {
  const threshold = options.darknessThreshold ?? 150
  const minimumRatio = options.minimumLengthRatio ?? 0.075
  const maximumGap = options.maximumGap ?? 1
  const dark = darkPixelMap(image, threshold)
  const minimumHorizontal = Math.max(24, Math.round(image.width * minimumRatio))
  const minimumVertical = Math.max(24, Math.round(image.height * minimumRatio))
  const horizontal = clusterRuns(findRuns(dark, image.width, image.height, true, minimumHorizontal, maximumGap))
  const vertical = clusterRuns(findRuns(dark, image.width, image.height, false, minimumVertical, maximumGap))
  const scaleX = target.width / Math.max(1, image.width)
  const scaleY = target.height / Math.max(1, image.height)
  const diagonalMinimum = Math.max(24, Math.round(Math.min(image.width, image.height) * minimumRatio))
  const diagonals = options.detectDiagonals === false
    ? []
    : [
        ...findDiagonalRuns(dark, image.width, image.height, 1, diagonalMinimum, maximumGap),
        ...findDiagonalRuns(dark, image.width, image.height, -1, diagonalMinimum, maximumGap)
      ].map((run) => {
        const x1 = run.direction === 1 ? run.start + run.axis : run.axis - run.start
        const x2 = run.direction === 1 ? run.end + run.axis : run.axis - run.end
        return {
          x1: x1 * scaleX,
          y1: run.start * scaleY,
          x2: x2 * scaleX,
          y2: run.end * scaleY,
          lineWidth: Math.max(scaleX, scaleY)
        }
      })
  const detected = [
    ...horizontal.map((cluster) => ({
      x1: cluster.start * scaleX,
      y1: ((cluster.firstAxis + cluster.lastAxis) / 2) * scaleY,
      x2: cluster.end * scaleX,
      y2: ((cluster.firstAxis + cluster.lastAxis) / 2) * scaleY,
      lineWidth: Math.max(scaleY, (cluster.lastAxis - cluster.firstAxis + 1) * scaleY)
    })),
    ...vertical.map((cluster) => ({
      x1: ((cluster.firstAxis + cluster.lastAxis) / 2) * scaleX,
      y1: cluster.start * scaleY,
      x2: ((cluster.firstAxis + cluster.lastAxis) / 2) * scaleX,
      y2: cluster.end * scaleY,
      lineWidth: Math.max(scaleX, (cluster.lastAxis - cluster.firstAxis + 1) * scaleX)
    })),
    ...diagonals
  ]
  const mergeGap = Math.max(1, Math.min(target.width, target.height) * (options.mergeGapRatio ?? 0.006))
  return mergePdfScanLines(detected.slice(0, 4000), mergeGap).slice(0, 4000)
}

export const detectPdfScanCanvasGeometry = (
  canvas: HTMLCanvasElement,
  target: { width: number; height: number },
  options?: PdfScanGeometryOptions
): PdfVectorLine[] => {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return []
  return detectPdfScanGeometry(context.getImageData(0, 0, canvas.width, canvas.height), target, options)
}
