import { Builder, CtorOpts, runCabal } from './base'
import * as vscode from 'vscode'

export const run: Builder = function (cmd, opts) {
  switch (cmd) {
    case 'build':
      return runBuild(
        opts,
        [
          'build',
          ...component(opts),
          ...(vscode.workspace
            .getConfiguration()
            .get<string[]>('haskell-build.stack.arguments.build') || []),
        ],
        false,
        false,
      )
    case 'test':
      return runBuild(
        opts,
        [
          'test',
          ...project(opts),
          ...(vscode.workspace
            .getConfiguration()
            .get<string[]>('haskell-build.stack.arguments.test') || []),
        ],
        true,
        false,
      )
    case 'bench':
      return runBuild(
        opts,
        [
          'bench',
          ...project(opts),
          ...(vscode.workspace
            .getConfiguration()
            .get<string[]>('haskell-build.stack.arguments.bench') || []),
        ],
        false,
        true,
      )
    case 'clean':
      return runCommon(opts, [
        'clean',
        ...project(opts),
        ...(vscode.workspace
          .getConfiguration()
          .get<string[]>('haskell-build.stack.arguments.clean') || []),
      ])
  }
}

async function* runCommon(opts: CtorOpts, args: string[]) {
  const globalArgs =
    vscode.workspace
      .getConfiguration()
      .get<string[]>('haskell-build.stack.arguments.global') || []
  return yield* runCabal('stack', [...globalArgs, ...args], opts)
}

function fixTarget(comp: string, opts: CtorOpts): string {
  if (comp.startsWith('lib:')) {
    comp = 'lib'
  }
  return `${opts.target.project}:${comp}`
}

function project(opts: CtorOpts): string[] {
  switch (opts.target.type) {
    case 'all':
    case 'component':
      return [opts.target.project]
    case 'auto':
      return []
  }
}

function component(opts: CtorOpts): string[] {
  switch (opts.target.type) {
    case 'all':
      return opts.target.targets.map((x) => fixTarget(x.target, opts))
    case 'component':
      return [fixTarget(opts.target.component, opts)]
    case 'auto':
      return []
  }
}

async function* runBuild(
  opts: CtorOpts,
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
  return yield* runCommon(opts, args_)
}
