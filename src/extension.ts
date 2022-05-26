import * as vscode from 'vscode';
import { IdeBackend } from './ide-backend';

export function activate(context: vscode.ExtensionContext) {
	new IdeBackend(context)
}

// this method is called when your extension is deactivated
export function deactivate() {}
