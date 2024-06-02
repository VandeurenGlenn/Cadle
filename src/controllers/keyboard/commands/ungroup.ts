import { ActiveSelection, Circle, FabricText, Group, Line, Path, Rect, Textbox, FabricImage } from 'fabric'
import { canvas, getActiveObject } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isUngroup = ({ metaKey, key, ctrlKey }: KeyboardEvent): boolean =>
  key === 'u' && (isMac ? metaKey && ctrlKey : ctrlKey)

const loop = async (items: Group['_objects'], { top, left }) => {
  for (const item of items) {
    if (item instanceof ActiveSelection) {
      await loop(item.getObjects(), { top, left })
    } else if (item instanceof Group) {
      const group = new Group(item._objects)
      group.dirty = true
      canvas.add(group)
    } else {
      let object = item.toObject()
      console.log(object.type)

      if (object.type === 'Rect') object = await Rect.fromObject(object)
      if (object.type === 'Circle') object = await Circle.fromObject(object)
      if (object.type === 'Line') object = await Line.fromObject(object)
      if (object.type === 'Path') object = await Path.fromObject(object)
      if (object.type === 'Text') object = await FabricText.fromObject(object)
      if (object.type === 'Textbox') object = await Textbox.fromObject(object)
      if (object.type === 'Image') object = await FabricImage.fromObject(object)
      object.strokeWidth = 1
      object.top += top
      object.left += left
      canvas.remove(item)
      console.log('rem');
      
      canvas.add(object)
    }
  }
}

export const ungroup = async () => {
  canvas.shouldRender = true
  const object = getActiveObject() as Group
  canvas.discardActiveObject()
  // canvas.remove(object)
  // canvas.requestRenderAll()
  console.log(object);
  
  if (!object) {
    return
  }
  if (object.type !== 'group') {
    return
  }

  await loop(object.getObjects(), {
    top: object.top + object.width / 2,
    left: object.left + object.height / 2
  })
}
