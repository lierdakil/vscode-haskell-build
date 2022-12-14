import { Builder, CabalCommand, CtorOpts, runCabal } from './base'
import * as vscode from 'vscode'

export const run: Builder = function (cmd, opts) {
  switch (cmd) {
    case 'build':
      return runBuild(opts, 'build', component(opts))
    case 'test':
      return runBuild(opts, 'test', project(opts))
    case 'bench':
      return runBuild(opts, 'bench', project(opts))
    case 'clean':
      return runCommon(opts, 'clean', project(opts))
  }
}

async function* runCommon(
  opts: CtorOpts,
  cmd: CabalCommand,
  args: readonly string[],
) {
  const globalArgs =
    vscode.workspace
      .getConfiguration()
      .get<string[]>('haskell-build.stack.arguments.global') || []
  const cmdArgs =
    vscode.workspace
      .getConfiguration()
      .get<string[]>(`haskell-build.stack.arguments.${cmd}`) || []
  return yield* runCabal(
    'stack',
    [...globalArgs, cmd, ...args, ...cmdArgs],
    opts,
  )
}

function fixTarget(comp: string, opts: CtorOpts): string {
  if (comp.startsWith('lib:')) {
    comp = 'lib'
  }
  return `${opts.target.project}:${comp}`
}

function project(opts: CtorOpts): readonly Readonly<string>[] {
  switch (opts.target.type) {
    case 'all':
    case 'component':
      return [opts.target.project]
    case 'auto':
      return []
  }
}

function component(opts: CtorOpts): readonly string[] {
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
  cmd: Exclude<CabalCommand, 'clean'>,
  args: readonly string[],
) {
  const args_ = [...args]
  if (cmd !== 'test') {
    args_.push('--no-run-tests')
  }
  if (cmd !== 'bench') {
    args_.push('--no-run-benchmarks')
  }
  return yield* runCommon(opts, cmd, args_)
}
