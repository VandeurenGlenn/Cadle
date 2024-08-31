import {
  get,
  getMany,
  set,
  setMany,
  entries,
  values,
  keys,
  clear,
  del,
  delMany,
  createStore,
  UseStore
} from 'idb-keyval'

export default class Storage {
  store: UseStore

  constructor(name: string) {
    this.store = createStore('cadle', name)
  }

  async set(key: IDBValidKey, val: any) {
    await set(key, val, this.store)
  }

  async get(key: IDBValidKey) {
    return await get(key, this.store)
  }

  async getMany(keys: IDBValidKey[]) {
    return getMany(keys, this.store)
  }

  async setMany(entries: [IDBValidKey, any][]) {
    return setMany(entries, this.store)
  }

  async keys() {
    return await keys(this.store)
  }

  async entries() {
    return entries(this.store)
  }

  async values() {
    return values(this.store)
  }

  async delete(key: IDBValidKey) {
    return del(key, this.store)
  }

  async deleteMany(keys: IDBValidKey[]) {
    return delMany(keys, this.store)
  }

  async clear() {
    return clear(this.store)
  }
}
