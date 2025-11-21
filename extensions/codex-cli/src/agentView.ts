/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export class AgentViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewId = 'codexAgentView';

	constructor(private readonly context: vscode.ExtensionContext) { }

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		const { webview } = webviewView;

		webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.context.extensionUri, 'media'),
			],
		};

		webview.html = this.getHtmlForWebview(webview);
	}

	private getHtmlForWebview(webview: vscode.Webview): string {
		const nonce = getNonce();

		const csp = [
			`default-src 'none';`,
			`img-src ${webview.cspSource} https: data:;`,
			`style-src 'nonce-${nonce}' ${webview.cspSource};`,
			`font-src ${webview.cspSource} https: data:;`,
			`script-src 'none';`,
		].join(' ');

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<style nonce="${nonce}">
		:root {
			color-scheme: light dark;
		}

		body {
			margin: 0;
			padding: 0;
			font-family: var(--vscode-font-family);
			color: var(--vscode-editor-foreground);
			background: var(--vscode-editor-background);
			height: 100vh;
			display: flex;
		}

		.agent-shell {
			flex: 1;
			display: flex;
			flex-direction: column;
			height: 100%;
			background: var(--vscode-editor-background);
		}

		.agent-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 10px 14px;
			border-bottom: 1px solid var(--vscode-panel-border);
			background: var(--vscode-sideBar-background);
			position: sticky;
			top: 0;
			z-index: 1;
		}

		.agent-title {
			font-size: 13px;
			font-weight: 600;
			letter-spacing: 0.2px;
		}

		.agent-status {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			padding: 2px 6px;
			border-radius: 4px;
			border: 1px solid var(--vscode-input-border);
		}

		.messages {
			flex: 1;
			overflow-y: auto;
			padding: 12px;
			display: flex;
			flex-direction: column;
			gap: 10px;
			background: var(--vscode-editor-background);
		}

		.message {
			display: flex;
			flex-direction: column;
			gap: 4px;
			padding: 10px 12px;
			border-radius: 10px;
			border: 1px solid var(--vscode-textBlockQuote-border);
			background: var(--vscode-editorHoverWidget-background);
			box-shadow: 0 1px 0 var(--vscode-widget-shadow, transparent);
		}

		.message.assistant {
			border-color: var(--vscode-inputOption-activeBorder);
			background: var(--vscode-editorWidget-background);
		}

		.message .meta {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			text-transform: uppercase;
			letter-spacing: 0.3px;
		}

		.message .body {
			font-size: 13px;
			line-height: 1.5;
		}

		.input-row {
			border-top: 1px solid var(--vscode-panel-border);
			background: var(--vscode-sideBar-background);
			padding: 10px 12px;
		}

		.input-row form {
			display: flex;
			gap: 8px;
			align-items: center;
		}

		.input-row input[type="text"] {
			flex: 1;
			border-radius: 6px;
			padding: 8px 10px;
			border: 1px solid var(--vscode-input-border);
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			font-size: 13px;
		}

		.input-row input::placeholder {
			color: var(--vscode-input-placeholderForeground);
		}

		.input-row button {
			min-width: 68px;
			border-radius: 6px;
			border: 1px solid var(--vscode-button-border, transparent);
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			height: 32px;
			padding: 0 12px;
			font-size: 12px;
		}

		.input-row button:disabled {
			opacity: 0.6;
			cursor: default;
		}
	</style>
</head>
<body>
	<div class="agent-shell">
		<header class="agent-header">
			<div class="agent-title">Agent</div>
			<div class="agent-status">Prototype</div>
		</header>
		<section class="messages" aria-label="Agent messages">
			<div class="message">
				<div class="meta">You</div>
				<div class="body">How can I automate my workflow?</div>
			</div>
			<div class="message assistant">
				<div class="meta">Agent</div>
				<div class="body">This is a placeholder for Codex responses. The final experience will show full conversation history here.</div>
			</div>
			<div class="message">
				<div class="meta">You</div>
				<div class="body">Let me know when you're ready!</div>
			</div>
		</section>
		<div class="input-row">
			<form aria-label="Send a prompt" onsubmit="event.preventDefault();">
				<input type="text" name="prompt" placeholder="Ask the Agent..." aria-label="Agent prompt" />
				<button type="submit" disabled>Send</button>
			</form>
		</div>
	</div>
</body>
</html>`;
	}
}

function getNonce(): string {
	const possible =
		'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 16; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
