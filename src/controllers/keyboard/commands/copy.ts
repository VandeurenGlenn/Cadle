import { ActiveSelection, Group } from 'fabric'
import { clipboard, getActiveObject } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isCopy = ({ metaKey, key, ctrlKey }: KeyboardEvent) => key === 'c' && (isMac ? metaKey : ctrlKey)

export const copy = async () => {
  const cloned = (await getActiveObject()?.clone()) as ActiveSelection

  clipboard.object = cloned

  // clipboard.object = cloned.type === 'group' ? cloned : new Group(cloned._objects, {
  //   subTargetCheck: true,
  //   interactive: true
  // })
}
