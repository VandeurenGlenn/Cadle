import { canvas } from '../../../utils.js'
import { isMac } from '../utils.js'
export { save } from '../../../api/project.js'

export const isSendToBack = ({ metaKey, key, ctrlKey }: KeyboardEvent): boolean =>
  key === 'b' && (isMac ? metaKey : ctrlKey)

export const sendToBack = () => {
  canvas.shouldRender = true
  canvas.sendObjectToBack(canvas.getActiveObject())
}
