import { delimiter } from 'path'

import * as vscode from 'vscode'

import { runProcess, BuildGenerator } from './process'
import { ITarget } from '../../cabal2json'

export type CabalCommand = 'build' | 'clean' | 'test' | 'bench'

export interface CtorOpts {
  readonly target: TargetParamTypeForBuilder
  readonly cabalRoot: vscode.Uri
  readonly cancel: (cb: () => void) => void
}

export type Builder = (cmd: CabalCommand, opts: CtorOpts) => BuildGenerator

export interface ProjectDesc {
  project: string
  dir?: vscode.Uri
}

export type TargetParamType = (
  | { type: 'component'; target: ITarget; component: string }
  | { type: 'all' }
  | { type: 'auto' }
) &
  ProjectDesc
export type TargetParamTypeForBuilder = (
  | { type: 'component'; component: string }
  | { type: 'all'; targets: ITarget[] }
  | { type: 'auto' }
) &
  ProjectDesc

export function runCabal(
  processName: string,
  args: readonly string[],
  opts: CtorOpts,
): BuildGenerator {
  return runProcess(
    processName,
    args,
    getSpawnOpts(opts.cabalRoot.path),
    opts.cancel,
  )
}

export function getSpawnOpts(cabalRootPath: string) {
  // Setup default opts
  const opts = {
    cwd: cabalRootPath,
    detached: true,
    env: {} as { [key: string]: string | undefined },
  }

  const env = { ...process.env }

  // tslint:disable-next-line: totality-check
  if (process.platform === 'win32') {
    const path = collectPathCapitalizations(env)
    env.PATH = path.join(delimiter)
  }

  opts.env = env
  return opts
}

export function collectPathCapitalizations(env: typeof process.env) {
  const path: string[] = []
  const capMask = (str: string, mask: number) => {
    const a = str.split('')
    for (let i = 0; i < a.length; i++) {
      // tslint:disable-next-line: no-bitwise
      if (mask & Math.pow(2, i)) {
        const j = a.length - i - 1
        a[j] = a[j].toUpperCase()
      }
    }
    return a.join('')
  }
  for (let m = 0b1111; m >= 0; m--) {
    const vn = capMask('path', m)
    const evn = env[vn]
    if (evn !== undefined) {
      path.push(evn)
    }
  }
  return path
}
