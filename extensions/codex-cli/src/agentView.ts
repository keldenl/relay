/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { CodexBinaryError, CodexClient, CodexEvent } from './codexClient';
import { summarizeCommand } from './commandSummary';

type AgentMessageRole = 'assistant' | 'command' | 'system' | 'user';
type AuthStatus = 'checking' | 'loggedIn' | 'loggedOut' | 'loggingIn' | 'error';

type WebviewMessage =
	| {
		type: 'appendMessage';
		role?: AgentMessageRole;
		text?: string;
		command?: string;
		friendlyTitle?: string;
		friendlySummary?: string;
		targets?: Array<{ label: string; path: string; isDir?: boolean }>;
		parsed?: ReturnType<typeof summarizeCommand>['parsed'];
	}
	| { type: 'clearMessages' }
	| { type: 'setBusy'; busy?: boolean }
	| { type: 'reasoningUpdate'; text?: string }
	| { type: 'authState'; status: AuthStatus; detail?: string };

export class AgentViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewId = 'codexAgentView';

	private readonly codexClient: CodexClient;
	private busy = false;
	private authStatus: AuthStatus = 'checking';
	private lastCwd: string | undefined;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.codexClient = new CodexClient(context);
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		const { webview } = webviewView;

		webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.context.extensionUri, 'media'),
			],
		};

		webview.html = this.getHtmlForWebview(webview);
		void this.refreshAuthState(webviewView);

		webview.onDidReceiveMessage((message) => {
			if (message?.type === 'submitPrompt') {
				const prompt = typeof message.prompt === 'string' ? message.prompt : '';
				void this.handlePrompt(webviewView, prompt);
			}

			if (message?.type === 'requestLogin') {
				void this.handleLogin(webviewView);
			}

			if (message?.type === 'requestStatus') {
				void this.refreshAuthState(webviewView);
			}

			if (message?.type === 'openPath' && typeof message.path === 'string') {
				const target = vscode.Uri.file(message.path);
				if (message.isDir) {
					void vscode.window
						.showWarningMessage(
							`Open folder "${path.basename(message.path)}" in Finder?`,
							{ modal: true },
							'Open'
						)
						.then((choice) => {
							if (choice === 'Open') {
								void vscode.commands.executeCommand('revealFileInOS', target);
							}
						});
				} else {
					void vscode.commands.executeCommand('vscode.open', target);
				}
			}
		});
	}

	private async handlePrompt(webviewView: vscode.WebviewView, prompt: string): Promise<void> {
		const webview = webviewView.webview;
		const trimmed = prompt.trim();

		if (!trimmed) {
			return;
		}

		if (this.authStatus !== 'loggedIn') {
			this.postToWebview(webview, {
				type: 'appendMessage',
				role: 'system',
				text: 'Please sign in to Codex before running the agent.',
			});
			return;
		}

		if (this.busy) {
			this.postToWebview(webview, {
				type: 'appendMessage',
				role: 'system',
				text: 'Agent is already running. Please wait…',
			});
			return;
		}

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			this.postToWebview(webview, {
				type: 'appendMessage',
				role: 'system',
				text: 'Open a folder before running the agent.',
			});
			return;
		}

		const cwd = workspaceFolders[0].uri.fsPath;
		this.lastCwd = cwd;

		this.busy = true;
		this.postToWebview(webview, { type: 'setBusy', busy: true });

		// Echo the user's prompt into the log for context.
		this.postToWebview(webview, {
			type: 'appendMessage',
			role: 'user',
			text: trimmed,
		});

		try {
			await this.codexClient.runExec(trimmed, cwd, (evt) => this.forwardCodexEvent(webview, evt));
		} catch (err) {
			const handled = await this.handleRunError(webview, err, trimmed, cwd);
			if (!handled) {
				this.postToWebview(webview, {
					type: 'appendMessage',
					role: 'assistant',
					text: this.formatFriendlyError(err),
				});
			}
		} finally {
			this.busy = false;
			this.postToWebview(webview, { type: 'setBusy', busy: false });
		}
	}

	private forwardCodexEvent(webview: vscode.Webview, evt: CodexEvent): void {
		if (evt.type === 'item.completed' && evt.item?.type === 'agent_message') {
			this.postToWebview(webview, {
				type: 'appendMessage',
				role: 'assistant',
				text: evt.item.text ?? '',
			});
			this.postToWebview(webview, { type: 'reasoningUpdate', text: undefined });
			return;
		}

		if (evt.type === 'item.completed' && evt.item?.type === 'reasoning') {
			this.postToWebview(webview, { type: 'reasoningUpdate', text: evt.item.text ?? '' });
			return;
		}

		if (evt.type === 'item.completed' && evt.item?.type === 'command_execution') {
			const text = evt.item.aggregated_output ?? '';
			const command = evt.item.command ?? '';
			const summary = summarizeCommand(command);
			const parsedWithAbs = summary.parsed.map((p) => {
				const rawPath = p.path;
				const abs = rawPath
					? path.isAbsolute(rawPath)
						? rawPath
						: this.lastCwd
							? path.join(this.lastCwd, rawPath)
							: rawPath
					: undefined;
				return { ...p, absPath: abs };
			});
			const targets = parsedWithAbs
				.filter((p) => p.absPath)
				.map((p) => ({
					label: p.name ?? p.path ?? p.raw,
					path: p.absPath!,
					isDir: p.kind === 'list',
				}));
			this.postToWebview(webview, {
				type: 'appendMessage',
				role: 'command',
				text,
				command: summary.displayCommand,
				// Drop "Explored" wording; keep "Ran" for non-exploratory.
				friendlyTitle: summary.title === 'Explored' ? '' : summary.title,
				friendlySummary: summary.summary,
				targets,
				parsed: parsedWithAbs,
			});
		}
	}

	private async handleRunError(webview: vscode.Webview, err: unknown, prompt: string, cwd: string): Promise<boolean> {
		const nodeErr = err as NodeJS.ErrnoException;

		if (err instanceof CodexBinaryError || nodeErr?.code === 'ENOENT') {
			this.postToWebview(webview, {
				type: 'appendMessage',
				role: 'assistant',
				text: this.formatFriendlyError(err),
			});
			this.postToWebview(webview, {
				type: 'appendMessage',
				role: 'assistant',
				text: 'Codex CLI unavailable. Showing a sample stream instead.',
			});
			await this.simulateStream(webview, prompt, cwd);
			this.postToWebview(webview, {
				type: 'appendMessage',
				role: 'assistant',
				text: 'Simulation complete.',
			});
			return true;
		}

		return false;
	}

	private async refreshAuthState(webviewView: vscode.WebviewView): Promise<void> {
		const webview = webviewView.webview;
		this.authStatus = 'checking';
		this.postAuthState(webview, 'checking', 'Checking Codex login status…');

		try {
			const status = await this.codexClient.checkLoginStatus();
			this.authStatus = status.loggedIn ? 'loggedIn' : 'loggedOut';
			const detail = status.raw || (status.loggedIn ? 'Logged in' : 'Not logged in');
			this.postAuthState(webview, this.authStatus, detail);
		} catch (err) {
			this.authStatus = 'error';
			this.postAuthState(webview, 'error', this.formatFriendlyError(err));
		}
	}

	private async handleLogin(webviewView: vscode.WebviewView): Promise<void> {
		const webview = webviewView.webview;
		this.authStatus = 'loggingIn';
		this.postAuthState(webview, 'loggingIn', 'Opening browser for Codex login…');

		try {
			await this.codexClient.runLogin();
			await this.refreshAuthState(webviewView);
		} catch (err) {
			this.authStatus = 'error';
			this.postAuthState(webview, 'error', this.formatFriendlyError(err));
		}
	}

	private async simulateStream(webview: vscode.Webview, prompt: string, cwd: string): Promise<void> {
		const fakeEvents: CodexEvent[] = [
			{
				type: 'item.completed',
				item: { type: 'reasoning', text: `**Received prompt**\n${prompt}` }
			},
			{
				type: 'item.completed',
				item: { type: 'reasoning', text: '**Assessing workspace...**' }
			},
			{
				type: 'item.completed',
				item: {
					type: 'command_execution',
					command: `/bin/zsh -lc "ls ${cwd}"`,
					aggregated_output: `ls ${cwd}\nREADME.md\nsrc\npackage.json\n`
				}
			},
			{
				type: 'item.completed',
				item: { type: 'reasoning', text: '**Drafting response**' }
			},
			{
				type: 'item.completed',
				item: { type: 'agent_message', text: 'Here is the summarized answer based on the workspace.' }
			}
		];

		let delay = 0;
		await new Promise<void>((resolve) => {
			for (const evt of fakeEvents) {
				delay += 350;
				setTimeout(() => this.forwardCodexEvent(webview, evt), delay);
			}
			setTimeout(() => resolve(), delay + 200);
		});
	}

	private postAuthState(webview: vscode.Webview, status: AuthStatus, detail?: string): void {
		this.postToWebview(webview, { type: 'authState', status, detail });
	}

	private postToWebview(webview: vscode.Webview, message: WebviewMessage): void {
		webview.postMessage(message).then(undefined, console.error);
	}

	private getHtmlForWebview(webview: vscode.Webview): string {
		const nonce = getNonce();

		const csp = [
			`default-src 'none';`,
			`img-src ${webview.cspSource} https: data:;`,
			`style-src 'nonce-${nonce}' ${webview.cspSource};`,
			`font-src ${webview.cspSource} https: data:;`,
			`script-src 'nonce-${nonce}';`,
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

		.login-shell {
			flex: 1;
			display: none;
			padding: 24px;
			background: var(--vscode-editor-background);
			align-items: center;
			justify-content: center;
		}

		.login-content {
			display: flex;
			flex-direction: column;
			gap: 12px;
			text-align: center;
		}

		.login-title {
			font-size: 16px;
			font-weight: 600;
			letter-spacing: 0.2px;
		}

		.login-copy {
			margin: 0;
			color: var(--vscode-descriptionForeground);
			line-height: 1.4;
			font-size: 13px;
		}

		.login-button {
			align-self: center;
			border-radius: 6px;
			height: 34px;
			padding: 0 16px;
			border: 1px solid var(--vscode-button-border, transparent);
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			font-size: 12px;
			font-weight: 600;
		}

		.login-button:disabled {
			opacity: 0.75;
			cursor: default;
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
			display: flex;
			gap: 8px;
			align-items: center;
			font-size: 13px;
			font-weight: 600;
			letter-spacing: 0.2px;
		}

		.agent-status {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			padding: 2px 8px;
			border-radius: 100px;
			border: 1px solid var(--vscode-input-border);
			background: var(--vscode-sideBarSectionHeader-background, transparent);
			min-width: 72px;
			text-align: center;
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

		.reasoning-bar {
			display: flex;
			align-items: center;
			gap: 10px;
			padding: 10px 12px;
			border-top: 1px solid var(--vscode-panel-border);
			background: var(--vscode-editorWidget-background);
			box-shadow: 0 -1px 0 var(--vscode-widget-shadow, transparent);
		}

		.reasoning-bar[hidden] {
			display: none;
		}

		.reasoning-spinner {
			width: 14px;
			height: 14px;
			border-radius: 50%;
			border: 2px solid var(--vscode-foreground);
			border-color: var(--vscode-foreground) transparent var(--vscode-foreground) transparent;
			animation: spin 1s linear infinite;
			flex-shrink: 0;
		}

		.reasoning-text {
			font-size: 12px;
			color: var(--vscode-foreground);
			font-weight: 600;
			line-height: 1.4;
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

		.message.command {
			font-family: var(--vscode-editor-font-family, SFMono-Regular, Consolas, 'Liberation Mono', monospace);
			background: var(--vscode-input-background);
			border-style: dashed;
		}

		.message.command .command-title {
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
		}

		.message.command pre {
			margin: 4px 0 0;
			max-height: 5.2em;
			overflow: auto;
			padding: 6px 8px;
			background: var(--vscode-editor-background);
			border-radius: 6px;
			border: 1px solid var(--vscode-textBlockQuote-border);
			white-space: pre-wrap;
			line-height: 1.2;
		}

		a {
			color: var(--vscode-textLink-foreground);
		}

		.message.system {
			border: 1px dashed var(--vscode-textBlockQuote-border);
			color: var(--vscode-descriptionForeground);
			background: var(--vscode-sideBar-background);
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
			white-space: pre-wrap;
		}

		.message .body pre {
			margin: 0;
			font-family: inherit;
			white-space: pre-wrap;
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

		@keyframes spin {
			0% { transform: rotate(0deg); }
			100% { transform: rotate(360deg); }
		}
	</style>
</head>
<body>
	<div class="login-shell" data-login-shell>
		<div class="login-content">
			<div class="login-title">Sign in to Codex</div>
			<button type="button" class="login-button" data-login-button>Log in with ChatGPT</button>
		</div>
	</div>
	<div class="agent-shell" data-agent-shell>
		<header class="agent-header">
			<div class="agent-title">Agent</div>
			<div class="agent-status" data-status>Ready</div>
		</header>
		<section class="messages" aria-label="Agent messages" data-messages></section>
		<div class="reasoning-bar" data-reasoning hidden aria-hidden="true">
			<div class="reasoning-spinner" aria-hidden="true"></div>
			<div class="reasoning-text" data-reasoning-text>Thinking…</div>
		</div>
		<div class="input-row">
			<form aria-label="Send a prompt" data-form>
				<input type="text" name="prompt" placeholder="Ask the Agent..." aria-label="Agent prompt" data-input />
				<button type="submit" data-send>Send</button>
			</form>
		</div>
	</div>
	<script nonce="${nonce}">
		(function () {
			const vscode = acquireVsCodeApi();
			const messagesEl = document.querySelector('[data-messages]');
			const form = document.querySelector('[data-form]');
			const input = document.querySelector('[data-input]');
			const sendButton = document.querySelector('[data-send]');
			const statusEl = document.querySelector('[data-status]');
			const agentShell = document.querySelector('[data-agent-shell]');
			const loginShell = document.querySelector('[data-login-shell]');
			const loginButton = document.querySelector('[data-login-button]');
			const reasoningBar = document.querySelector('[data-reasoning]');
			const reasoningText = document.querySelector('[data-reasoning-text]');

			/** @type {Array<{ role: string, text: string, command?: string, friendlyTitle?: string, friendlySummary?: string, targets?: Array<{label: string, path: string, isDir?: boolean}>, parsed?: any[] }>} */
			const messages = [];
			let busy = false;
			let authState = 'checking';
			let currentReasoning = '';

			const roleLabel = (role) => {
				if (role === 'assistant') return 'Assistant';
				if (role === 'command') return 'Command';
				if (role === 'system') return 'System';
				if (role === 'user') return 'You';
				return 'Agent';
			};

			function setAuthState(next) {
				const isLoggedIn = next.status === 'loggedIn';
				if (agentShell) agentShell.style.display = isLoggedIn ? 'flex' : 'none';
				if (loginShell) loginShell.style.display = isLoggedIn ? 'none' : 'flex';

				const loggingIn = next.status === 'loggingIn';
				if (loginButton) {
					loginButton.disabled = loggingIn;
					loginButton.textContent = loggingIn ? 'Opening…' : 'Log in with ChatGPT';
				}
			}

			// No HTML injection needed; content is set via textContent.

			// We intentionally keep rendering simple (plain text + preserved newlines) to avoid regex pitfalls.
			function renderPlain(text) {
				return text ?? '';
			}

			function buildSummary(msg) {
				// If we have parsed commands, render inline with links.
				if (Array.isArray(msg.parsed) && msg.parsed.length > 0) {
					const span = document.createElement('span');
						msg.parsed.forEach((p, idx) => {
							if (idx > 0) span.appendChild(document.createTextNode(' | '));
						if (p.kind === 'read') {
							span.appendChild(document.createTextNode('Read '));
								span.appendChild(makeLink(p.label || p.name || p.path || p.raw, p.absPath || p.path, false));
							} else if (p.kind === 'list') {
								span.appendChild(document.createTextNode('Listed '));
								span.appendChild(makeLink(p.label || p.name || p.path || '.', p.absPath || p.path || '.', true));
							} else if (p.kind === 'search') {
								span.appendChild(document.createTextNode('Searched '));
								if (p.query) {
									span.appendChild(document.createTextNode('"' + p.query + '"'));
									if (p.path) {
										span.appendChild(document.createTextNode(' in '));
										span.appendChild(makeLink(p.label || p.name || p.path, p.absPath || p.path, true));
									}
								} else if (p.path) {
									span.appendChild(makeLink(p.label || p.name || p.path, p.absPath || p.path, true));
								} else {
									span.appendChild(document.createTextNode('files'));
								}
							} else {
								span.appendChild(document.createTextNode('Ran ' + p.raw));
						}
					});
					return span;
				}
				const fallback = document.createElement('span');
				fallback.textContent = msg.friendlySummary
					|| (msg.command ? '> ' + msg.command : 'Command output');
				return fallback;
			}

			function makeLink(label, path, isDir) {
				const a = document.createElement('a');
				a.href = '#';
				a.textContent = label;
				a.addEventListener('click', (e) => {
					e.preventDefault();
					vscode.postMessage({ type: 'openPath', path, isDir: Boolean(isDir) });
				});
				return a;
			}

			function setReasoning(text) {
				currentReasoning = (text ?? '').trim();
				if (!reasoningBar || !reasoningText) {
					return;
				}

				const shouldShow = busy || currentReasoning.length > 0;
				const displayText = currentReasoning || 'Thinking…';

				reasoningBar.hidden = !shouldShow;
				reasoningBar.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
				reasoningText.textContent = shouldShow ? displayText : '';
			}

			function render() {
				if (!messagesEl) { return; }
				messagesEl.innerHTML = '';
				for (const msg of messages) {
					if (msg.role === 'system') {
						continue; // hide system messages from view
					}
					const wrapper = document.createElement('div');
					wrapper.className = ['message', msg.role].filter(Boolean).join(' ');

					const meta = document.createElement('div');
					meta.className = 'meta';
					meta.textContent = msg.friendlyTitle || roleLabel(msg.role);

					let body;

					if (msg.role === 'command') {
						const title = document.createElement('div');
						title.className = 'command-title';
						title.appendChild(buildSummary(msg));

						body = document.createElement('pre');
						body.className = 'body';
						body.textContent = msg.text ?? '';

						wrapper.appendChild(meta);
						wrapper.appendChild(title);
						wrapper.appendChild(body);
					} else {
						body = document.createElement('div');
						body.className = 'body';
						body.textContent = renderPlain(msg.text ?? '');
						wrapper.appendChild(meta);
						wrapper.appendChild(body);
					}

					messagesEl.appendChild(wrapper);
				}

				requestAnimationFrame(() => {
					messagesEl.scrollTop = messagesEl.scrollHeight;
				});
			}

			function setBusy(nextBusy) {
				busy = Boolean(nextBusy);
				if (statusEl) {
					statusEl.textContent = busy ? 'Running…' : 'Ready';
				}
				if (input) input.disabled = busy;
				if (sendButton) sendButton.disabled = busy;
				setReasoning(busy ? currentReasoning : '');
			}

			function sendPrompt() {
				if (!input) return;
				const value = input.value.trim();
				if (!value || busy) {
					return;
				}
				vscode.postMessage({ type: 'submitPrompt', prompt: value });
				input.value = '';
				input.focus();
			}

			if (loginButton) {
				loginButton.addEventListener('click', () => {
					setAuthState({ status: 'loggingIn', detail: 'Opening browser for Codex login…' });
					vscode.postMessage({ type: 'requestLogin' });
				});
			}

			if (form) {
				form.addEventListener('submit', (event) => {
					event.preventDefault();
					sendPrompt();
				});
			}

			window.addEventListener('message', (event) => {
				const message = event.data;
				if (!message || !message.type) {
					return;
				}

				switch (message.type) {
						case 'appendMessage':
							messages.push({
								role: message.role || 'assistant',
								text: message.text ?? '',
								command: message.command,
								friendlyTitle: message.friendlyTitle,
								friendlySummary: message.friendlySummary,
								targets: message.targets || [],
								parsed: message.parsed || [],
							});
							render();
							break;
					case 'clearMessages':
						messages.length = 0;
						setReasoning('');
						render();
						break;
					case 'setBusy':
						setBusy(message.busy);
						break;
					case 'reasoningUpdate':
						setReasoning(message.text ?? '');
						break;
					case 'authState':
						setAuthState({ status: message.status, detail: message.detail });
						break;
					default:
						break;
				}
			});

			setBusy(false);
			setAuthState({ status: 'checking', detail: 'Checking Codex login status…' });
			render();
		})();
	</script>
</body>
</html>`;
	}

	private formatFriendlyError(err: unknown): string {
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
