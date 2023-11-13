import { get, getMany, set, setMany, entries, values, keys, clear, del, delMany, createStore } from 'idb-keyval'

export default class ProjectsStorage {
  constructor () {
    this.store = createStore('cadle', 'projects')
  }

  async set (key, val) {
    await set(key, val, this.store)
  }

  async get (key) {
    return await get(key, this.store)
  }

  async keys () {
    return await keys(this.store)
  }
}
