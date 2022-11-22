import { CtorOpts, BuilderBase } from './base'
import * as vscode from 'vscode'

export class Builder extends BuilderBase {
  constructor(opts: CtorOpts) {
    super('stack', opts)
  }

  public build() {
    return this.runBuild(
      [
        'build',
        ...this.component(),
        ...(vscode.workspace
          .getConfiguration()
          .get<string[]>('haskell-build.stack.arguments.build') || []),
      ],
      false,
      false,
    )
  }
  public test() {
    return this.runBuild(
      [
        'test',
        ...this.project(),
        ...(vscode.workspace
          .getConfiguration()
          .get<string[]>('haskell-build.stack.arguments.test') || []),
      ],
      true,
      false,
    )
  }
  public bench() {
    return this.runBuild(
      [
        'bench',
        ...this.project(),
        ...(vscode.workspace
          .getConfiguration()
          .get<string[]>('haskell-build.stack.arguments.bench') || []),
      ],
      false,
      true,
    )
  }
  public clean() {
    return this.runCommon([
      'clean',
      ...this.project(),
      ...(vscode.workspace
        .getConfiguration()
        .get<string[]>('haskell-build.stack.arguments.clean') || []),
    ])
  }
  public deps() {
    return this.runCommon([
      'build',
      '--only-dependencies',
      ...this.component(),
      ...(vscode.workspace
        .getConfiguration()
        .get<string[]>('haskell-build.stack.arguments.deps') || []),
    ])
  }

  private async *runCommon(args: string[]) {
    const globalArgs =
      vscode.workspace
        .getConfiguration()
        .get<string[]>('haskell-build.stack.arguments.global') || []
    return yield* this.runCabal([...globalArgs, ...args])
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

  private async *runBuild(
    args: string[],
    runTests: boolean,
    runBench: boolean,
  ) {
    const args_ = [...args]
    if (!runTests) {
      args.push('--no-run-tests')
    }
    if (!runBench) {
      args.push('--no-run-benchmarks')
    }
    return yield* this.runCommon([...args_])
  }
}
