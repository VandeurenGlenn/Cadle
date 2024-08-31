import { ActiveSelection, Circle, FabricText, Group, Line, Path, Rect, Textbox, FabricImage, Ellipse } from 'fabric'
import { canvas, getActiveObject } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isUngroup = ({ metaKey, key, ctrlKey }: KeyboardEvent): boolean =>
  key === 'u' && (isMac ? metaKey && ctrlKey : ctrlKey)

const loop = async (items: Group['_objects'], { top, left }) => {
  for (const item of items) {
    console.log({ isGroup: item instanceof Group })
    console.log(item.type)

    // if (item instanceof ActiveSelection) {
    //   await loop(item.getObjects(), { top, left })
    //   await canvas.remove(item)
    // } else if (item instanceof Group) {
    //   await loop(item.getObjects(), { top, left })
    //   await canvas.remove(item)
    // } else {
    let object
    if (item.type !== 'group') object = item.toObject()
    switch (item.type) {
      case 'rect':
        object = await Rect.fromObject(object)
        break
      case 'circle':
        object = await Circle.fromObject(object)
        break
      case 'line':
        object = await Line.fromObject(object)
        break
      case 'path':
        object = await Path.fromObject(object)
        break
      case 'text':
        object = await FabricText.fromObject(object)
        break
      case 'textbox':
        object = await Textbox.fromObject(object)
        break
      case 'image':
        object = await FabricImage.fromObject(object)
        break
      case 'ellipse':
        object = await Ellipse.fromObject(object)
        break
      case 'group':
        // item.group = undefined
        // await loop(item.getObjects(), { top, left })

        canvas.remove(item)
        item.set({ left: left + item.left, top: top + item.top })
        canvas.add(await item.clone())
        break
      default:
        alert(`encountered unsupported type ${item.type}`)
        break
    }
    if (object) {
      object.strokeWidth = 1
      object.top += top
      object.left += left
      canvas.requestRenderAll()
      canvas.add(object)
    }

    // }
  }
  console.log('done')

  canvas.discardActiveObject()
}

export const ungroup = async () => {
  canvas.shouldRender = true
  const object = getActiveObject() as Group
  canvas.remove(object)
  // canvas.requestRenderAll()

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

  // canvas.remove(object)
}
