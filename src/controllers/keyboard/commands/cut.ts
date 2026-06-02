import type { FabricObject } from 'fabric'
import { clipboard, canvas, getActiveObject } from '../../../utils.js'
import { isMac } from '../utils.js'

type FabricObjectWithChildren = FabricObject & { getObjects?: () => FabricObject[] }

export const isCut = ({ metaKey, key, ctrlKey }: KeyboardEvent) => key === 'x' && (isMac ? metaKey : ctrlKey)

export const cut = async () => {
  const object = getActiveObject()
  const items = canvas.getActiveObjects()
  const cloned = await object?.clone()
  clipboard.object = cloned
  for (const item of items) {
    if (item.type === 'activeSelection') {
      const selectionObjects = (item as FabricObjectWithChildren).getObjects?.() ?? []
      for (const _item of selectionObjects) {
        canvas.remove(_item)
      }
    }

    canvas.remove(item)
  }

  canvas.discardActiveObject()
  canvas.shouldRender = true
}

export const keyCombination = { key: 'x', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'x'] : ['ctrl', 'x']]
