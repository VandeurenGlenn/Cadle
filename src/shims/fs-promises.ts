export const readFile = async (): Promise<never> => {
  throw new Error('Reading local filesystem paths is unavailable in the Cadle browser app')
}
