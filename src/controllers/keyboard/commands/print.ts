export const isPrint = (event: KeyboardEvent) => event.key === 'p' && event.ctrlKey

export const print = (event: KeyboardEvent) => {
  event.preventDefault()
}

export const keyCombination = { key: 'p', ctrlKey: true }
export const keys = [['ctrl', 'p']]
