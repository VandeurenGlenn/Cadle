import type { PdfVectorText } from './pdf-vector-conversion.js'

type PixelData = { data: Uint8ClampedArray; width: number; height: number }
type Component = { pixels: Array<{ x: number; y: number }>; minX: number; minY: number; maxX: number; maxY: number }

const createDarkMap = (image: PixelData, threshold = 150) => {
  const dark = new Uint8Array(image.width * image.height)
  for (let index = 0; index < dark.length; index += 1) {
    const offset = index * 4
    const luminance = image.data[offset] * 0.2126 + image.data[offset + 1] * 0.7152 + image.data[offset + 2] * 0.0722
    dark[index] = image.data[offset + 3] >= 64 && luminance < threshold ? 1 : 0
  }
  return dark
}

const connectedComponents = (dark: Uint8Array, width: number, height: number): Component[] => {
  const visited = new Uint8Array(dark.length)
  const components: Component[] = []
  for (let index = 0; index < dark.length; index += 1) {
    if (!dark[index] || visited[index]) continue
    const queue = [index]
    const pixels: Array<{ x: number; y: number }> = []
    visited[index] = 1
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    let tooLarge = false
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor]
      const x = current % width
      const y = Math.floor(current / width)
      if (pixels.length < 12000) pixels.push({ x, y })
      else tooLarge = true
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const neighbor = ny * width + nx
          if (dark[neighbor] && !visited[neighbor]) {
            visited[neighbor] = 1
            queue.push(neighbor)
          }
        }
      }
    }
    if (pixels.length < 12 || tooLarge) continue
    components.push({ pixels, minX, minY, maxX, maxY })
  }
  return components
}

const hasDarkNear = (dark: Uint8Array, width: number, height: number, x: number, y: number, radius = 1) => {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const px = Math.round(x + dx)
      const py = Math.round(y + dy)
      if (px >= 0 && py >= 0 && px < width && py < height && dark[py * width + px]) return true
    }
  }
  return false
}

const lightPointConfidence = (component: Component, dark: Uint8Array, pageWidth: number, pageHeight: number) => {
  const width = component.maxX - component.minX + 1
  const height = component.maxY - component.minY + 1
  if (width < 9 || height < 9 || width > Math.min(pageWidth, pageHeight) * 0.08) return 0
  if (Math.min(width, height) / Math.max(width, height) < 0.78) return 0
  const centerX = (component.minX + component.maxX) / 2
  const centerY = (component.minY + component.maxY) / 2
  const radiusX = width * 0.46
  const radiusY = height * 0.46
  let ringHits = 0
  const ringSamples = 32
  for (let index = 0; index < ringSamples; index += 1) {
    const angle = index / ringSamples * Math.PI * 2
    if (hasDarkNear(dark, pageWidth, pageHeight, centerX + Math.cos(angle) * radiusX, centerY + Math.sin(angle) * radiusY)) ringHits += 1
  }
  let diagonalOne = 0
  let diagonalTwo = 0
  const diagonalSamples = 11
  for (let index = 1; index < diagonalSamples - 1; index += 1) {
    const fraction = index / (diagonalSamples - 1)
    const x = component.minX + fraction * (width - 1)
    diagonalOne += Number(hasDarkNear(dark, pageWidth, pageHeight, x, component.minY + fraction * (height - 1)))
    diagonalTwo += Number(hasDarkNear(dark, pageWidth, pageHeight, x, component.maxY - fraction * (height - 1)))
  }
  const ringScore = ringHits / ringSamples
  const diagonalScore = Math.min(diagonalOne, diagonalTwo) / (diagonalSamples - 2)
  return ringScore >= 0.55 && diagonalScore >= 0.55
    ? Math.round(Math.min(99, 70 + ringScore * 15 + diagonalScore * 15))
    : 0
}

type NormalizedPoint = { x: number; y: number }

const signatureScore = (
  component: Component,
  dark: Uint8Array,
  pageWidth: number,
  pageHeight: number,
  points: readonly NormalizedPoint[]
) => {
  const width = component.maxX - component.minX + 1
  const height = component.maxY - component.minY + 1
  const radius = Math.max(1, Math.round(Math.min(width, height) * 0.045))
  let hits = 0
  for (const sample of points) {
    if (hasDarkNear(
      dark,
      pageWidth,
      pageHeight,
      component.minX + sample.x * (width - 1),
      component.minY + sample.y * (height - 1),
      radius
    )) hits += 1
  }
  return hits / Math.max(1, points.length)
}

