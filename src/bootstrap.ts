import './fields/projects.js'

const projects = document.querySelector('projects-field') as (Element & { rendered: Promise<unknown> }) | null

if (projects) {
  await customElements.whenDefined('projects-field')
  await projects.rendered

  // Projects is already hydrated and painted. Load the shell behind it, then
  // hand the document over once the full application is ready.
  try {
    await import('./shell.js')
    const shell = document.createElement('app-shell')
    projects.parentElement?.replaceChild(shell, projects)
  } catch (error) {
    console.error('Failed to load Cadle shell', error)
  }
}
