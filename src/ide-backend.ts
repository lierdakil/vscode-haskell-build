import * as path from 'path'
import * as vscode from 'vscode'
import * as Builders from './builders'
import {posix as nodePath} from 'path'
import {CabalCommand, TargetParamType, BuilderParamType, TBuilders, TargetParamTypeForBuilder} from './types'
import {getRootDir} from './util'
import {parseDotCabal, getComponentFromFile} from './cabal2json'

const defaultTarget: Readonly<TargetParamType> = {
  project: 'Auto',
  type: 'auto',
  dir: undefined,
}

export function init(context: vscode.ExtensionContext) {
  const diagnostics = vscode.languages.createDiagnosticCollection('haskell')
  const output = vscode.window.createOutputChannel('Haskell Build')
  context.subscriptions.push(
    diagnostics,
    output,
    vscode.commands.registerTextEditorCommand(`haskell-build.build`,
      (ed) => runBuilderCommand(ed, output, diagnostics, context, 'build')),
    vscode.commands.registerTextEditorCommand(`haskell-build.test`,
      (ed) => runBuilderCommand(ed, output, diagnostics, context, 'test')),
    vscode.commands.registerTextEditorCommand(`haskell-build.clean`,
      (ed) => runBuilderCommand(ed, output, diagnostics, context, 'clean')),
    vscode.commands.registerTextEditorCommand(`haskell-build.bench`,
      (ed) => runBuilderCommand(ed, output, diagnostics, context, 'bench')),
    vscode.commands.registerCommand(`haskell-build.set-build-target`, async () => {
      const targets = await targetParamInfo()
      const target = await vscode.window.showQuickPick(targets)
      context.workspaceState.update('target', target?.handle)
    }),
    vscode.commands.registerCommand(`haskell-build.set-builder`, async () => {
      await selectBuilder(context)
    }),
  )
}

const builderParamInfo: ReadonlyArray<vscode.QuickPickItem> =
  [
    { label: 'cabal-v2' },
    { label: 'stack' },
    { label: 'none' },
  ]

async function selectBuilder(context: vscode.ExtensionContext) {
  const target = await vscode.window.showQuickPick(builderParamInfo)
  if(target) {
    context.workspaceState.update('builder', target?.label)
  }
  return target?.label as BuilderParamType
}

async function targetParamInfo(): Promise<Array<vscode.QuickPickItem & {handle: TargetParamType}>> {
  const projects: TargetParamType[] = [defaultTarget]
  for (const d of vscode.workspace.workspaceFolders || []) {
    const dir = d.uri
    const rootDir = await getRootDir(dir)
    if (!rootDir) { continue }
    const cabalFile = (await vscode.workspace.fs.readDirectory(rootDir))
      .find(f => f[1] === vscode.FileType.File && f[0].endsWith('.cabal'))
    if (cabalFile) {
      const data = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(rootDir, cabalFile[0]))
      const project = await parseDotCabal(data)
      if (project) {
        projects.push({ project: project.name, dir, type: 'auto' })
        projects.push({ project: project.name, dir, type: 'all' })
        for (const target of project.targets) {
          projects.push({
            project: project.name,
            dir,
            type: 'component',
            target,
            component: target.target,
          })
        }
      }
    }
  }
  return projects.map(t => ({
    label: `${t.project}: ${t.type === 'component' ? t.target.name : t.type}`,
    detail: t.dir?.fsPath,
    description: t.type === 'component' ? t.component : undefined,
    handle: t,
  }))
}

function getActiveProjectPath(editor: vscode.TextEditor): vscode.Uri {
  const uri = editor.document.uri
  if (uri) {
    return uri.with({path: nodePath.dirname(uri.path)})
  }
  return (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]?.uri) ||
    vscode.Uri.file(process.cwd())
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
      nodePath.relative(cabalRoot.path,uri.path),
    )
    if (res) { return res }
  }
  return []
}

async function cabalBuild(
  ed: vscode.TextEditor,
  context: vscode.ExtensionContext,
  cmd: CabalCommand,
  params: Builders.IParams,
  progress: vscode.Progress<{message?: string, increment?: number}>,
): Promise<void> {
  try {
    let builderParam: BuilderParamType | undefined = context.workspaceState.get('builder')
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

    const cabalFileName = (await vscode.workspace.fs.readDirectory(cabalRoot))
      .find(f => f[1] === vscode.FileType.File && f[0].endsWith('.cabal'))

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
    const builders: TBuilders = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'cabal-v2': Builders.CabalV2,
      stack: Builders.Stack,
      none: Builders.None,
    }
    const builder = builders[builderParam]

    if (builder === undefined) {
      throw new Error(
        `Unknown builder '${builderParam}'`,
      )
    }

    const res = await new builder({
      params,
      target: newTarget,
      cabalRoot,
    }).runCommand(cmd)
    // see CabalProcess for explanation
    // tslint:disable-next-line: no-null-keyword
    if (res.exitCode === null) {
      // this means process was killed
      progress.report({
        message: 'Build was interrupted'
      })
    } else if (res.exitCode !== 0) {
      if (res.hasError) {
        progress.report({
          message: 'There were errors in source files'
        })
      } else {
        progress.report({
          message: `Builder quit abnormally with exit code ${res.exitCode}`
        })
      }
    } else {
      progress.report({
        message: 'Build was successful'
      })
    }
  } catch (error) {
    console.error(error)
    vscode.window.showErrorMessage((error as Error).toString())
  }
}

async function runBuilderCommand(
    ed: vscode.TextEditor,
    output: vscode.OutputChannel,
    diagnostics: vscode.DiagnosticCollection,
    context: vscode.ExtensionContext,
    command: CabalCommand
  ): Promise<void> {

  const messages: Map<string, vscode.Diagnostic[]> = new Map()
  output.clear()
  diagnostics.clear()

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Window,
    cancellable: true,
    title: `${command} in progress` }, async (progress, token) => {
      await cabalBuild(ed, context, command, {
        setCancelAction: (action: () => void) => {
          token.onCancellationRequested(action)
        },
        onMsg: (raw:string, uri?: vscode.Uri, diagnostic?: vscode.Diagnostic) => {
          output.append(raw+"\n")
          if (uri && diagnostic) {
            const str = uri.toString()
            let ds = messages.get(str)
            if (ds === undefined) {
              ds = []
              messages.set(str, ds)
            }
            ds.push(diagnostic)
            diagnostics.set(uri, ds)
          }
        },
        onProgress: (message: string) => progress.report({message}),
      }, progress)
    })
  for (const [fn, ds] of messages.entries()) {
    diagnostics.set(vscode.Uri.file(fn), ds);
  }
}
