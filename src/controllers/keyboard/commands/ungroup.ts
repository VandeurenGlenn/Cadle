import { canvas, getActiveObjects } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isUngroup = ({ metaKey, key, ctrlKey }: KeyboardEvent): boolean =>
  key === 'u' && (isMac ? metaKey && ctrlKey : ctrlKey)

export const ungroup = (): void => {
  const items = getActiveObjects()
  canvas.discardActiveObject()
  // @ts-expect-error dispose does exist
  items[0].dispose()
  canvas.remove(items[0])
  // @ts-expect-error _objects exists
  const objects = items[0]._objects
  if (objects) {
    for (const item of objects) {
      item.set('dirty', true)
      canvas.add(item)
    }
  }
  canvas.shouldRender = true
}
