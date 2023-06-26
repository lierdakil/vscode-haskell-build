import * as fs from 'fs'
import * as path from 'path'
import { parentPort } from 'worker_threads'
import { URI } from 'vscode-uri'

import { ClientConnection } from '@vscode/sync-api-common/node'
import { ApiClient, Requests } from '@vscode/sync-api-client'
import { DeviceDescription, WASI } from '@vscode/wasm-wasi/node'
import * as TerminalDriver from '@vscode/wasm-wasi/lib/common/terminalDriver'

if (parentPort === null) {
  process.exit()
}

const connection = new ClientConnection<Requests, any>(parentPort)
connection
  .serviceReady()
  .then(async ({ args }) => {
    const name = 'cabal2json'
    const apiClient = new ApiClient(connection)
    const exitHandler = (rval: number): void => {
      apiClient.process.procExit(rval)
    }
    const consoleUri: URI = URI.from({
      scheme: 'terminal',
      authority: 'global',
    })
    const consoleUri2: URI = URI.from({
      scheme: 'console',
      authority: 'developerTools',
    })
    const ioDev: DeviceDescription = {
      kind: 'custom',
      uri: consoleUri,
      factory(apiClient) {
        const term = TerminalDriver.create(apiClient, consoleUri)
        term.fd_close = function () {}
        return term
      },
    }
    const wasi = WASI.create(
      name,
      apiClient,
      exitHandler,
      [ioDev],
      {
        stdin: { kind: 'terminal', uri: consoleUri },
        stdout: { kind: 'terminal', uri: consoleUri },
        stderr: { kind: 'console', uri: consoleUri2 },
      },
      { args },
    )
    const wasmFile = path.join(__dirname, '../bin/cabal2json.opt.wasm')
    const binary = fs.readFileSync(wasmFile)
    // @ts-ignore -- WebAssembly missing
    const { instance } = await WebAssembly.instantiate(binary, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      wasi_snapshot_preview1: wasi,
    })
    wasi.initialize(instance)
    try {
      ;(instance.exports._start as Function)()
    } catch (e) {
      console.error(e)
    }
  })
  .catch(console.error)
