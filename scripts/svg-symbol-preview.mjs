import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { auditSymbols } from './svg-symbols.mjs'

const output = resolve(process.argv[2] ?? join(tmpdir(), 'cadle-symbol-preview.html'))
const results = await auditSymbols()
const selected = process.argv.includes('--all') ? results : results.filter((result) => result.native)

const cards = selected.map((result) => {
  const sourcePath = join(resolve('www/symbols'), result.file)
  const sourceUrl = new URL(`file://${sourcePath}`).href
  return `<article>
    <div class="canvas"><img src="${sourceUrl}" alt=""></div>
    <strong>${basename(result.file, '.svg')}</strong>
    <small>${relative('www/symbols', sourcePath)}</small>
  </article>`
}).join('\n')

await writeFile(output, `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Cadle symbol preview</title>
<style>
  :root { color-scheme: light; font: 13px system-ui; --symbol-stroke: #111; --symbol-fill: #111; }
  body { margin: 24px; background: #eee; color: #222; }
  main { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
  article { display: grid; gap: 7px; padding: 12px; background: white; border: 1px solid #ccc; border-radius: 8px; }
  .canvas { display: grid; place-items: center; height: 160px; background-image: linear-gradient(#ddd 1px, transparent 1px), linear-gradient(90deg, #ddd 1px, transparent 1px); background-size: 12px 12px; }
  img { width: 96px; height: 128px; object-fit: contain; }
  small { color: #666; overflow-wrap: anywhere; }
</style>
<h1>Cadle SVG symbols</h1>
<p>${selected.length} symbols · generated ${new Date().toISOString()}</p>
<main>${cards}</main>
</html>`, 'utf8')

console.log(output)
