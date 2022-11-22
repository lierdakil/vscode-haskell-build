import { Builder } from './base'

const dummyResult = { exitCode: 0, hasError: false }
export const run: Builder = async function* () {
  return dummyResult
}
