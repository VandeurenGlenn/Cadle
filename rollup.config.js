import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import esmShim from '@rollup/plugin-esm-shim'
import builtins from "rollup-plugin-node-builtins";
import modify from "rollup-plugin-modify";
import {readdir, unlink} from 'fs/promises'
import { join } from 'path'

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
  input: ['./src/shell.ts', './src/elements/add-page-field.ts', './src/fields/projects-field.ts'],
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
    builtins(),
    json(),
    nodeResolve(),
    commonjs(),
    typescript()
  ]
}]