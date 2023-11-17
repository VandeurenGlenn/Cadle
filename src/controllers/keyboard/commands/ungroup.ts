import { ActiveSelection, FabricText, Group, Path, Rect } from 'fabric'
import { canvas, getActiveObject } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isUngroup = ({ metaKey, key, ctrlKey }: KeyboardEvent): boolean =>
  key === 'u' && (isMac ? metaKey && ctrlKey : ctrlKey)

  
const loop = async (items: Group['_objects'], {top, left}) => {
  for (const item of items) {
    if (item instanceof ActiveSelection) {
      loop(item.getObjects(), {top, left})
    } else if (item instanceof Group) {
      const group = new Group(item._objects)
      group.dirty = true
      canvas.add(group)
    } else {
      let object = item.toObject()
      
      if (object.type === 'Rect') object = await Rect.fromObject(object)
      if (object.type === 'Path') object = await Path.fromObject(object)
      if (object.type === 'Text') object = await FabricText.fromObject(object)
      object.top += top
      object.left += left
      canvas.remove(item)
      canvas.add(object)
    }
  }
}
  
export const ungroup = async () => {
  const object = getActiveObject() as Group  
  canvas.discardActiveObject()
  canvas.remove(object)
  canvas.requestRenderAll()
  if (!object) {
    return;
  }
  if (object.type !== 'group') {
    return;
  }

  await loop(object.getObjects(), {
    top: object.top + (object.width / 2),
    left: object.left + (object.height / 2)
  })
  canvas.shouldRender = true
}
