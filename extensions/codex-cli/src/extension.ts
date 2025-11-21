/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CodexBinaryError, CodexClient } from './codexClient';
import { AgentViewProvider } from './agentView';

const output = vscode.window.createOutputChannel('Codex');

export function activate(context: vscode.ExtensionContext): void {
	// Make sure the secondary sidebar is visible and focus our container by default.
	void vscode.commands.executeCommand('workbench.action.focusAuxiliaryBar').then(() => {
		void vscode.commands.executeCommand('workbench.view.extension.codexAgent');
	});

	const codexClient = new CodexClient(context);
	// TODO: Wire Codex events into actual apply-edits flow when available.

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			AgentViewProvider.viewId,
			new AgentViewProvider(context),
			{ webviewOptions: { retainContextWhenHidden: true } }
		)
	);

	const disposable = vscode.commands.registerCommand('codex.runTask', async () => {
		const prompt = await vscode.window.showInputBox({
			prompt: 'What should Codex do?',
			placeHolder: 'Describe the task you want Codex to execute'
		});

		if (!prompt) {
			return;
		}

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			vscode.window.showErrorMessage('Open a workspace folder before running Codex.');
			return;
		}

		const cwd = workspaceFolders[0].uri.fsPath;

		output.clear();
		output.appendLine(`Prompt: ${prompt}`);
		output.appendLine(`CWD: ${cwd}`);
		output.show(true);

		try {
			await codexClient.runExec(prompt, cwd, (evt) => {
				output.appendLine(JSON.stringify(evt, null, 2));
			});
		} catch (err) {
			const message = formatFriendlyError(err);
			vscode.window.showErrorMessage(message);
			output.appendLine(`Error: ${message}`);
		}
	});

	context.subscriptions.push(disposable, output);
}

export function deactivate(): void {
	// No-op
}

function formatFriendlyError(err: unknown): string {
	if (err instanceof CodexBinaryError) {
		return err.message;
	}

	if (err && typeof err === 'object' && Object.prototype.hasOwnProperty.call(err, 'message')) {
		const nodeErr = err as NodeJS.ErrnoException;
		if (nodeErr.code === 'ENOENT') {
			return 'Codex CLI binary not found or not executable.';
		}
		return String(nodeErr.message);
	}

	return 'Codex CLI failed to start.';
}
