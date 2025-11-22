/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as readline from 'readline';
import * as vscode from 'vscode';
import { getBundledCodexPath } from './paths';

export class CodexBinaryError extends Error {
	constructor(message: string, public readonly binaryPath: string) {
		super(message);
		this.name = 'CodexBinaryError';
	}
}

export interface CodexEvent {
	type: string;
	[key: string]: any;
}

export type LoginMode = 'chatgpt' | 'apiKey';

export interface LoginStatusResult {
	loggedIn: boolean;
	mode?: LoginMode;
	raw: string;
}

export class CodexClient {
	constructor(private readonly context: vscode.ExtensionContext) { }

	private resolveUsableCodexPath(): string {
		const codexPath = getBundledCodexPath(this.context);
		ensureBinaryUsable(codexPath);
		return codexPath;
	}

	runExec(prompt: string, cwd: string, onEvent: (evt: CodexEvent) => void): Promise<void> {
		return new Promise((resolve, reject) => {
			let codexPath: string;
			try {
				codexPath = this.resolveUsableCodexPath();
			} catch (err) {
				return reject(err);
			}

			const args = [
				'exec',
				'--json',
				'--color=never',
				'--cd',
				cwd,
				prompt
			];

			const child = cp.spawn(codexPath, args, {
				cwd,
				stdio: ['ignore', 'pipe', 'pipe']
			});

			const rl = readline.createInterface({
				input: child.stdout,
				crlfDelay: Infinity
			});

			rl.on('line', (line: string) => {
				const trimmed = line.trim();
				if (!trimmed) {
					return;
				}

				try {
					const evt = JSON.parse(trimmed) as CodexEvent;
					onEvent(evt);
				} catch (e) {
					console.error('Failed to parse Codex JSON line:', trimmed, e);
				}
			});

			child.stderr.on('data', (buf: Buffer) => {
				console.error('Codex stderr:', buf.toString());
			});

			child.on('error', (err: Error) => {
				reject(err);
			});

			child.on('exit', (code: number | null) => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`Codex exited with code ${code}`));
				}
			});
		});
	}

	checkLoginStatus(): Promise<LoginStatusResult> {
		return new Promise((resolve, reject) => {
			let codexPath: string;
			try {
				codexPath = this.resolveUsableCodexPath();
			} catch (err) {
				return reject(err);
			}

			const child = cp.spawn(codexPath, ['login', 'status'], {
				stdio: ['ignore', 'pipe', 'pipe']
			});

			let output = '';

			child.stdout.on('data', (buf: Buffer) => {
				output += buf.toString();
			});

			child.stderr.on('data', (buf: Buffer) => {
				output += buf.toString();
			});

			child.on('error', (err: Error) => reject(err));

			child.on('close', (code: number | null) => {
				const raw = output.trim();
				const loggedIn = code === 0;
				let mode: LoginMode | undefined;
				if (/ChatGPT/i.test(raw)) {
					mode = 'chatgpt';
				} else if (/API key/i.test(raw)) {
					mode = 'apiKey';
				}

				resolve({ loggedIn, mode, raw });
			});
		});
	}

	runLogin(onOutput?: (text: string) => void): Promise<void> {
		return new Promise((resolve, reject) => {
			let codexPath: string;
			try {
				codexPath = this.resolveUsableCodexPath();
			} catch (err) {
				return reject(err);
			}

			const child = cp.spawn(codexPath, ['login'], {
				stdio: ['ignore', 'pipe', 'pipe']
			});

			let output = '';
			const forward = (buf: Buffer) => {
				const text = buf.toString();
				output += text;
				onOutput?.(text);
			};

			child.stdout.on('data', forward);
			child.stderr.on('data', forward);

			child.on('error', (err: Error) => reject(err));

			child.on('close', (code: number | null) => {
				if (code === 0) {
					resolve();
					return;
				}
				reject(new Error(output.trim() || `Codex login exited with code ${code}`));
			});
		});
	}
}

function ensureBinaryUsable(codexPath: string): void {
	if (!fs.existsSync(codexPath)) {
		throw new CodexBinaryError(`Bundled Codex CLI not found. Please place the Codex CLI binary at: ${codexPath} and mark it executable (chmod +x).`, codexPath);
	}

	const stat = fs.statSync(codexPath);
	if (!stat.isFile()) {
		throw new CodexBinaryError(`Bundled Codex CLI not found. Please place the Codex CLI binary at: ${codexPath} and mark it executable (chmod +x).`, codexPath);
	}

	// Guard against obvious placeholders: empty files or non-executable bits on POSIX.
	if (stat.size === 0) {
		throw new CodexBinaryError(`Bundled Codex CLI looks like a placeholder (zero bytes). Replace it with the real binary at: ${codexPath} and mark it executable (chmod +x).`, codexPath);
	}

	if (process.platform !== 'win32') {
		try {
			fs.accessSync(codexPath, fs.constants.X_OK);
		} catch {
			throw new CodexBinaryError(`Bundled Codex CLI is not executable. Please run: chmod +x "${codexPath}".`, codexPath);
		}
	}
}
