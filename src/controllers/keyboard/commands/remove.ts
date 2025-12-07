import { canvas, getActiveObjects } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isRemove = ({ metaKey, ctrlKey, key }: KeyboardEvent) =>
  key === 'Delete' ? true : key === 'Backspace' && (isMac ? metaKey : ctrlKey)

export const remove = () => {
  canvas.shouldRender = true

  let items = canvas.getActiveObjects()
  canvas.discardActiveObject()
  // todo is this really needed?
  for (const item of items) {
    if (item.type === 'activeselection') {
      // @ts-ignore
      for (const _item of item._objects) {
        canvas.remove(_item)
      }
    }
    canvas.history.push({ type: 'remove', item })
    canvas.remove(item)
  }
}

export const keyCombination = { key: 'Delete / Backspace', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'Backspace'] : ['Delete'], !isMac ? ['ctrl', 'Backspace'] : []]
