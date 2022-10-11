import { CtorOpts, BuilderBase } from './base'
import * as vscode from 'vscode'

export class Builder extends BuilderBase {
  constructor(opts: CtorOpts) {
    super('stack', opts)
  }

  public async build() {
    return this.runCommon([
      'build',
      ...this.component(),
      ...(vscode.workspace
        .getConfiguration()
        .get<string[]>('haskell-build.stack.arguments.build') || []),
      '--no-run-tests',
      '--no-run-benchmarks',
    ])
  }
  public async test() {
    return this.runBuild([
      'test',
      ...this.project(),
      ...(vscode.workspace
        .getConfiguration()
        .get<string[]>('haskell-build.stack.arguments.test') || []),
    ])
  }
  public async bench() {
    return this.runBuild([
      'bench',
      ...this.project(),
      ...(vscode.workspace
        .getConfiguration()
        .get<string[]>('haskell-build.stack.arguments.bench') || []),
    ])
  }
  public async clean() {
    return this.runCommon([
      'clean',
      ...this.project(),
      ...(vscode.workspace
        .getConfiguration()
        .get<string[]>('haskell-build.stack.arguments.clean') || []),
    ])
  }
  public async deps() {
    return this.runCommon([
      'build',
      '--only-dependencies',
      ...this.component(),
      ...(vscode.workspace
        .getConfiguration()
        .get<string[]>('haskell-build.stack.arguments.deps') || []),
    ])
  }

  private async runCommon(args: string[], overrides: {} = {}) {
    const globalArgs =
      vscode.workspace
        .getConfiguration()
        .get<string[]>('haskell-build.stack.arguments.global') || []
    return this.runCabal([...globalArgs, ...args], overrides)
  }

  private fixTarget(comp: string): string {
    if (comp.startsWith('lib:')) {
      comp = 'lib'
    }
    return `${this.opts.target.project}:${comp}`
  }

  private project(): string[] {
    switch (this.opts.target.type) {
      case 'all':
      case 'component':
        return [this.opts.target.project]
      case 'auto':
        return []
    }
  }

  private component(): string[] {
    switch (this.opts.target.type) {
      case 'all':
        return this.opts.target.targets.map((x) => this.fixTarget(x.target))
      case 'component':
        return [this.fixTarget(this.opts.target.component)]
      case 'auto':
        return []
    }
  }

  private async runBuild(args: string[]) {
    const res = await this.runCommon(
      [...args, '--no-run-tests', '--no-run-benchmarks'],
      {
        severity: 'build',
      },
    )
    if (res.exitCode !== 0) {
      console.error(res.exitCode)
      return res
    } else {
      return this.runCommon(args)
    }
  }
}
