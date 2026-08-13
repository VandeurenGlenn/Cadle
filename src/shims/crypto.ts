import hash from 'hash.js'

type HashEncoding = 'hex'

const algorithms = {
  sha1: hash.sha1,
  sha224: hash.sha224,
  sha256: hash.sha256,
  sha384: hash.sha384,
  sha512: hash.sha512,
  ripemd160: hash.ripemd160
} as const

/**
 * Small synchronous hashing bridge for the one legacy createHash call in the
 * Peernet browser bundle. Cadle itself uses the native Web Crypto API.
 */
export const createHash = (algorithm: string) => {
  const normalized = algorithm.toLowerCase().replaceAll('-', '') as keyof typeof algorithms
  const factory = algorithms[normalized]
  if (!factory) throw new Error(`Unsupported browser hash algorithm: ${algorithm}`)
  const digest = factory()
  return {
    update(data: unknown, encoding?: HashEncoding) {
      digest.update(data, encoding)
      return this
    },
    digest(encoding?: HashEncoding) {
      return encoding === 'hex' ? digest.digest('hex') : digest.digest()
    }
  }
}