const arcPoints = (cx: number, cy: number, rx: number, ry: number, from: number, to: number, count: number) =>
  Array.from({ length: count }, (_, index) => {
    const angle = from + (to - from) * index / Math.max(1, count - 1)
    return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry }
  })

const linePoints = (x1: number, y1: number, x2: number, y2: number, count: number) =>
  Array.from({ length: count }, (_, index) => {
    const fraction = index / Math.max(1, count - 1)
    return { x: x1 + (x2 - x1) * fraction, y: y1 + (y2 - y1) * fraction }
  })

const transformSignature = (points: readonly NormalizedPoint[], flipX: boolean, flipY: boolean) =>
  points.map(({ x, y }) => ({ x: flipX ? 1 - x : x, y: flipY ? 1 - y : y }))

const bestSignatureScore = (
  component: Component,
  dark: Uint8Array,
  pageWidth: number,
  pageHeight: number,
  points: readonly NormalizedPoint[]
) => Math.max(...[
  transformSignature(points, false, false),
  transformSignature(points, true, false),
  transformSignature(points, false, true),
  transformSignature(points, true, true)
].map((candidate) => signatureScore(component, dark, pageWidth, pageHeight, candidate)))

const SWITCH_SIGNATURE = [
  ...arcPoints(0.34, 0.76, 0.29, 0.20, 0, Math.PI * 2, 28),
  ...linePoints(0.48, 0.58, 0.94, 0.05, 14)
]

const SOCKET_SIGNATURE = [
  ...linePoints(0.40, 0.04, 0.40, 0.96, 22),
  ...linePoints(0.04, 0.50, 0.40, 0.50, 9),
  ...arcPoints(0.40, 0.50, 0.58, 0.41, -Math.PI / 2, Math.PI / 2, 22)
]

const legacyDeviceSuggestion = (
  component: Component,
  dark: Uint8Array,
  pageWidth: number,
  pageHeight: number
): { text: 'schakelaar' | 'stopcontact'; confidence: number } | null => {
  const width = component.maxX - component.minX + 1
  const height = component.maxY - component.minY + 1
  const minimum = Math.min(width, height)
  const maximum = Math.max(width, height)
  if (minimum < 9 || maximum > Math.min(pageWidth, pageHeight) * 0.09) return null
  const aspect = maximum / minimum
  if (aspect > 2.4) return null
  const switchScore = bestSignatureScore(component, dark, pageWidth, pageHeight, SWITCH_SIGNATURE)
  const socketScore = bestSignatureScore(component, dark, pageWidth, pageHeight, SOCKET_SIGNATURE)
  const best = Math.max(switchScore, socketScore)
  if (best < 0.72 || Math.abs(switchScore - socketScore) < 0.08) return null
  return best === switchScore
    ? { text: 'schakelaar', confidence: Math.min(84, Math.round(58 + switchScore * 28)) }
    : { text: 'stopcontact', confidence: Math.min(84, Math.round(58 + socketScore * 28)) }
}

export const detectPdfScanSymbols = (
  image: PixelData,
  target: { width: number; height: number }
): PdfVectorText[] => {
  const dark = createDarkMap(image)
  const scaleX = target.width / Math.max(1, image.width)
  const scaleY = target.height / Math.max(1, image.height)
  return connectedComponents(dark, image.width, image.height).flatMap((component) => {
    const confidence = lightPointConfidence(component, dark, image.width, image.height)
    const suggestion = confidence ? { text: 'lichtpunt' as const, confidence } : legacyDeviceSuggestion(component, dark, image.width, image.height)
    if (!suggestion) return []
    return [{
      text: suggestion.text,
      x: ((component.minX + component.maxX) / 2) * scaleX,
      y: ((component.minY + component.maxY) / 2) * scaleY,
      fontSize: Math.max(2, (component.maxY - component.minY + 1) * scaleY),
      confidence: suggestion.confidence
    }]
  })
}

export const detectPdfScanCanvasSymbols = (
  canvas: HTMLCanvasElement,
  target: { width: number; height: number }
) => {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return []
  return detectPdfScanSymbols(context.getImageData(0, 0, canvas.width, canvas.height), target)
}
