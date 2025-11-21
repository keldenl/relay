/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as readline from 'readline';
import * as vscode from 'vscode';
import { getBundledCodexPath } from './paths';

export interface CodexEvent {
	type: string;
	[key: string]: any;
}

export class CodexClient {
	constructor(private readonly context: vscode.ExtensionContext) { }

	runExec(prompt: string, cwd: string, onEvent: (evt: CodexEvent) => void): Promise<void> {
		return new Promise((resolve, reject) => {
			let codexPath: string;
			try {
				codexPath = getBundledCodexPath(this.context);
			} catch (err) {
				return reject(err);
			}

			if (!fs.existsSync(codexPath)) {
				return reject(new Error(`Codex CLI binary not found at ${codexPath}`));
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

			rl.on('line', (line) => {
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

			child.on('error', (err) => {
				reject(err);
			});

			child.on('exit', (code) => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`Codex exited with code ${code}`));
				}
			});
		});
	}
}
