import { Group } from 'fabric'
import { clipboard, field, getActiveObjects, canvas } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isCut = ({metaKey, key, ctrlKey}: KeyboardEvent) => key === 'x' && isMac ? metaKey : ctrlKey

export const cut = async () => {
  const items = getActiveObjects()
  const group = new Group()
  // @ts-ignore
  group.add(items)
  clipboard.object = group

  for (const item of items) {
    if (item.type === 'activeselection') {
      // @ts-ignore
      for (const _item of item._objects) {
        field.canvas.remove(_item)
      }
    }
    canvas.remove(item)
  }

  canvas.discardActiveObject();
  canvas.shouldRender = true
}