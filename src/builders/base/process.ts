import * as child_process from 'child_process'
import { kill } from 'process'
import * as path from 'path'
import { EOL } from 'os'
import * as vscode from 'vscode'

export type IParams = Omit<IParamsInternal, 'onDone'>

interface IParamsInternal {
  readonly onMsg?: (
    raw: string,
    path?: vscode.Uri,
    msg?: vscode.Diagnostic,
  ) => void
  readonly onProgress?: (progress: string) => void
  readonly onDone?: (done: {
    exitCode: number | null
    hasError: boolean
  }) => void
  readonly setCancelAction?: (action: () => void) => void
}

function unindentMessage(lines: string[]) {
  const minIndent = Math.min(
    ...lines.map((line) => {
      const match = line.match(/^\s*/)
      if (match) {
        return match[0].length
      } else {
        return 0
      }
    }),
  )
  return lines.map((line) => line.slice(minIndent)).join('\n')
}

function parseMessage(
  raw: string,
  cwd: vscode.Uri,
): [vscode.Uri, vscode.Diagnostic] | false {
  if (raw.trim() !== '') {
    const matchLoc =
      /^(.+):(\d+):(\d+):(?: (\w+):)?[ \t]*(\[[^\]]+\])?[ \t]*\n?([^]*)/
    const matched = raw.trimRight().match(matchLoc)
    if (matched) {
      const [file, line, col, rawTyp, context, msg] = matched.slice(1)
      const typ =
        rawTyp.toLowerCase() === 'warning'
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Error

      const iline = parseInt(line, 10) - 1
      const icol = parseInt(col, 10) - 1

      const lines = msg.split('\n')
      const codeLines = []

      for (const line of lines.slice().reverse()) {
        if (line.match(/^[\s\d]+\|/)) {
          codeLines.unshift(lines.pop())
        } else {
          break
        }
      }

      const code = codeLines.join('\n')
      const carets = code.match(/\^+/)
      const length = carets ? carets[0].length : 1

      return [
        path.isAbsolute(file)
          ? vscode.Uri.file(file)
          : vscode.Uri.joinPath(cwd, file),
        {
          source: context ? `Haskell Build: ${context}` : 'Haskell Build',
          range: new vscode.Range(iline, icol, iline, icol + length),
          message: unindentMessage(lines),
          severity: typ,
        },
      ]
    } else {
      return false
    }
  }
  return false
}

function runBuilderProcess(
  command: string,
  args: string[],
  options: child_process.SpawnOptions,
  params: IParamsInternal,
) {
  const cwd = vscode.Uri.file(options.cwd || '.')
  // cabal returns failure when there are type errors _or_ when it can't
  // compile the code at all (i.e., when there are missing dependencies).
  // Since it's hard to distinguish between these two, we look at the
  // parsed errors;
  // this.hasError is set if we find an error/warning, see parseMessage
  let hasError = false
  const proc = child_process.spawn(command, args, options)
  proc.on('error', function (err) {
    vscode.window.showErrorMessage(err.name, {
      detail: err.message,
    })
  })

  const buffered = (handleOutput: (lines: string[]) => void) => {
    let buffer = ''
    return (data: Buffer) => {
      const output = data.toString('utf8')
      const [first, ...tail] = output.split(EOL)
      // ^ The only place where we get os-specific EOL (CR/CRLF/LF)
      // in the rest of the code we're using just LF (\n)
      buffer += first
      if (tail.length > 0) {
        // it means there's at least one newline
        const lines = [buffer, ...tail.slice(0, -1)]
        buffer = tail.slice(-1)[0]
        handleOutput(lines)
      }
    }
  }

  const blockBuffered = (handleOutput: (block: string) => void) => {
    // Start of a Cabal message
    const startOfMessage = /\n(?=\S)(?!\d+ \|)/g
    let buffer: string[] = []
    proc.on('close', () => handleOutput(buffer.join('\n')))
    return buffered((lines: string[]) => {
      buffer.push(...lines)
      // Could iterate over lines here, but this is easier, if not as effective
      const [first, ...tail] = buffer.join('\n').split(startOfMessage)
      if (tail.length > 0) {
        const last = tail.slice(-1)[0]
        buffer = last.split('\n')
        for (const block of [first, ...tail.slice(0, -1)]) {
          handleOutput(block)
        }
      }
    })
  }

  if (params.setCancelAction) {
    params.setCancelAction(() => {
      try {
        kill(-proc.pid)
      } catch (e) {
        /*noop*/
      }
      try {
        kill(proc.pid)
      } catch (e) {
        /*noop*/
      }
      try {
        proc.kill()
      } catch (e) {
        /*noop*/
      }
    })
  }

  const handleMessage = (msg: string) => {
    if (params.onProgress) {
      // check progress
      const match = msg.match(/\[\s*([\d]+)\s+of\s+([\d]+)\s*\]/)
      if (match) {
        const progress = match[1]
        const total = match[2]
        params.onProgress(`${progress} of ${total}`)
      }
    }
    const res = parseMessage(msg, cwd)
    if (params.onMsg) {
      if (res) {
        params.onMsg(msg, res[0], res[1])
      } else {
        params.onMsg(msg)
      }
    }
  }

  // Note: blockBuffered used twice because we need separate buffers
  // for stderr and stdout
  proc.stdout!.on('data', blockBuffered(handleMessage))
  proc.stderr!.on('data', blockBuffered(handleMessage))

  proc.on('close', (exitCode) => {
    if (params.onDone) {
      params.onDone({ exitCode, hasError: hasError })
    }
  })
}

export async function runProcess(
  command: string,
  args: string[],
  options: child_process.SpawnOptions,
  pars: IParams,
) {
  return await new Promise<{ exitCode: number | null; hasError: boolean }>(
    (resolve) => {
      const newPars: IParamsInternal = { ...pars, onDone: resolve }
      runBuilderProcess(command, args, options, newPars)
    },
  )
}
