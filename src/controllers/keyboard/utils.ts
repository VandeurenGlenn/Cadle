export const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform)

export const isPrimaryShortcut = (event: KeyboardEvent): boolean => (isMac ? event.metaKey : event.ctrlKey)

const isEditableElement = (element: HTMLElement): boolean => {
  const tagName = element.tagName
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true
  if (element.isContentEditable) return true
  if (element.getAttribute('role') === 'textbox') return true
  if (element.localName.endsWith('-text-field')) return true
  return Boolean(element.closest('md-outlined-text-field, md-filled-text-field, md-outlined-select, md-filled-select'))
}

const activeElementChain = (): Element[] => {
  const elements: Element[] = []
  let root: Document | ShadowRoot = document
  let activeElement = root.activeElement

  while (activeElement) {
    elements.push(activeElement)
    if (!(activeElement instanceof HTMLElement) || !activeElement.shadowRoot) break
    root = activeElement.shadowRoot
    activeElement = root.activeElement
  }

  return elements
}

export const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && isEditableElement(target)

export const isEditableKeyboardEvent = (event: KeyboardEvent): boolean => {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  if (path.some((target) => target instanceof HTMLElement && isEditableElement(target))) return true
  return activeElementChain().some((element) => element instanceof HTMLElement && isEditableElement(element))
}
