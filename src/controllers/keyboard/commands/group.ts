import { Group } from 'fabric'
import { field, canvas, getActiveObjects } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isGroup = ({ metaKey, key, ctrlKey }: KeyboardEvent) =>
  key === 'g' && (isMac ? metaKey && ctrlKey : ctrlKey)

export const group = async () => {
  const items = getActiveObjects()
  canvas.discardActiveObject()
  const { left, top } = items[0]?.group ?? items[0]

  for (const item of items) {
    field.canvas.remove(item)
  }

  field.canvas.add(
    new Group(items, {
      left,
      top
    })
  )
}

export const keyCombination = { key: 'g', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'g'] : ['ctrl', 'g']]
