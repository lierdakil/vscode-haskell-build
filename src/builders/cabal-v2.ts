import {
  CtorOpts,
  Builder,
  getSpawnOpts,
  runCabal,
  TargetParamTypeForBuilder,
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

function component(target: TargetParamTypeForBuilder) {
  switch (target.type) {
    case 'all':
      return target.targets.map((x) => `${target.project}:${x.target}`)
    case 'component':
      return [`${target.project}:${target.component}`]
    case 'auto':
      return []
  }
}
function withPrefix(cmd: string) {
  return `v2-${cmd}`
}
async function* commonBuild(
  opts: CtorOpts,
  command: 'build' | 'test' | 'bench' | 'clean',
  args: string[],
): BuildGenerator {
  if (
    (await vscode.workspace.fs.readDirectory(opts.cabalRoot)).find(
      ([f, t]) => f === 'package.yaml' && t === vscode.FileType.File,
    )
  ) {
    const res = yield* runProcess(
      'hpack',
      [],
      getSpawnOpts(opts.cabalRoot.path),
      opts.cancel,
    )
    if (res.exitCode !== 0) {
      return res
    }
  }
  return yield* runCabal('cabal', [withPrefix(command), ...args], opts)
}
