import type { FabricObject } from 'fabric'
import { canvas, getActiveObjects, history } from '../../../utils.js'
import { isMac } from '../utils.js'

type FabricObjectWithChildren = FabricObject & { getObjects?: () => FabricObject[] }

export const isRemove = ({ metaKey, ctrlKey, key }: KeyboardEvent) =>
  key === 'Delete' ? true : key === 'Backspace' && (isMac ? metaKey : ctrlKey)

export const remove = () => {
  canvas.shouldRender = true

  const objects = getActiveObjects()
  canvas.discardActiveObject()
  // todo is this really needed?
  for (const object of objects) {
    if (object.type === 'activeSelection') {
      const selectionObjects = (object as FabricObjectWithChildren).getObjects?.() ?? []
      for (const _object of selectionObjects) {
        canvas.remove(_object)
      }
    }

    history.push({ type: 'remove', object, objects: [object] })
    canvas.remove(object)
  }
}

export const keyCombination = { key: 'Delete / Backspace', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'Backspace'] : ['Delete'], !isMac ? ['ctrl', 'Backspace'] : []]
