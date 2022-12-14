import {
  CtorOpts,
  Builder,
  getSpawnOpts,
  runCabal,
  TargetParamTypeForBuilder,
  CabalCommand,
} from './base'
import { BuildGenerator, runProcess } from './base/process'
import * as vscode from 'vscode'

export const run: Builder = function (cmd, opts) {
  switch (cmd) {
    case 'build':
      return commonBuild(opts, 'build', component(opts.target))
    case 'test':
      return commonBuild(opts, 'test', [])
    case 'bench':
      return commonBuild(opts, 'bench', [])
    case 'clean':
      return commonBuild(opts, 'clean', [])
  }
}

function component(target: TargetParamTypeForBuilder): readonly string[] {
  switch (target.type) {
    case 'all':
      return target.targets.map((x) => `${target.project}:${x.target}`)
    case 'component':
      return [`${target.project}:${target.component}`]
    case 'auto':
      return []
  }
}

async function* commonBuild(
  opts: CtorOpts,
  command: CabalCommand,
  args: readonly string[],
): BuildGenerator {
  const res = yield* tryRunHPack(opts)
  if (res && res.exitCode !== 0) {
    return res
  }
  const globalArgs =
    vscode.workspace
      .getConfiguration()
      .get<string[]>('haskell-build.cabal.arguments.global') || []
  const cmdArgs =
    vscode.workspace
      .getConfiguration()
      .get<string[]>(`haskell-build.cabal.arguments.${command}`) || []
  return yield* runCabal(
    'cabal',
    [...globalArgs, `v2-${command}`, ...args, ...cmdArgs],
    opts,
  )
}

async function* tryRunHPack(opts: CtorOpts) {
  const runHPack =
    vscode.workspace
      .getConfiguration()
      .get<boolean>('haskell-build.cabal.runHPack') || true
  if (!runHPack) {
    return
  }
  const hasPackageYaml = (
    await vscode.workspace.fs.readDirectory(opts.cabalRoot)
  ).find(([f, t]) => f === 'package.yaml' && t === vscode.FileType.File)
  if (!hasPackageYaml) {
    return
  }
  return yield* runProcess(
    'hpack',
    [],
    getSpawnOpts(opts.cabalRoot.path),
    opts.cancel,
  )
}
