import * as child_process from 'child_process'
import { kill } from 'process'
import * as path from 'path'
import { EOL } from 'os'
import * as vscode from 'vscode'

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
): [vscode.Uri, vscode.Diagnostic] | undefined {
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
      return
    }
  }
  return
}

export interface BuildMsg {
  raw: string
  path?: vscode.Uri
  msg?: vscode.Diagnostic
}

export interface BuildReturn {
  exitCode: number | null
  hasError: boolean
}

export interface BuildProgress {
  progress: string
}

export type BuildGenerator = AsyncGenerator<
  BuildMsg | BuildProgress,
  BuildReturn
>

async function* merge<T>(
  ...gens: Array<AsyncIterator<T>>
): AsyncGenerator<T, void> {
  async function next(gen: AsyncIterator<T>) {
    return { gen, result: await gen.next() }
  }
  const sources = new Map(gens.map((gen) => [gen, next(gen)]))
  while (sources.size) {
    const winner = await Promise.race(sources.values())
    if (winner.result.done) {
      sources.delete(winner.gen)
      continue
    }
    sources.set(winner.gen, next(winner.gen))
    yield winner.result.value
  }
}

const buffered = async function* (gen: AsyncIterable<Buffer>) {
  let buffer = ''
  for await (const data of gen) {
    const output = data.toString('utf8')
    const [first, ...tail] = output.split(EOL)
    buffer += first
    if (tail.length > 0) {
      // it means there's at least one newline
      const lines = [buffer, ...tail.slice(0, -1)]
      buffer = tail.slice(-1)[0]
      yield lines
    }
  }
}

const blockBuffered = async function* (gen: AsyncIterable<Buffer>) {
  // Start of a Cabal message
  const startOfMessage = /\n(?=\S)(?!\d+ \|)/g
  let buffer: string[] = []
  try {
    for await (const lines of buffered(gen)) {
      buffer.push(...lines)
      const [first, ...tail] = buffer.join('\n').split(startOfMessage)
      if (tail.length > 0) {
        const last = tail.slice(-1)[0]
        buffer = last.split('\n')
        for (const block of [first, ...tail.slice(0, -1)]) {
          yield block
        }
      }
    }
  } finally {
    yield buffer.join('\n')
  }
}

export async function* runProcess(
  command: string,
  args: string[],
  options: child_process.SpawnOptions,
  cancel: (cb: () => void) => void,
): BuildGenerator {
  const cwd = vscode.Uri.file(options.cwd?.toString() || '.')
  // cabal returns failure when there are type errors _or_ when it can't
  // compile the code at all (i.e., when there are missing dependencies).
  // Since it's hard to distinguish between these two, we look at the
  // parsed errors;
  // this.hasError is set if we find an error/warning
  let hasError = false
  let running = true
  let exitCode = null
  const proc = child_process.spawn(command, args, options)

  proc.on('error', function (err) {
    vscode.window.showErrorMessage(err.name, {
      detail: err.message,
    })
    running = false
  })

  proc.on('exit', (code) => {
    running = false
    exitCode = code
  })

  cancel(() => {
    if (proc.pid !== undefined && running) {
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
    }
  })

  // Note: blockBuffered used twice because we need separate buffers
  // for stderr and stdout
  try {
    for await (const msg of merge(
      blockBuffered(proc.stdout!),
      blockBuffered(proc.stderr!),
    )) {
      // check progress
      const match = msg.match(/\[\s*([\d]+)\s+of\s+([\d]+)\s*\]/)
      if (match) {
        const progress = match[1]
        const total = match[2]
        yield { progress: `${progress} of ${total}` }
      }
      // check message
      const res = parseMessage(msg, cwd)
      hasError = hasError || !!res?.[1]
      yield { raw: msg, path: res?.[0], msg: res?.[1] }
    }
  } finally {
    if (running) {
      await new Promise<void>((resolve) => {
        proc.once('exit', () => resolve())
      })
    }
    return { hasError, exitCode }
  }
}
