import * as path from 'path'
import * as vscode from 'vscode'

import CP = require('child_process')
const cabal2jsonPath = path.join(__dirname, '..', 'bin', 'cabal2json.min.js')

export interface IDotCabal {
  name: string
  version: string
  targets: ITarget[]
}

export interface ITarget {
  type: 'library' | 'executable' | 'test-suite' | 'benchmark'
  name: string
  target: string
}

async function runCabal2Json<T>(
  cabalSource: Uint8Array,
  args: string[],
  def: T,
) {
  return await new Promise<T>((resolve) => {
    const cp = CP.execFile(
      'node',
      [cabal2jsonPath, ...args],
      function (error, stdout, stderr) {
        if (error) {
          vscode.window.showErrorMessage(
            'Haskell-Build core error in runCabal2Json',
            {
              detail: error.message,
            },
          )
          resolve(def)
        } else {
          console.log(stdout, stderr)
          resolve(JSON.parse(stdout))
        }
      },
    )
    try {
      cp.stdin!.write(cabalSource)
      cp.stdin!.end()
    } catch (e) {
      vscode.window.showErrorMessage(
        'Haskell-Build core error in getComponentFromFile',
        {
          detail: (e as Error).message,
        },
      )
      try {
        cp.kill()
      } catch (e2) {}
    }
  })
}

export async function parseDotCabal(cabalSource: Uint8Array) {
  return runCabal2Json<IDotCabal | null>(cabalSource, [], null)
}

export async function getComponentFromFile(
  cabalSource: Uint8Array,
  filePath: string,
) {
  const fp =
    process.platform === 'win32'
      ? filePath.replace(path.sep, path.posix.sep)
      : filePath
  return runCabal2Json<string[]>(cabalSource, [fp], [])
}
