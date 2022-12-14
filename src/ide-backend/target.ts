import * as vscode from 'vscode'
import { getRootDir } from '../util'
import { parseDotCabal } from '../cabal2json'
import { TargetParamType } from '../builders'

export const defaultTarget: Readonly<TargetParamType> = {
  project: 'Auto',
  type: 'auto',
  dir: undefined,
}

async function targetParamInfo(): Promise<
  Array<vscode.QuickPickItem & { handle: TargetParamType }>
> {
  const projects: TargetParamType[] = [defaultTarget]
  for (const d of vscode.workspace.workspaceFolders || []) {
    const dir = d.uri
    const rootDir = await getRootDir(dir)
    if (!rootDir) {
      continue
    }
    const cabalFile = (await vscode.workspace.fs.readDirectory(rootDir)).find(
      (f) => f[1] === vscode.FileType.File && f[0].endsWith('.cabal'),
    )
    if (cabalFile) {
      const data = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(rootDir, cabalFile[0]),
      )
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
  return projects.map((t) => ({
    label: `${t.project}: ${t.type === 'component' ? t.target.name : t.type}`,
    detail: t.dir?.fsPath,
    description: t.type === 'component' ? t.component : undefined,
    handle: t,
  }))
}

export async function setBuildTarget(context: vscode.ExtensionContext) {
  const targets = await targetParamInfo()
  const target = await vscode.window.showQuickPick(targets)
  context.workspaceState.update('target', target?.handle)
}
