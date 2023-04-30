import { readdir, writeFile } from 'fs/promises'
import { join } from 'path'

const categories = await readdir('./www/symbols')
const manifest = []

for (const category of categories) {
  if (category !== '.DS_Store' && category !== 'manifest.js') {
    const symbols = await readdir(join('./www/symbols', category))
    manifest.push({ category, symbols })
  }
  
}

writeFile('./www/symbols/manifest.js', `export default ${JSON.stringify(manifest, null, '\t')}`)