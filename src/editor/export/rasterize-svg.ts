export type PageOrientation = 'portrait' | 'landscape'

export const pagePixelSize = (orientation: PageOrientation) => ({
  widthPx: orientation === 'landscape' ? 3508 : 2480,
  heightPx: orientation === 'landscape' ? 2480 : 3508
})

export const rasterizeSvgToPng = async (
  svgString: string,
  widthPx: number,
  heightPx: number,
  errorMessage = 'Unable to render SVG'
): Promise<string> => {
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const candidate = new Image(widthPx, heightPx)
    candidate.onload = () => resolve(candidate)
    candidate.onerror = () => reject(new Error(errorMessage))
    candidate.src = source
  })
  const canvas = document.createElement('canvas')
  canvas.width = widthPx
  canvas.height = heightPx
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas export is unavailable')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, widthPx, heightPx)
  context.drawImage(image, 0, 0, widthPx, heightPx)
  return canvas.toDataURL('image/png')
}

export const rasterizePageSvgToPng = async (
  svgString: string,
  orientation: PageOrientation,
  errorMessage?: string
) => {
  const { widthPx, heightPx } = pagePixelSize(orientation)
  return rasterizeSvgToPng(svgString, widthPx, heightPx, errorMessage)
}
