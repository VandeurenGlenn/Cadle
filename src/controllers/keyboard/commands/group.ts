import { Group } from 'fabric'
import { field, canvas, getActiveObjects } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isGroup = ({ metaKey, key, ctrlKey }: KeyboardEvent) =>
  key === 'g' && (isMac ? metaKey && ctrlKey : ctrlKey)

export const group = async () => {
  let items = getActiveObjects()
  canvas.discardActiveObject()
  let { left, top } = items[0]?.group ?? items[0]

  for (const item of items) {
    field.canvas.remove(item)
  }

  // @ts-ignore
  field.canvas.add(
    new Group(items, {
      left,
      top
    })
  )
}
