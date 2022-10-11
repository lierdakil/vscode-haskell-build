import * as vscode from 'vscode'
import { init } from './ide-backend'

export function activate(context: vscode.ExtensionContext): void {
  init(context)
}

// this method is called when your extension is deactivated
export function deactivate(): void {}
