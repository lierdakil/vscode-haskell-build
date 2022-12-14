import * as vscode from 'vscode'
import Builders from '../builders'
import { posix as nodePath } from 'path'
import { getRootDir } from '../util'
import { parseDotCabal, getComponentFromFile } from '../cabal2json'
import {
  CabalCommand,
  TargetParamType,
  TargetParamTypeForBuilder,
} from '../builders'
import { BuilderParamType, selectBuilder } from './builder-selection'
import { defaultTarget } from './target'

async function* cabalBuild(
  ed: vscode.TextEditor,
  context: vscode.ExtensionContext,
  cmd: CabalCommand,
  cancel: (cb: () => void) => void,
) {
  try {
    let builderParam: BuilderParamType | undefined =
      context.workspaceState.get('builder')
    let target = context.workspaceState.get<TargetParamType>('target')

    if (target === undefined) {
      target = defaultTarget
    }
    if (builderParam === undefined) {
      builderParam = await selectBuilder(context)
      if (builderParam === undefined) {
        return
      }
    }

    const cabalRoot = await getRootDir(
      target.dir ? vscode.Uri.from(target.dir) : getActiveProjectPath(ed),
    )

    if (!cabalRoot) {
      throw new Error('No cabal root dir found')
    }

    const cabalFileName = (
      await vscode.workspace.fs.readDirectory(cabalRoot)
    ).find((f) => f[1] === vscode.FileType.File && f[0].endsWith('.cabal'))

    if (!cabalFileName) {
      throw new Error('No cabal file found')
    }

    const cabalFile = vscode.Uri.joinPath(cabalRoot, cabalFileName[0])

    let newTarget: TargetParamTypeForBuilder | undefined

    if (target.type === 'auto') {
      const cabalContents = await vscode.workspace.fs.readFile(cabalFile)
      if (cabalContents === null) {
        throw new Error(`Could not read cabalfile ${cabalFile}`)
      }
      const [tgt] = await getActiveProjectTarget(ed, cabalContents, cabalRoot)
      if (tgt) {
        const cf = await parseDotCabal(cabalContents)
        if (cf) {
          newTarget = {
            project: cf.name,
            dir: cabalRoot,
            type: 'component',
            component: tgt,
          }
        }
      }
    } else if (target.type === 'all') {
      const cabalContents = await vscode.workspace.fs.readFile(cabalFile)
      if (cabalContents === null) {
        throw new Error(`Could not read cabalfile ${cabalFile.toString()}`)
      }
      const cf = await parseDotCabal(cabalContents)
      if (cf) {
        newTarget = newTarget = {
          project: cf.name,
          dir: cabalRoot,
          type: 'all',
          targets: cf.targets,
        }
      }
    } else if (target.type === 'component') {
      const { project, dir, component } = target
      newTarget = { type: 'component', project, dir, component }
    }
    if (!newTarget) {
      newTarget = {
        type: 'auto',
        project: target.project,
        dir: target.dir,
      }
    }
    const builder = Builders[builderParam]

    if (builder === undefined) {
      throw new Error(`Unknown builder '${builderParam}'`)
    }

    const res = yield* builder(cmd, {
      target: newTarget,
      cabalRoot,
      cancel,
    })
    // tslint:disable-next-line: no-null-keyword
    // null means process was killed.
    if (res.exitCode !== null && res.exitCode !== 0 && !res.hasError) {
      vscode.window.showErrorMessage(
        `Builder quit abnormally with exit code ${res.exitCode}`,
      )
    }
  } catch (error) {
    console.error(error)
    vscode.window.showErrorMessage((error as Error).toString())
  }
}

export async function runBuilderCommand(
  ed: vscode.TextEditor,
  output: vscode.OutputChannel,
  diagnostics: vscode.DiagnosticCollection,
  context: vscode.ExtensionContext,
  command: CabalCommand,
): Promise<void> {
  const messages: Map<string, vscode.Diagnostic[]> = new Map()
  output.clear()
  diagnostics.clear()

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      cancellable: true,
      title: `${command} in progress`,
    },
    async (progress, token) => {
      const it = cabalBuild(ed, context, command, (cb) => {
        token.onCancellationRequested(cb)
      })
      for await (const msg of it) {
        if ('progress' in msg) {
          progress.report({ message: msg.progress })
        } else {
          output.append(msg.raw + '\n')
          if (msg.path && msg.msg) {
            const str = msg.path.fsPath
            let ds = messages.get(str)
            if (ds === undefined) {
              ds = []
              messages.set(str, ds)
            }
            ds.push(msg.msg)
            diagnostics.set(msg.path, ds)
          }
        }
      }
    },
  )
}

function getActiveProjectPath(editor: vscode.TextEditor): vscode.Uri {
  const uri = editor.document.uri
  if (uri) {
    return uri.with({ path: nodePath.dirname(uri.path) })
  }
  return (
    (vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders[0]?.uri) ||
    vscode.Uri.file(process.cwd())
  )
}

async function getActiveProjectTarget(
  editor: vscode.TextEditor,
  cabalfile: Uint8Array,
  cabalRoot: vscode.Uri,
): Promise<string[]> {
  const uri = editor.document.uri
  if (uri) {
    const res = await getComponentFromFile(
      cabalfile,
      nodePath.relative(cabalRoot.path, uri.path),
    )
    if (res) {
      return res
    }
  }
  return []
}
