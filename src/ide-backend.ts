import * as path from 'path'
import * as vscode from 'vscode'
import * as Builders from './builders'
import {posix as nodePath} from 'path'

interface BuilderParamType {
  name: 'cabal-v2' | 'stack' | 'none'
}

interface ICommandOptions {
  canCancel: boolean
}

interface BuilderConstructor {
  new (opts: Builders.CtorOpts): Builders.Builder
}

type TBuilders = Record<
  BuilderParamType['name'],
  BuilderConstructor | undefined
>

export interface ITarget {
  type: 'library' | 'executable' | 'test-suite' | 'benchmark'
  name: string
  target: string
}

export interface IDotCabal {
  name: string
  version: string
  targets: ITarget[]
}

export interface IImport {
  name: string
  qualified: boolean
  hiding: boolean
  importList: null | Array<string | { parent: string }>
  alias: null | string
}

export interface IModuleImports {
  name: string
  imports: IImport[]
}

export interface ProjectDesc {
  project: string
  dir?: vscode.Uri
}

export type TargetParamType = (
  | {
      type: 'component'
      target: ITarget
      component: string
    }
  | {
      type: 'all'
    }
  | {
      type: 'auto'
    }
) &
  ProjectDesc
export type TargetParamTypeForBuilder = (
  | {
      type: 'component'
      component: string
    }
  | {
      type: 'all'
      targets: ITarget[]
    }
  | {
      type: 'auto'
    }
) &
  ProjectDesc
export type CabalCommand = 'build' | 'clean' | 'test' | 'bench'


const commandOptions: { [K in CabalCommand]: ICommandOptions } = {
  build: {
    canCancel: true,
  },
  clean: {
    canCancel: false,
  },
  test: {
    canCancel: true,
  },
  bench: {
    canCancel: true,
  },
}

function getRootDirFallback(file: vscode.Uri): vscode.Uri | undefined {
  const dir = vscode.workspace.workspaceFolders?.find(f => nodePath.relative(f.uri.path, file.path) !== file.path)
  if (dir) {
    return dir.uri
  } else {
    return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]?.uri
  }
}

async function dirHasCabalFile(d: vscode.Uri) {
  const entries = await vscode.workspace.fs.readDirectory(d)
  return entries.some(
    (file) => file[1] === vscode.FileType.File && file[0].endsWith('.cabal'),
  )
}

async function findProjectRoot(
  d: vscode.Uri,
  check: (d: vscode.Uri) => Promise<boolean>,
) {
  while (nodePath.dirname(d.path) !== d.path) {
    if (await check(d)) {
      return d
    }
    d = d.with({path: nodePath.dirname(d.path)})
  }
  return null
}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
  const stat = await vscode.workspace.fs.stat(uri)
  return stat.type === vscode.FileType.Directory
}

async function getRootDir(input: vscode.Uri): Promise<vscode.Uri | undefined> {
  const dir = await isDirectory(input)
    ? input
    : input.with({path: nodePath.dirname(input.path)})
  const cabalRoot = await findProjectRoot(dir, dirHasCabalFile)
  if (!(cabalRoot && await isDirectory(cabalRoot))) {
    return getRootDirFallback(input)
  } else {
    return cabalRoot
  }
}

import CP = require('child_process')
const cabal2jsonPath = path.join(__dirname, '..', 'bin', 'cabal2json.min.js')

