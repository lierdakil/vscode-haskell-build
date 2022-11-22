export * from './base'

import { run as stack } from './stack'
import { run as none } from './none'
import { run as cabalV2 } from './cabal-v2'

export default {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'cabal-v2': cabalV2,
  stack,
  none,
}
