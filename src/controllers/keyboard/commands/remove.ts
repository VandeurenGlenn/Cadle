import { canvas, getActiveObjects } from "../../../utils.js"
import { isMac } from "../utils.js"

export const isRemove = ({ metaKey, ctrlKey, key }: KeyboardEvent) => key === 'Backspace' && isMac ? metaKey : ctrlKey

export const remove = () => {
  let items = getActiveObjects()
  // todo is this really needed?
  for (const item of items) {
    if (item.type === 'activeselection') {
      // @ts-ignore
      for (const _item of item._objects) {
        canvas.remove(_item)
      }
    }
    canvas.remove(item)
    canvas.discardActiveObject();
  }
}
