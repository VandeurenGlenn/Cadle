import { cp, mkdir } from 'fs/promises'
import { dirname, join } from 'path'

/**
 * Rollup plugin: copy hand-authored static assets from `src/` into the
 * output directory at build start.
 *
 * Each entry is `{ from, to }` resolved relative to the project root.
 * Files and directories are both supported (directories copy recursively).
 *
 * @param {object} [options]
 * @param {{from: string, to: string}[]} [options.targets]
 * @param {boolean} [options.silent=false]
 * @returns {import('rollup').Plugin}
 */
export default function copyStatic(options = {}) {
  const { targets = [], silent = false } = options

  const copyOne = async ({ from, to }) => {
    await mkdir(dirname(join(process.cwd(), to)), { recursive: true })
    await cp(join(process.cwd(), from), join(process.cwd(), to), { recursive: true })
  }

  return {
    name: 'copy-static',
    async buildStart() {
      for (const target of targets) {
        try {
          await copyOne(target)
          if (!silent) this.info(`copied ${target.from} → ${target.to}`)
        } catch (error) {
          this.warn(`copy-static: failed to copy ${target.from} → ${target.to}: ${error.message}`)
        }
      }
    }
  }
}
