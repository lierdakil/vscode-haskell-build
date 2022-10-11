import { CtorOpts, ResultType, IParams } from './base'
import { CabalBase } from './base/cabal'
import { runProcess } from './base/process'
import * as vscode from 'vscode'

export class Builder extends CabalBase {
  constructor(opts: CtorOpts) {
    super(opts)
  }

  public async build() {
    return this.commonBuild('build', this.component())
  }
  public async test() {
    return this.commonBuild('test', [])
  }
  public async bench(): Promise<ResultType> {
    return this.commonBuild('bench', [])
  }
  public async clean(): Promise<ResultType> {
    return this.commonBuild('clean', [])
  }
  // overrides CabalBase.component()
  protected component() {
    return super.component().map((x) => `${this.opts.target.project}:${x}`)
  }
  protected async withPrefix(cmd: string) {
    return super.withPrefix(cmd, 'v2-')
  }
  private async commonBuild(
    command: 'build' | 'test' | 'bench' | 'install' | 'clean',
    args: string[],
    override: Partial<IParams> = {},
  ) {
    if (
      (await vscode.workspace.fs.readDirectory(this.opts.cabalRoot)).find(
        ([f, t]) => f === 'package.yaml' && t === vscode.FileType.File,
      )
    ) {
      await runProcess('hpack', [], this.getSpawnOpts(), this.opts.params)
    }
    return this.runCabal([await this.withPrefix(command), ...args], override)
  }
}
