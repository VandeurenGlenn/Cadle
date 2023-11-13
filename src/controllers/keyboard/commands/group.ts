import { Group } from 'fabric'
import { field, getActiveObjects } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isGroup = ({metaKey, key, ctrlKey}: KeyboardEvent) => key === 'g' && (isMac ? metaKey && ctrlKey : ctrlKey)

export const group = async () => {
  let items = getActiveObjects()
  const {left, top} = items[0].group;
  
  for (const item of items) {
    field.canvas.remove(item)
  }
  
  // @ts-ignore
  field.canvas.add(new Group(items, {
    left,
    top
  }))
}