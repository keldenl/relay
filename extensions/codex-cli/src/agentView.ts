/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CodexBinaryError, CodexClient, CodexEvent } from './codexClient';
import { summarizeCommand } from './commandSummary';
import { isWebviewToHostMessage, type HostToWebviewMessage, type WebviewToHostMessage, type AuthStatus } from './shared/messages';

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
				vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview-dist'),
			],
		};

		webview.html = this.getHtmlForWebview(webview);
		void this.refreshAuthState(webviewView);

		webview.onDidReceiveMessage((raw) => {
			if (!isWebviewToHostMessage(raw)) {
				return;
			}

			const message = raw as WebviewToHostMessage;

			if (message.type === 'submitPrompt') {
				const prompt = typeof message.prompt === 'string' ? message.prompt : '';
				void this.handlePrompt(webviewView, prompt);
			}

			if (message.type === 'requestLogin') {
				void this.handleLogin(webviewView);
			}

			if (message.type === 'requestStatus') {
				void this.refreshAuthState(webviewView);
			}

			if (message.type === 'openPath') {
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
			// await this.simulateStream(webview); // Comment this in for simluation
			await this.codexClient.runExec(trimmed, cwd, (evt) => this.forwardCodexEvent(webview, evt));

		} catch (err) {
			const handled = await this.handleRunError(webview, err);
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

	private async handleRunError(webview: vscode.Webview, err: unknown): Promise<boolean> {
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
				text: 'Codex CLI unavailable.',
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

	// @ts-ignore kept unused intentionally for debugging stream rendering
	private async simulateStream(webview: vscode.Webview): Promise<void> {
		const fakeEvents: CodexEvent[] = [
			{
				type: 'thread.started',
				thread_id: '019aaa40-a59f-7c32-947e-d25600d35a09'
			},
			{
				type: 'turn.started'
			},
			{
				type: 'item.completed',
				item: {
					id: 'item_0',
					type: 'reasoning',
					text: '**Listing repository files**'
				}
			},
			{
				type: 'item.started',
				item: {
					id: 'item_1',
					type: 'command_execution',
					command: '/bin/zsh -lc ls',
					aggregated_output: '',
					exit_code: null,
					status: 'in_progress'
				}
			},
			{
				type: 'item.completed',
				item: {
					id: 'item_1',
					type: 'command_execution',
					command: '/bin/zsh -lc ls',
					aggregated_output: 'dist\neslint.config.js\nindex.html\nnode_modules\npackage-lock.json\npackage.json\npublic\nREADME.md\nsrc\ntsconfig.app.json\ntsconfig.json\ntsconfig.node.json\nvite.config.ts\n',
					exit_code: 0,
					status: 'completed'
				}
			},
			{
				type: 'item.completed',
				item: {
					id: 'item_2',
					type: 'reasoning',
					text: '**Reviewing README for repo summary**'
				}
			},
			{
				type: 'item.started',
				item: {
					id: 'item_3',
					type: 'command_execution',
					command: '/bin/zsh -lc "cat README.md"',
					aggregated_output: '',
					exit_code: null,
					status: 'in_progress'
				}
			},
			{
				type: 'item.completed',
				item: {
					id: 'item_3',
					type: 'command_execution',
					command: '/bin/zsh -lc "cat README.md"',
					aggregated_output: '# kelden-web\n\nInteractive terminal-style web experience for Kelden Lin. The app wraps a...\n',
					exit_code: 0,
					status: 'completed'
				}
			},
			{
				type: 'item.completed',
				item: {
					id: 'item_4',
					type: 'reasoning',
					text: '**Summarizing README contents**'
				}
			},
			{
				type: 'item.completed',
				item: {
					id: 'item_5',
					type: 'agent_message',
					text: '- Interactive terminal-style web app for Kelden Lin that wraps a locally hosted LLM via `@wllama/wllama`, presented as a zsh-inspired chat shell.  \n- Built with React 19, Vite 7, Tailwind CSS 4, and the experimental React Compiler; runs fully client-side with SharedArrayBuffer-enabled browsers.  \n- Key flows: `/download` grabs defaultQwen 0.6B GGUF (~639 MB), `/load` initializes it, `/chat` streams replies, `/unload` frees memory; command router lives in `src/slash/commands.ts` and `src/slash/index.ts`.  \n- Terminal UI, window controls, and sizing logic are in `src/ components/Terminal.tsx`; model metadata and defaults in `src/utils/wllama/config.ts`.  \n- Start locally with `npm install` then `npm run dev`; other scripts: `build`, `preview`, `lint`. README details usage and troubleshooting.'
				}
			},
			{
				type: 'turn.completed',
				usage: {
					input_tokens: 24952,
					cached_input_tokens: 20736,
					output_tokens: 273
				}
			}
		];

		let delay = 500;
		await new Promise<void>((resolve) => {
			for (const evt of fakeEvents) {
				delay += 1000;
				setTimeout(() => this.forwardCodexEvent(webview, evt), delay);
			}
			setTimeout(() => resolve(), delay + 200);
		});
	}

	private postAuthState(webview: vscode.Webview, status: AuthStatus, detail?: string): void {
		this.postToWebview(webview, { type: 'authState', status, detail });
	}

	private postToWebview(webview: vscode.Webview, message: HostToWebviewMessage): void {
		webview.postMessage(message).then(undefined, console.error);
	}

	private getHtmlForWebview(webview: vscode.Webview): string {
		if (this.isDevServerEnabled()) {
			return this.getDevHtml(webview);
		}
		return this.getProdHtml(webview);
	}

	private isDevServerEnabled(): boolean {
		return process.env.VSCODE_DEV === 'true' || process.env.VSCODE_DEBUG_MODE === 'true';
	}

	private getDevServerUrl(): string {
		return process.env.VSCODE_WEBVIEW_DEV_SERVER ?? 'http://127.0.0.1:5173';
	}

	private getDevHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		const devServer = this.getDevServerUrl();
		let devHost = '127.0.0.1:5173';
		try {
			devHost = new URL(devServer).host;
		} catch {
			// ignore malformed URL; default stays
		}

		const csp = [
			`default-src 'none';`,
			`img-src ${webview.cspSource} https: data:;`,
			`style-src 'unsafe-inline' ${webview.cspSource} ${devServer};`,
			`font-src ${webview.cspSource} https: data:;`,
			`script-src 'nonce-${nonce}' ${devServer};`,
			`connect-src ${devServer} ws://${devHost};`,
		].join(' ');

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Codex Agent</title>
</head>
<body>
	<div id="root"></div>
	<script type="module" nonce="${nonce}" src="${devServer}/@vite/client"></script>
	<script type="module" nonce="${nonce}" src="${devServer}/src/main.tsx"></script>
</body>
</html>`;
	}

	private getProdHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		const manifest = this.readManifest();
		const entry = manifest['src/main.tsx'] ?? Object.values(manifest).find((v) => v?.isEntry) ?? Object.values(manifest)[0];

		if (!entry || !entry.file) {
			return this.renderMissingBundleHtml(webview, nonce);
		}

		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview-dist', entry.file)
		);
		const styleUris = (entry.css ?? []).map((cssFile) =>
			webview.asWebviewUri(
				vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview-dist', cssFile)
			)
		);

		const csp = [
			`default-src 'none';`,
			`img-src ${webview.cspSource} https: data:;`,
			`style-src 'nonce-${nonce}' ${webview.cspSource};`,
			`font-src ${webview.cspSource} https: data:;`,
			`script-src 'nonce-${nonce}';`,
		].join(' ');

		const styleLinks = styleUris.map((uri) => `<link rel="stylesheet" href="${uri}">`).join('\n\t');

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Codex Agent</title>
	${styleLinks}
</head>
<body>
	<div id="root"></div>
	<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}

	private renderMissingBundleHtml(webview: vscode.Webview, nonce: string): string {
		const csp = [
			`default-src 'none';`,
			`style-src 'nonce-${nonce}' ${webview.cspSource};`,
		].join(' ');

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<style nonce="${nonce}">
		body { font-family: var(--vscode-font-family); color: var(--vscode-errorForeground); padding: 16px; }
	</style>
</head>
<body>
	<p>Codex webview bundle is missing. Run "npm run build:webview" inside <code>extensions/codex-cli</code> and reload.</p>
</body>
</html>`;
	}

	private readManifest(): Record<string, ViteManifestEntry> {
		const distRoot = path.join(this.context.extensionPath, 'media', 'webview-dist');
		const manifestCandidates = [
			path.join(distRoot, 'manifest.json'),
			path.join(distRoot, '.vite', 'manifest.json'),
		];

		for (const candidate of manifestCandidates) {
			if (fs.existsSync(candidate)) {
				try {
					const raw = fs.readFileSync(candidate, 'utf8');
					return JSON.parse(raw) as Record<string, ViteManifestEntry>;
				} catch (err) {
					console.error('Failed to parse webview manifest', err);
				}
			}
		}

		console.error('No webview manifest found in', manifestCandidates.join(', '));
		return {};
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

interface ViteManifestEntry {
	file: string;
	css?: string[];
	isEntry?: boolean;
}
