import { clipboard, canvas, getActiveObject } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isCut = ({ metaKey, key, ctrlKey }: KeyboardEvent) => key === 'x' && (isMac ? metaKey : ctrlKey)

export const cut = async () => {
  const object = getActiveObject()
  const cloned = await object?.clone()
  clipboard.object = cloned
  // @ts-ignore
  for (const item of items) {
    if (item.type === 'activeselection') {
      // @ts-ignore
      for (const _item of item._objects) {
        canvas.remove(_item)
      }
    }
    canvas.remove(item)
  }
  canvas.discardActiveObject()
  canvas.shouldRender = true
}
export const keyCombination = { key: 'x', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'x'] : ['ctrl', 'x']]
