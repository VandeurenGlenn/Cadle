import process from 'process/browser.js'

const browserGlobal = globalThis as typeof globalThis & { process?: typeof process }
browserGlobal.process ??= process
