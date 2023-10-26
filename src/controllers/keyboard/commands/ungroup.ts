import { Group } from 'fabric'
import { field, canvas, getActiveObjects } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isUngroup = ({metaKey, key, ctrlKey}: KeyboardEvent) => key === 'u' && isMac ? metaKey && ctrlKey : ctrlKey

export const ungroup = async () => {
  let items = getActiveObjects()
  canvas.discardActiveObject();
  // @ts-ignore
  items[0].dispose()
  field.canvas.remove(items[0])
  // @ts-ignore
  for(const item of items[0]._objects) {
    item.set('dirty', true)
    canvas.add(item);
   }
   canvas.shouldRender = true
}