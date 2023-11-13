import { Group } from 'fabric'
import { clipboard, field, getActiveObjects, canvas } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isCut = ({metaKey, key, ctrlKey}: KeyboardEvent) => key === 'x' && (isMac ? metaKey : ctrlKey)

export const cut = async () => {
  const items = getActiveObjects()
  // @ts-ignore
  const group = new Group(items)
  clipboard.object = group

  for (const item of items) {
    if (item.type === 'activeselection') {
      // @ts-ignore
      for (const _item of item._objects) {
        canvas.remove(_item)
      }
    }
    canvas.remove(item)
  }

  canvas.discardActiveObject();
  canvas.shouldRender = true
}