/** Refreshes insertion order on reads so the oldest unused entry is evicted first. */
export const getBoundedCache = <K, V>(cache: Map<K, V>, key: K): V | undefined => {
  const value = cache.get(key)
  if (value === undefined) return undefined
  cache.delete(key)
  cache.set(key, value)
  return value
}

export const setBoundedCache = <K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void => {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > Math.max(1, limit)) {
    const oldest = cache.keys().next().value as K | undefined
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}
