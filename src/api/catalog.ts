import Storage from '@leofcoin/storage'

export type CustomCatalogStorage = Storage

export const customCatalogStore: CustomCatalogStorage = new Storage('catalog', 'cadle')

await customCatalogStore.init()
