import './fields/projects.js'

const afterPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })

const projects = document.querySelector('projects-field')

if (projects) {
  await customElements.whenDefined('projects-field')
  await afterPaint()

  // Projects is already hydrated and painted. Load the shell behind it, then
  // hand the document over once the full application is ready.
  try {
    await import('./shell.js')
    projects.replaceWith(document.createElement('app-shell'))
  } catch (error) {
    console.error('Failed to load Cadle shell', error)
  }
}
