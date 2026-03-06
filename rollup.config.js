import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import { readdir, unlink } from 'fs/promises'
import { join } from 'path'
import { cp } from 'fs/promises'
import materialSymbols from 'rollup-plugin-material-symbols'
import { fileURLToPath } from 'url'

await cp('node_modules/@vandeurenglenn/lit-elements/exports/themes/default', 'www/themes/default', {
  recursive: true
})

const cleanWWWAndCopyWorkers = async () => {
  return {
    name: 'clean-www', // this name will show up in warnings and errors
    generateBundle: async () => {
      const files = await readdir('www')
      for (const file of files) {
        if (
          file.endsWith('.js') &&
          !file.includes('sw.js') &&
          !file.includes('workbox') &&
          !file.endsWith('manifest.js')
        ) {
          await unlink(join('www', file))
        }
      }
      const workerFiles = await readdir('node_modules/pdfjs-dist/build')
      for (const file of workerFiles) {
        if (file.startsWith('pdf.worker') && file.endsWith('.mjs')) {
          await cp(join('node_modules/pdfjs-dist/build', file), join('www', file), {
            recursive: true
          })
        }
      }
    }
  }
}

export default [
  {
    input: [
      './src/shell.ts',
      './src/fields/projects.ts',
      './src/fields/draw.ts',
      './src/fields/settings.ts',
      './src/fields/create-project.ts',
      './node_modules/@leofcoin/storage/exports/browser-store.js'
    ],
    external: ['./symbols/manifest.js', './elements/symbols/manifest.js', '/src/symbols/manifest.js'],
    output: [
      {
        format: 'es',
        dir: './www'
      }
    ],
    plugins: [
      cleanWWWAndCopyWorkers(),
      materialSymbols({
        placeholderPrefix: 'symbol'
      }),
      json(),
      nodeResolve({ browser: true }),
      commonjs(),
      typescript()
    ]
  }
]
