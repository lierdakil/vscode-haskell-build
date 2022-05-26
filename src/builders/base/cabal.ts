import { CtorOpts, BuilderBase } from './index'

export abstract class CabalBase extends BuilderBase {
  constructor(opts: CtorOpts, globals: object = {}) {
    super('cabal', opts, globals)
  }

  protected component() {
    switch (this.opts.target.type) {
      case 'all':
        return this.opts.target.targets.map((x) => x.target)
      case 'component':
        return [this.opts.target.component]
      case 'auto':
        return []
    }
  }

  protected async withPrefix(
    cmd: string,
    newprefix: string,
  ) {
    return `${newprefix}${cmd}`
  }
}
