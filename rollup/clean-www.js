import { readdir, unlink, stat } from 'fs/promises'
import { join } from 'path'

const isMissingFileError = (error) => error && typeof error === 'object' && error.code === 'ENOENT'

/**
 * Rollup plugin: clean stale build artefacts from an output directory before a build.
 *
 * Default behaviour: remove all `.js` files in `www/` while preserving service worker,
 * workbox runtime files, and the symbols manifest.
 *
 * @param {object} [options]
 * @param {string} [options.dir='www']            Directory to clean.
 * @param {string[]} [options.extensions=['.js']] File extensions eligible for deletion.
 * @param {(string|RegExp)[]} [options.preserve] Filenames or patterns to keep.
 * @param {boolean} [options.recursive=false]    Recurse into subdirectories.
 * @param {boolean} [options.silent=false]       Suppress the summary log.
 * @returns {import('rollup').Plugin}
 */
export default function cleanWWW(options = {}) {
  const {
    dir = 'www',
    extensions = ['.js'],
    preserve = ['sw.js', /workbox/, /manifest\.js$/],
    recursive = false,
    silent = false
  } = options

  const shouldPreserve = (file) => preserve.some((p) => (typeof p === 'string' ? file === p : p.test(file)))

  const shouldDelete = (file) => extensions.some((ext) => file.endsWith(ext)) && !shouldPreserve(file)

  const cleanDir = async (target) => {
    let removed = 0
    const entries = await readdir(target, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(target, entry.name)
      if (entry.isDirectory()) {
        if (recursive) removed += await cleanDir(full)
        continue
      }
      if (shouldDelete(entry.name)) {
        try {
          await unlink(full)
        } catch (error) {
          if (!isMissingFileError(error)) throw error
          continue
        }
        removed++
      }
    }
    return removed
  }

  return {
    name: 'clean-www',
    async buildStart() {
      try {
        await stat(dir)
      } catch {
        return // directory does not exist yet — nothing to clean
      }
      const removed = await cleanDir(dir)
      if (!silent && removed > 0) {
        this.info(`cleaned ${removed} stale file${removed === 1 ? '' : 's'} from ${dir}/`)
      }
    }
  }
}
