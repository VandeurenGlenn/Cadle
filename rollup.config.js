import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import {readdir, unlink} from 'fs/promises'
import { join } from 'path'
import { cp } from "fs/promises";
import materialSymbols from 'rollup-plugin-material-symbols'

await cp('node_modules/@vandeurenglenn/custom-elements/exports/themes/default', 'www/themes/default', {recursive: true})

const cleanWWW = async () => {
  return {
    name: 'clean-www', // this name will show up in warnings and errors
    generateBundle: async ()=> {
      const files = await readdir('www')
      for (const file of files) {
        if (file.endsWith('.js') && !file.includes('sw.js') && !file.includes('workbox')) await unlink(join('www', file))
        
      }
      return 
    }
  };
}

export default [{
  input: ['./src/shell.ts', './src/fields/projects.ts', './src/fields/draw.ts'],
  external: [
    './symbols/manifest.js',
    './elements/symbols/manifest.js'
  ],
  output: [{
    format: 'es',
    dir: './www'
  }],
  plugins: [
    cleanWWW(),
    materialSymbols({
      copyHTML: true,
      includeHTML: true
    }),
    json(),
    nodeResolve(),
    commonjs(),
    typescript()
  ]
}]