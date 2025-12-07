import { canvas, getActiveObjects, history } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isRemove = ({ metaKey, ctrlKey, key }: KeyboardEvent) =>
  key === 'Delete' ? true : key === 'Backspace' && (isMac ? metaKey : ctrlKey)

export const remove = () => {
  canvas.shouldRender = true

  let objects = canvas.getActiveObjects()
  canvas.discardActiveObject()
  // todo is this really needed?
  for (const object of objects) {
    if (object.type === 'activeselection') {
      // @ts-ignore
      for (const _object of object._objects) {
        canvas.remove(_object)
      }
    }
    history.push({ type: 'remove', object })
    canvas.remove(object)
  }
}

export const keyCombination = { key: 'Delete / Backspace', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'Backspace'] : ['Delete'], !isMac ? ['ctrl', 'Backspace'] : []]
