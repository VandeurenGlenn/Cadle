import { readdir, cp } from 'fs/promises'
import { join } from 'path'

/**
 * Rollup plugin: copy the pdfjs-dist worker bundle(s) into the output directory.
 *
 * @param {object} [options]
 * @param {string} [options.from='node_modules/pdfjs-dist/build']
 * @param {string} [options.to='www']
 * @param {RegExp} [options.match=/^pdf\.worker.*\.mjs$/]
 * @returns {import('rollup').Plugin}
 */
export default function copyPdfWorker(options = {}) {
  const { from = 'node_modules/pdfjs-dist/build', to = 'www', match = /^pdf\.worker.*\.mjs$/ } = options

  return {
    name: 'copy-pdf-worker',
    async buildStart() {
      const files = await readdir(from)
      for (const file of files) {
        if (match.test(file)) {
          await cp(join(from, file), join(to, file))
        }
      }
    }
  }
}
