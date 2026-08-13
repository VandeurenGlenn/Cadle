type PixelData = { data: Uint8ClampedArray; width: number; height: number }

export type PdfScanQuality = {
  contrast: number
  sharpness: number
  skewDegrees: number
  warnings: string[]
}

const luminance = (data: Uint8ClampedArray, index: number) =>
  data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722

const percentile = (histogram: Uint32Array, total: number, ratio: number) => {
  const target = total * ratio
  let count = 0
  for (let value = 0; value < histogram.length; value += 1) {
    count += histogram[value]
    if (count >= target) return value
  }
  return 255
}

const usefulRange = (histogram: Uint32Array, total: number) => {
  let low = percentile(histogram, total, 0.04)
  let high = percentile(histogram, total, 0.96)
  // Floor plans often contain less than 4% ink. In that case both central
  // percentiles are the paper colour, so include the sparse dark strokes.
  if (high - low < 24) {
    low = percentile(histogram, total, 0.001)
    high = percentile(histogram, total, 0.999)
  }
  return { low, high }
}

const projectionScore = (points: Array<{ x: number; y: number }>, width: number, height: number, angle: number) => {
  const radians = angle * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const rows = new Uint16Array(Math.ceil(height + width * Math.abs(sine)) + 4)
  const columns = new Uint16Array(Math.ceil(width + height * Math.abs(sine)) + 4)
  for (const point of points) {
    const x = point.x * cosine - point.y * sine
    const y = point.x * sine + point.y * cosine
    const row = Math.round(y + width * Math.abs(sine) / 2)
    const column = Math.round(x + height * Math.abs(sine) / 2)
    if (row >= 0 && row < rows.length) rows[row] += 1
    if (column >= 0 && column < columns.length) columns[column] += 1
  }
  let score = 0
  for (const value of rows) score += value * value
  for (const value of columns) score += value * value
  return score
}

export const analyzePdfScanQuality = (image: PixelData): PdfScanQuality => {
  const histogram = new Uint32Array(256)
  const gray = new Uint8Array(image.width * image.height)
  const points: Array<{ x: number; y: number }> = []
  const sampleStep = Math.max(1, Math.ceil(Math.sqrt(image.width * image.height / 60_000)))
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixelIndex = y * image.width + x
      const value = Math.round(luminance(image.data, pixelIndex * 4))
      gray[pixelIndex] = value
      histogram[value] += 1
      if (value < 140 && x % sampleStep === 0 && y % sampleStep === 0) points.push({ x, y })
    }
  }
  const { low, high } = usefulRange(histogram, gray.length)
  const contrast = (high - low) / 255
  let edgeEnergy = 0
  let edgeSamples = 0
  for (let y = 1; y < image.height - 1; y += sampleStep) {
    for (let x = 1; x < image.width - 1; x += sampleStep) {
      const index = y * image.width + x
      edgeEnergy += Math.abs(gray[index - 1] - gray[index + 1]) + Math.abs(gray[index - image.width] - gray[index + image.width])
      edgeSamples += 2
    }
  }
  const sharpness = Math.min(1, edgeEnergy / Math.max(1, edgeSamples) / 36)
  let skewDegrees = 0
  let bestScore = -1
  if (points.length >= 20) {
    for (let angle = -3; angle <= 3.001; angle += 0.5) {
      const score = projectionScore(points, image.width, image.height, angle)
      if (score > bestScore) {
        bestScore = score
        skewDegrees = Math.round(angle * 10) / 10
      }
    }
  }
  if (Math.abs(skewDegrees) < 0.75) skewDegrees = 0
  const warnings: string[] = []
  if (contrast < 0.42) warnings.push('Low contrast scan; Cadle enhanced black and white separation.')
  if (sharpness < 0.18) warnings.push('Soft or low-resolution scan; review small symbols carefully.')
  if (Math.abs(skewDegrees) >= 0.75) warnings.push(`Scan was straightened by ${Math.abs(skewDegrees).toFixed(1)}°.`)
  return { contrast, sharpness, skewDegrees, warnings }
}

export const enhancePdfScanPixels = (image: PixelData): ImageData => {
  const histogram = new Uint32Array(256)
  for (let index = 0; index < image.data.length; index += 4) histogram[Math.round(luminance(image.data, index))] += 1
  const pixels = image.width * image.height
  const range = usefulRange(histogram, pixels)
  const low = range.low
  const high = Math.max(low + 1, range.high)
  const output = new Uint8ClampedArray(image.data.length)
  for (let index = 0; index < image.data.length; index += 4) {
    const value = Math.max(0, Math.min(255, (luminance(image.data, index) - low) * 255 / (high - low)))
    const contrasted = value < 128 ? Math.max(0, value * 0.82) : Math.min(255, 255 - (255 - value) * 0.72)
    output[index] = output[index + 1] = output[index + 2] = Math.round(contrasted)
    output[index + 3] = image.data[index + 3]
  }
  return new ImageData(output, image.width, image.height)
}

export const preparePdfScanCanvas = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return { canvas, quality: { contrast: 1, sharpness: 1, skewDegrees: 0, warnings: [] } as PdfScanQuality }
  const source = context.getImageData(0, 0, canvas.width, canvas.height)
  const quality = analyzePdfScanQuality(source)
  const enhanced = document.createElement('canvas')
  enhanced.width = canvas.width
  enhanced.height = canvas.height
  const enhancedContext = enhanced.getContext('2d')!
  const pixels = enhancePdfScanPixels(source)
  const pixelCanvas = document.createElement('canvas')
  pixelCanvas.width = canvas.width
  pixelCanvas.height = canvas.height
  pixelCanvas.getContext('2d')!.putImageData(pixels, 0, 0)
  enhancedContext.fillStyle = '#ffffff'
  enhancedContext.fillRect(0, 0, enhanced.width, enhanced.height)
  if (quality.skewDegrees) {
    enhancedContext.translate(enhanced.width / 2, enhanced.height / 2)
    enhancedContext.rotate(-quality.skewDegrees * Math.PI / 180)
    enhancedContext.drawImage(pixelCanvas, -enhanced.width / 2, -enhanced.height / 2)
  } else {
    enhancedContext.drawImage(pixelCanvas, 0, 0)
  }
  return { canvas: enhanced, quality }
}
