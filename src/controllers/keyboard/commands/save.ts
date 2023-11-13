import { shell } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isSave = ({metaKey, key, ctrlKey}: KeyboardEvent): boolean =>
  key === 's' && (isMac ? metaKey : ctrlKey)

// @ts-ignore
export const save = () => shell.save()
