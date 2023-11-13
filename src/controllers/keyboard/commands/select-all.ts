import { ActiveSelection } from 'fabric'
import { canvas } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isSelectAll = ({ metaKey, ctrlKey, key }: KeyboardEvent): boolean =>
  key === 'a' && (isMac ? metaKey : ctrlKey)

export const selectAll = (): void => {
  canvas.discardActiveObject()
  // @ts-expect-error  fabric object works but some type error somewhere
  const selection = new ActiveSelection(canvas.getObjects(), { canvas })
  // @ts-expect-error  fabric object works but some type error somewhere
  canvas.setActiveObject(selection)
}
