const shell = document.querySelector('app-shell')
const pages = shell.renderRoot.querySelector('custom-pages')

onhashchange = async () => {
  
  let parts = location.hash.split('#!/')
  
  parts = parts[1].includes('?') ? parts[1].split('?') : [parts[1]]
  const params = parts[1]
  const selected = parts[0]
  if (!customElements.get(`${selected}-field`)) await import(`./${selected}-field.js`)
  pages.select(selected)
}

if (!location.hash) location.hash = '#!/projects'
else onhashchange()