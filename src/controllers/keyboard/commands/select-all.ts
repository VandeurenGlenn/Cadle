import { ActiveSelection } from 'fabric'
import { canvas } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isSelectAll = ({ metaKey, ctrlKey, key }: KeyboardEvent): boolean =>
  key === 'a' && (isMac ? metaKey : ctrlKey)

export const selectAll = (): void => {
  const canvas_ = canvas as any
  canvas_.discardActiveObject()
  const selection = new ActiveSelection(canvas_.getObjects(), { canvas: canvas_ as any })
  canvas_.setActiveObject(selection)
}

export const keyCombination = { key: 'a', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'a'] : ['ctrl', 'a']]
