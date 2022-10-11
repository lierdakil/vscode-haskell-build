import * as vscode from 'vscode'
import { posix as nodePath } from 'path'

function getRootDirFallback(file: vscode.Uri): vscode.Uri | undefined {
  const dir = vscode.workspace.workspaceFolders?.find(
    (f) => nodePath.relative(f.uri.path, file.path) !== file.path,
  )
  if (dir) {
    return dir.uri
  } else {
    return (
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders[0]?.uri
    )
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
    d = d.with({ path: nodePath.dirname(d.path) })
  }
  return null
}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
  const stat = await vscode.workspace.fs.stat(uri)
  return stat.type === vscode.FileType.Directory
}

export async function getRootDir(
  input: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  const dir = (await isDirectory(input))
    ? input
    : input.with({ path: nodePath.dirname(input.path) })
  const cabalRoot = await findProjectRoot(dir, dirHasCabalFile)
  if (!(cabalRoot && (await isDirectory(cabalRoot)))) {
    return getRootDirFallback(input)
  } else {
    return cabalRoot
  }
}
