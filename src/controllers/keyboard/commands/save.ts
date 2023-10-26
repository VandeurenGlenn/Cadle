import { shell } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isSave = ({metaKey, key, ctrlKey}: KeyboardEvent) => key === 's' && isMac ? metaKey : ctrlKey

export const save = () => shell.save()