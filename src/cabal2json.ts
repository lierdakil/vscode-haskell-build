import * as path from 'path'
import { Worker } from 'worker_threads'

import { Uri } from 'vscode'

import { ServiceConnection } from '@vscode/sync-api-common/node'
import { ApiService, Requests } from '@vscode/sync-api-service'
import { TextDecoder } from 'util'

async function runWasi(args: string[], stdin: Uint8Array) {
  const name = 'cabal2json'
  const worker = new Worker(path.join(__dirname, './worker.js'))
  const connection = new ServiceConnection<Requests, any>(worker)
  const apiService = new ApiService(name, connection, {
    exitHandler: (_rval) => {
      process.nextTick(() => worker.terminate())
    },
  })

  const consoleUri: Uri = Uri.from({
    scheme: 'terminal',
    authority: 'global',
  })

  const chunks: Uint8Array[] = []

  apiService.registerCharacterDeviceDriver(
    {
      uri: consoleUri,
      fileDescriptor: { kind: 'terminal', uri: consoleUri },
      async read(num) {
        const ret = stdin.subarray(0, num)
        stdin = stdin.subarray(ret.length)
        return ret
      },
      async write(bytes) {
        chunks.push(bytes)
        return bytes.length
      },
    },
    true,
  )

  const result = new Promise((resolve) => {
    connection.onRequest('process/proc_exit', (params) => {
      resolve(params.rval)
      return { errno: 0 }
    })
  })

  connection.signalReady({ args })
  const exitCode = await result
  console.assert(exitCode === 0, `cabal2json exited with ${exitCode}`)
  const outBuf = new Uint8Array(
    chunks.reduce<number>((acc, x) => acc + x.byteLength, 0),
  )
  let offset = 0
  for (const chunk of chunks) {
    outBuf.set(chunk, offset)
    offset += chunk.byteLength
  }
  const out = new TextDecoder('utf-8').decode(outBuf)
  return JSON.parse(out)
}

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
  try {
    return await runWasi([...args], cabalSource)
  } catch (e) {
    console.error(e)
    return def
  }
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
