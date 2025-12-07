import { canvas } from '../../../utils.js'
import { isMac } from '../utils.js'

export const keyCombination = { key: 'B', shiftKey: true, metaKey: isMac, ctrlKey: !isMac }

export const keys = [isMac ? ['meta', 'shift', 'B'] : ['ctrl', 'shift', 'B']]

export const isBringForward = ({ metaKey, key, ctrlKey, shiftKey }: KeyboardEvent): boolean =>
  key === 'B' && shiftKey && (isMac ? metaKey : ctrlKey)

export const bringForward = () => {
  canvas.shouldRender = true
  const object = canvas.getActiveObject()
  if (object) canvas.bringObjectForward(object)
}
