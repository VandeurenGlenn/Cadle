import { get, getMany, set, setMany, entries, values, keys, clear, del, delMany, createStore } from 'idb-keyval';

export default class ProjectsStorage {
  constructor() {
    this.store = createStore('cadle', 'projects')
  }

  set(key, val) {
    return set(key, val, this.store)
  }

  get(key) {
    return get(key, this.store)
  }

  keys() {
    return keys(this.store)
  }

}