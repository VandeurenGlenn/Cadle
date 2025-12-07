import { canvas } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isBringToFront = ({ metaKey, key, ctrlKey, altKey, shiftKey }: KeyboardEvent): boolean =>
  key === 'B' && altKey && shiftKey && (isMac ? metaKey : ctrlKey)

export const bringToFront = () => {
  canvas.shouldRender = true
  const object = canvas.getActiveObject()
  if (object) canvas.bringObjectToFront(object)
}

export const keyCombination = { key: 'B', altKey: true, shiftKey: true, metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'alt', 'shift', 'B'] : ['ctrl', 'alt', 'shift', 'B']]
