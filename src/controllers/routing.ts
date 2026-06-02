import { CustomPages } from '@vandeurenglenn/lite-elements/pages.js'

const shell = document.querySelector('app-shell')
const pages = shell?.shadowRoot?.querySelector('custom-pages') as unknown as CustomPages | null

window.onhashchange = async () => {
  let parts = location.hash.split('#!/')

  parts = parts[1].includes('?') ? parts[1].split('?') : [parts[1]]
  const params = parts[1]
  const selected = parts[0]
  console.log(params)

  if (!customElements.get(`${selected}-field`)) await import(`./${selected}.js`)
  pages.select(selected)
}

location.hash = '#!/projects'
window.onhashchange?.(
  new HashChangeEvent('hashchange', {
    oldURL: location.href,
    newURL: location.href
  })
)
