import { CtorOpts } from './base'
import { CabalBase } from './base/cabal'
import { BuildGenerator, runProcess } from './base/process'
import * as vscode from 'vscode'

export class Builder extends CabalBase {
  constructor(opts: CtorOpts) {
    super(opts)
  }

  public build() {
    return this.commonBuild('build', this.component())
  }
  public test() {
    return this.commonBuild('test', [])
  }
  public bench() {
    return this.commonBuild('bench', [])
  }
  public clean() {
    return this.commonBuild('clean', [])
  }
  // overrides CabalBase.component()
  protected component() {
    return super.component().map((x) => `${this.opts.target.project}:${x}`)
  }
  protected async withPrefix(cmd: string) {
    return super.withPrefix(cmd, 'v2-')
  }
  private async *commonBuild(
    command: 'build' | 'test' | 'bench' | 'install' | 'clean',
    args: string[],
  ): BuildGenerator {
    if (
      (await vscode.workspace.fs.readDirectory(this.opts.cabalRoot)).find(
        ([f, t]) => f === 'package.yaml' && t === vscode.FileType.File,
      )
    ) {
      const res = yield* runProcess(
        'hpack',
        [],
        this.getSpawnOpts(),
        this.opts.cancel,
      )
      if (res.exitCode !== 0) {
        return res
      }
    }
    return yield* this.runCabal([await this.withPrefix(command), ...args])
  }
}
