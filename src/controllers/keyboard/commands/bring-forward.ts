import { canvas } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isBringForward = ({ metaKey, key, ctrlKey, shiftKey }: KeyboardEvent): boolean =>
  key === 'B' && shiftKey && (isMac ? metaKey : ctrlKey)

export const bringForward = () => {
  canvas.shouldRender = true
  canvas.bringObjectForward(canvas.getActiveObject())
}