async function runCabal2Json<T>(cabalSource: Uint8Array, args: string[], def: T) {
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
        'Atom-Haskell core error in getComponentFromFile',
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

async function parseDotCabal(cabalSource: Uint8Array) {
  return runCabal2Json<IDotCabal | null>(cabalSource, [], null)
}

async function getComponentFromFile(
  cabalSource: Uint8Array,
  filePath: string,
) {
  const fp =
    process.platform === 'win32'
      ? filePath.replace(path.sep, path.posix.sep)
      : filePath
  return runCabal2Json<string[]>(cabalSource, [fp], [])
}

export class IdeBackend {
  private diagnostics: vscode.DiagnosticCollection
  private output: vscode.OutputChannel
  private defaultTarget: TargetParamType = {
    project: 'Auto',
    type: 'auto',
    dir: undefined,
  }

  constructor(private context: vscode.ExtensionContext) {
    this.diagnostics = vscode.languages.createDiagnosticCollection('haskell')
    this.output = vscode.window.createOutputChannel('Haskell Build')
    context.subscriptions.push(
      this.diagnostics,
      this.output,
      vscode.commands.registerTextEditorCommand(`haskell-build.build`, (ed) => this.runBuilderCommand(ed, 'build')),
      vscode.commands.registerTextEditorCommand(`haskell-build.test`, (ed) => this.runBuilderCommand(ed, 'test')),
      vscode.commands.registerTextEditorCommand(`haskell-build.clean`, (ed) => this.runBuilderCommand(ed, 'clean')),
      vscode.commands.registerTextEditorCommand(`haskell-build.bench`, (ed) => this.runBuilderCommand(ed, 'bench')),
      vscode.commands.registerCommand(`haskell-build.set-build-target`, async () => {
        const targets = await this.targetParamInfo()
        const target = await vscode.window.showQuickPick(targets)
        context.workspaceState.update('target', target?.handle)
      }),
      vscode.commands.registerCommand(`haskell-build.set-builder`, async () => {
        await this.selectBuilder()
      }),
    )
  }

  private async selectBuilder() {
    const targets = await this.builderParamInfo()
    const target = await vscode.window.showQuickPick(targets)
    this.context.workspaceState.update('builder', target?.handle)
    return target?.handle
  }

  private builderParamInfo(): Array<vscode.QuickPickItem & {handle: BuilderParamType}> {
    const builders: BuilderParamType[] = [
      { name: 'cabal-v2' },
      { name: 'stack' },
      { name: 'none' },
    ]
    return builders.map(t => ({
      label: t.name,
      handle: t
    }))
  }

  private async targetParamInfo(): Promise<Array<vscode.QuickPickItem & {handle: TargetParamType}>> {
    const projects: TargetParamType[] = [this.defaultTarget]
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
      label: `${t.project}: ${t.type === 'component' ? t.target.target : t.type}`,
      detail: t.dir?.fsPath,
      handle: t,
    }))
  }

  private getActiveProjectPath(editor: vscode.TextEditor): vscode.Uri {
    const uri = editor.document.uri
    if (uri) {
      return uri.with({path: nodePath.dirname(uri.path)})
    }
    return (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]?.uri) ||
      vscode.Uri.file(process.cwd())
  }

  private async getActiveProjectTarget(
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

  private async cabalBuild(
    ed: vscode.TextEditor,
    cmd: CabalCommand,
    params: Builders.IParams,
    progress: vscode.Progress<{message: string, increment: number}>,
  ): Promise<void> {
    try {
      let builderParam: BuilderParamType | undefined = this.context.workspaceState.get('builder')
      let target = this.context.workspaceState.get<TargetParamType>('target')

      if (target === undefined) {
        target = this.defaultTarget
      }
      if (builderParam === undefined) {
        builderParam = await this.selectBuilder()
        if (builderParam === undefined) {
          return
        }
      }

      const cabalRoot = await getRootDir(
        target.dir ? vscode.Uri.from(target.dir) : this.getActiveProjectPath(ed),
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
        const tgts = await this.getActiveProjectTarget(ed, cabalContents, cabalRoot)
        const [tgt] = tgts
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
      const builder = builders[builderParam.name]

      if (builder === undefined) {
        throw new Error(
          `Unknown builder '${(builderParam && builderParam.name) ||
            builderParam}'`,
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
          message: 'Build was interrupted',
          increment: 100
        })
      } else if (res.exitCode !== 0) {
        if (res.hasError) {
          progress.report({
            message: 'There were errors in source files',
            increment: 100
          })
        } else {
          progress.report({
            message: `Builder quit abnormally with exit code ${res.exitCode}`,
            increment: 100
          })
        }
      } else {
        progress.report({
          message: 'Build was successful',
          increment: 100
        })
      }
    } catch (error) {
      console.error(error)
      vscode.window.showErrorMessage((error as Error).toString())
    }
  }

  private async runBuilderCommand(ed: vscode.TextEditor, command: CabalCommand): Promise<void> {
    const { canCancel } = commandOptions[command]
    const messages: Map<vscode.Uri, vscode.Diagnostic[]> = new Map()
    this.output.clear()
    this.output.show(true)
    this.diagnostics.clear()

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
      title: `${command} in progress` }, async (progress, token) => {
        await this.cabalBuild(ed, command, {
          setCancelAction: canCancel
            ? (action: () => void) => {
                token.onCancellationRequested(action)
              }
            : undefined,
          onMsg: (raw:string, uri?: vscode.Uri, diagnostic?: vscode.Diagnostic) => {
            this.output.append(raw+"\n")
            if (uri && diagnostic) {
              if (!messages.has(uri)) {
                messages.set(uri,[])
              }
              messages.get(uri)?.push(diagnostic)
              this.diagnostics.set(uri, messages.get(uri))
            }
          },
          onProgress: canCancel
            ? (message: string) =>
                progress.report({message})
            : undefined,
        }, progress)
      })
  }
}
