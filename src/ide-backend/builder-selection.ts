import * as vscode from 'vscode'

export type BuilderParamType = 'cabal-v2' | 'stack' | 'none'

const builderParamInfo: ReadonlyArray<vscode.QuickPickItem> = [
  { label: 'cabal-v2' },
  { label: 'stack' },
  { label: 'none' },
]

export async function selectBuilder(context: vscode.ExtensionContext) {
  const target = await vscode.window.showQuickPick(builderParamInfo)
  if (target) {
    context.workspaceState.update('builder', target?.label)
  }
  return target?.label as BuilderParamType
}
