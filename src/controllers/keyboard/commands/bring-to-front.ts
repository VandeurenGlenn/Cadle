import { canvas } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isBringToFront = ({ metaKey, key, ctrlKey, altKey, shiftKey }: KeyboardEvent): boolean =>
  key === 'B' && altKey && shiftKey && (isMac ? metaKey : ctrlKey)

export const bringToFront = () => {
  canvas.shouldRender = true
  canvas.bringObjectToFront(canvas.getActiveObject())
}
