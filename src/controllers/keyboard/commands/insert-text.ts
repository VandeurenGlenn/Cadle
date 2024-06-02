import { canvas } from '../../../utils.js'
import { isMac } from '../utils.js'
import drawText from '../../../draw/text.js'

export const isInsertText = ({ metaKey, key, ctrlKey, altKey }: KeyboardEvent) =>
  key === 't' && (isMac ? metaKey && ctrlKey : ctrlKey && altKey)

export const insertText = () => {
  drawText()
  canvas.shouldRender = true
}
