import { Group } from 'fabric'
import { canvas, clipboard, getActiveObjects } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isCopy = ({ metaKey, key, ctrlKey }: KeyboardEvent) => key === 'c' && (isMac ? metaKey : ctrlKey)

export const copy = async () => {
  const cloned = getActiveObjects()
  canvas.discardActiveObject()

  if (cloned.length > 1) {
    const items = []
    for (const item of cloned) {
      items.push(item.clone())
    }
    clipboard.object = new Group(await Promise.all(items))
  } else {
    clipboard.object = await cloned[0].clone()
  }

  navigator.clipboard.writeText(JSON.stringify(clipboard.object))
  // clipboard.object = cloned.type === 'group' ? cloned : new Group(cloned._objects, {
  //   subTargetCheck: true,
  //   interactive: true
  // })
}

export const keyCombination = { key: 'c', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'c'] : ['ctrl', 'c']]
