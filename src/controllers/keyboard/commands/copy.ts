import { Group } from 'fabric'
import { clipboard, field, getActiveObjects, canvas, removeItems } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isCopy = ({metaKey, key, ctrlKey}: KeyboardEvent) => key === 'c' && (isMac ? metaKey : ctrlKey)

export const copy = async () => {
  const items = getActiveObjects()
  const {left, top} = items[0].group || items[0];
  canvas.discardActiveObject()
  
  // @ts-ignore
  // @ts-ignore
  const group = new Group(items, { left, top })
  removeItems(items)
   field.canvas.add(group)
  canvas.renderAll()
  clipboard.object = await group.clone()
}