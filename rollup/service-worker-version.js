import { createHash } from 'node:crypto'

export default function serviceWorkerVersion() {
  return {
    name: 'cadle-service-worker-version',
    generateBundle(_options, bundle) {
      const worker = bundle['sw.js']
      if (worker?.type !== 'chunk') throw new Error('Missing service worker bundle: sw.js')
      const hash = createHash('sha256')
      for (const name of Object.keys(bundle).sort()) {
        const entry = bundle[name]
        if (entry === worker || entry.type !== 'chunk') continue
        hash.update(name).update('\0').update(entry.code).update('\0')
      }
      // App changes must trigger browser update detection even when SW logic is unchanged.
      worker.code += `\n// Cadle app build: ${hash.digest('hex')}\n`
    }
  }
}
