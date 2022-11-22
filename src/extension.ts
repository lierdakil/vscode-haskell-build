import * as vscode from 'vscode'
import { runBuilderCommand, selectBuilder, setBuildTarget } from './ide-backend'

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('haskell')
  const output = vscode.window.createOutputChannel('Haskell Build')
  context.subscriptions.push(
    diagnostics,
    output,
    vscode.commands.registerTextEditorCommand(`haskell-build.build`, (ed) =>
      runBuilderCommand(ed, output, diagnostics, context, 'build'),
    ),
    vscode.commands.registerTextEditorCommand(`haskell-build.test`, (ed) =>
      runBuilderCommand(ed, output, diagnostics, context, 'test'),
    ),
    vscode.commands.registerTextEditorCommand(`haskell-build.clean`, (ed) =>
      runBuilderCommand(ed, output, diagnostics, context, 'clean'),
    ),
    vscode.commands.registerTextEditorCommand(`haskell-build.bench`, (ed) =>
      runBuilderCommand(ed, output, diagnostics, context, 'bench'),
    ),
    vscode.commands.registerCommand(`haskell-build.set-build-target`, () =>
      setBuildTarget(context),
    ),
    vscode.commands.registerCommand(`haskell-build.set-builder`, () =>
      selectBuilder(context),
    ),
  )
}

// this method is called when your extension is deactivated
export function deactivate(): void {}
