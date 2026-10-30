const PUSH_BUTTON_PATH = /switches\/(?:(?:illuminated |double )?push button|push switch with safety cover)\.svg$/i

export const renderedSymbolScale = (path: string, scale: number): number =>
  Math.max(PUSH_BUTTON_PATH.test(path) ? 0.2 : 0.4, scale)

/** Keep a symbol's visible pen width unchanged when its geometry is resized. */
export const resizedSymbolStrokeWidth = (
  shape: { path: string; scale: number; strokeWidth?: number },
  nextScale: number
): number | undefined => typeof shape.strokeWidth === 'number'
  ? shape.strokeWidth * renderedSymbolScale(shape.path, shape.scale) / renderedSymbolScale(shape.path, nextScale)
  : undefined
