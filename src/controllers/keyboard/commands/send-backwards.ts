import { canvas } from '../../../utils.js'
import { isMac } from '../utils.js'
export { save } from '../../../api/project.js'

export const isSendBackwards = ({ metaKey, key, ctrlKey, altKey }: KeyboardEvent): boolean =>
  key === 'b' && altKey && (isMac ? metaKey : ctrlKey)

export const sendBackwards = () => {
  canvas.shouldRender = true
  canvas.sendObjectBackwards(canvas.getActiveObject())
}
