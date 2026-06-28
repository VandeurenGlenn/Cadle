import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import materialSymbols from 'rollup-plugin-material-symbols'
import cleanWWW from './rollup/clean-www.js'
import copyPdfWorker from './rollup/copy-pdf-worker.js'
import copyStatic from './rollup/copy-static.js'
import { cssModules } from 'rollup-plugin-css-modules'

// Hand-authored assets (src/index.html, src/themes/**) are copied into www/
// at build start by copyStatic. The bundled JS is emitted alongside them.

export default [
  {
    input: [
      './src/shell.ts',
      './src/app.ts',
      './src/fields/projects.ts',
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
      cleanWWW(),
      cssModules(),
      copyPdfWorker(),
      copyStatic({
        targets: [
          { from: 'src/index.html', to: 'www/index.html' },
          { from: 'src/themes', to: 'www/themes' }
        ]
      }),
      materialSymbols({
        placeholderPrefix: 'symbol'
      }),
      json(),
      nodeResolve({ browser: true, preferBuiltins: false }),
      commonjs(),
      typescript()
    ]
  }
]
