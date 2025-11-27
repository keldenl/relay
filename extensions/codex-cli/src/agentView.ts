/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { CodexBinaryError, CodexClient, CodexEvent } from './codexClient';
import { summarizeCommand } from './commandSummary';
import { isWebviewToHostMessage, type HostToWebviewMessage, type WebviewToHostMessage, type AuthStatus } from './shared/messages';

export class AgentViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewId = 'codexAgentView';

	private readonly codexClient: CodexClient;
	private readonly readDecoration: vscode.TextEditorDecorationType;
	private readonly readLabelDecoration: vscode.TextEditorDecorationType;
	private busy = false;
	private authStatus: AuthStatus = 'checking';
	private lastCwd: string | undefined;
	private lastCommandOutput: string | undefined;
	private readHighlightsByDoc = new Map<string, vscode.Range[]>();

	constructor(private readonly context: vscode.ExtensionContext) {
		this.codexClient = new CodexClient(context);
		this.readDecoration = vscode.window.createTextEditorDecorationType({
			backgroundColor: new vscode.ThemeColor('editor.selectionHighlightBackground'),
			overviewRulerColor: new vscode.ThemeColor('editor.selectionHighlightBackground'),
			overviewRulerLane: vscode.OverviewRulerLane.Center,
			rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
			isWholeLine: true,
		});
		this.readLabelDecoration = vscode.window.createTextEditorDecorationType({
			before: {
				contentText: '👁 reading ', // allow-any-unicode-next-line
				color: new vscode.ThemeColor('descriptionForeground'),
				margin: '0 6px 0 0',
			},
			rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
		});
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
					void this.openFileWithHighlight(target, message.selection);
				}
			}
		});

		// Debug helper: keep simulateStream reachable without running by default.
		if (process.env.CODEX_WEBVIEW_SIMULATE === 'true') {
			void this.simulateStream(webview);
		}
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
		this.clearReadHighlights(); // Always clear read highlights

		if (evt.type === 'item.completed' && evt.item?.type === 'agent_message') {
			this.postToWebview(webview, {
				type: 'appendMessage',
				role: 'assistant',
				text: evt.item.text ?? '',
			});
			this.postToWebview(webview, { type: 'reasoningUpdate', text: undefined });
			return;
		}

		if ((evt.type === 'item.completed' || evt.type === 'item.updated') && evt.item?.type === 'file_change') {
			const changes: Array<{ path: string; kind?: string; diff?: string }> = Array.isArray(evt.item.changes) ? evt.item.changes : [];
			const enriched = changes.map((change: { path: string; kind?: string; diff?: string }) => {
				const absPath = this.lastCwd && !path.isAbsolute(change.path)
					? path.join(this.lastCwd, change.path)
					: change.path;
				const inferredDiff = change.diff
					?? gitDiffForPath(this.lastCwd, absPath)
					?? fallbackDiffFromLastCommand(change.path, this.lastCwd, this.lastCommandOutput);
				const line = inferredDiff
					? parseFirstAddedLine(inferredDiff) ?? parseFirstTargetLine(inferredDiff)
					: undefined;
				const kind = (change.kind ?? '').toLowerCase();
				return { ...change, absPath, line, kind: kind || change.kind, diff: inferredDiff };
			});

			const summary = enriched
				.map((c) => {
					const verb = c.kind === 'delete' ? 'Deleted' : c.kind === 'add' ? 'Added' : 'Updated';
					return `${verb} ${path.basename(c.path)}`;
				})
				.join(', ');

			const fallbackText = enriched.length > 0
				? enriched
					.map((c) => {
						const verb = c.kind === 'delete' ? 'Deleted' : c.kind === 'add' ? 'Added' : 'Updated';
						return `${verb} ${c.path}`;
					})
					.join('\n')
				: 'Applied file changes.';

			this.postToWebview(webview, {
				type: 'appendMessage',
				role: 'command',
				friendlyTitle: 'Edited files',
				friendlySummary: summary || 'Applied file changes',
				fileChanges: enriched,
				text: enriched.find((c) => c.diff)?.diff ?? fallbackText,
			});

			// Auto-open the first changed file and select the hunk if we have a line.
			const first = enriched[0];
			if (first?.absPath) {
				const startLine = typeof first.line === 'number' ? Math.max(0, first.line - 1) : 0;
				void vscode.window.showTextDocument(vscode.Uri.file(first.absPath), {
					selection: new vscode.Range(startLine, 0, startLine, 0),
					preview: true,
				});
			}
			return;
		}

		if (evt.type === 'item.completed' && evt.item?.type === 'reasoning') {
			this.postToWebview(webview, { type: 'reasoningUpdate', text: evt.item.text ?? '' });
			return;
		}

		if (evt.type === 'item.completed' && evt.item?.type === 'command_execution') {
			const text = evt.item.aggregated_output ?? '';
			this.lastCommandOutput = text || undefined;
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

	private async openFileWithHighlight(target: vscode.Uri, selection?: { start: number; end?: number }): Promise<void> {
		const editor = await vscode.window.showTextDocument(target, { preview: true });

		// Clear prior read highlights to reduce noise.
		this.clearReadHighlights();

		if (!selection) {
			return;
		}

		const startLine = Math.max(0, selection.start);
		const endLine = Math.max(startLine, selection.end ?? selection.start);
		const range = new vscode.Range(
			new vscode.Position(startLine, 0),
			new vscode.Position(endLine, Number.MAX_SAFE_INTEGER)
		);

		this.readHighlightsByDoc.set(target.toString(), [range]);
		const labelRange = new vscode.Range(
			new vscode.Position(startLine, 0),
			new vscode.Position(startLine, 0)
		);
		editor.setDecorations(this.readDecoration, [range]);
		editor.setDecorations(this.readLabelDecoration, [labelRange]);
		editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
	}

	private clearReadHighlights(): void {
		for (const visible of vscode.window.visibleTextEditors) {
			visible.setDecorations(this.readDecoration, []);
			visible.setDecorations(this.readLabelDecoration, []);
		}
		this.readHighlightsByDoc.clear();
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

function parseFirstTargetLine(diff: string): number | undefined {
	// Unified diff headers look like: @@ -a,b +c,d @@
	const match = diff.match(/@@[^+]*\+(\d+)(?:,(\d+))? @@/);
	if (!match) {
		return undefined;
	}
	const line = Number(match[1]);
	return Number.isFinite(line) ? line : undefined;
}

function parseFirstAddedLine(diff: string): number | undefined {
	const lines = diff.split(/\r?\n/);
	let current: number | undefined;

	for (const line of lines) {
		const hunk = line.match(/^@@[^+]*\+(\d+)(?:,(\d+))? @@/);
		if (hunk) {
			current = Number(hunk[1]);
			continue;
		}
		if (current === undefined) {
			continue;
		}
		if (line.startsWith('+++') || line.startsWith('---')) {
			continue;
		}
		if (line.startsWith('+')) {
			return current;
		}
		if (line.startsWith(' ')) {
			current += 1;
		} else if (line.startsWith('-')) {
			// deletion: new file line number does not advance
			continue;
		}
	}
	return undefined;
}

function fallbackDiffFromLastCommand(targetPath: string, cwd: string | undefined, lastOutput: string | undefined): string | undefined {
	if (!lastOutput) {
		return undefined;
	}

	const matchesCandidate = (text: string, candidates: Set<string>): boolean => {
		for (const cand of candidates) {
			const updateMarker = new RegExp(`Update File:\\s+${escapeForRegex(cand)}`);
			const applyPatchMarker = new RegExp(`\\*\\*\\*\\s+(?:Update|Add|Delete) File:\\s+${escapeForRegex(cand)}`);
			const diffGitMarker = new RegExp(`^diff --git\\s+a/${escapeForRegex(cand)}\\s+b/${escapeForRegex(cand)}`, 'm');
			const plusPlusMarker = new RegExp(`^\\+\\+\\+\\s+b/${escapeForRegex(cand)}`, 'm');
			if (updateMarker.test(text) || applyPatchMarker.test(text) || diffGitMarker.test(text) || plusPlusMarker.test(text)) {
				return true;
			}
		}
		return false;
	};

	// Normalize paths to improve matching (absolute, relative to cwd, basename).
	const normalized = targetPath.replace(/\\/g, '/');
	const candidates = new Set<string>([normalized]);
	if (cwd) {
		const normCwd = cwd.replace(/\\/g, '/');
		if (normalized.startsWith(normCwd + '/')) {
			candidates.add(normalized.slice(normCwd.length + 1));
		}
	}
	const base = path.basename(normalized);
	candidates.add(base);

	// Prefer slicing out the relevant patch block when the last command produced a multi-file patch.
	if (lastOutput.includes('*** Begin Patch')) {
		const blocks = Array.from(lastOutput.matchAll(/\*\*\* Begin Patch[\s\S]*?\*\*\* End Patch/g));
		for (const block of blocks) {
			const text = block[0];
			if (matchesCandidate(text, candidates)) {
				return text;
			}
		}
	}

	// Handle git-style diffs containing multiple files.
	if (lastOutput.includes('diff --git')) {
		const sections = lastOutput.split(/(?=^diff --git\s+)/m).filter((s) => s.trim().length > 0);
		for (const section of sections) {
			if (matchesCandidate(section, candidates)) {
				return section.trimEnd();
			}
		}
	}

	for (const cand of candidates) {
		const updateMarker = new RegExp(`Update File:\\s+${escapeForRegex(cand)}`);
		if (updateMarker.test(lastOutput)) {
			return lastOutput;
		}
		const diffGitMarker = new RegExp(`diff --git\\s+a/${escapeForRegex(cand)}\\s+b/${escapeForRegex(cand)}`);
		if (diffGitMarker.test(lastOutput)) {
			return lastOutput;
		}
	}

	if (lastOutput.includes('*** Begin Patch') || lastOutput.startsWith('diff --git')) {
		return lastOutput;
	}

	return undefined;
}

function gitDiffForPath(cwd: string | undefined, absPath: string): string | undefined {
	if (!cwd || !absPath) {
		return undefined;
	}

	try {
		// Ensure we're in a repo; if not, skip.
		cp.execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'ignore' });
	} catch {
		return undefined;
	}

	const rel = path.isAbsolute(absPath) ? path.relative(cwd, absPath) || absPath : absPath;

	const tryCommands: Array<string[]> = [
		['diff', '-U3', '--', rel],
		['diff', '-U3', 'HEAD', '--', rel],
		['diff', '-U3', '--no-index', '/dev/null', rel],
	];

	for (const args of tryCommands) {
		try {
			const output = cp.execFileSync('git', args, { cwd, encoding: 'utf8' });
			if (output.trim()) {
				return output;
			}
		} catch {
			// ignore and try next strategy
		}
	}

	return undefined;
}

function escapeForRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface ViteManifestEntry {
	file: string;
	css?: string[];
	isEntry?: boolean;
}
