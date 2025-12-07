import { canvas } from '../../../utils.js'
import { isMac } from '../utils.js'
import drawText from '../../../draw/text.js'

export const isInsertText = ({ metaKey, key, ctrlKey, altKey }: KeyboardEvent) =>
  key === 't' && (isMac ? metaKey && ctrlKey : ctrlKey && altKey)

export const insertText = () => {
  drawText()
  canvas.shouldRender = true
}

export const keyCombination = { key: 't', metaKey: isMac, ctrlKey: !isMac, altKey: true }
export const keys = [isMac ? ['meta', 'ctrl', 't'] : ['ctrl', 'alt', 't']]
