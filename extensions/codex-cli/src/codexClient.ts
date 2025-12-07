/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { Codex, Thread, ThreadEvent, ModelReasoningEffort } from '@openai/codex-sdk';
type CodexConstructor = typeof import('@openai/codex-sdk').Codex;
import { getBundledCodexPath } from './paths';
import type { ReasoningEffortOption } from './shared/messages';

export type CodexEvent = ThreadEvent;

export type LoginMode = 'chatgpt' | 'apiKey';

export interface LoginStatusResult {
	loggedIn: boolean;
	mode?: LoginMode;
	raw: string;
}

type ThreadRecord = {
	thread: Thread;
	reasoningEffort?: ModelReasoningEffort;
};

export class CodexClient {
	private codexCtorPromise: Promise<CodexConstructor> | undefined;
	private codexInstance: Codex | undefined;
	private readonly threads = new Map<string, ThreadRecord>();
	private readonly threadIdKeyPrefix = 'codex.threadId';

	constructor(private readonly context: vscode.ExtensionContext) {
	}

	async runExec(
		prompt: string,
		cwd: string,
		onEvent: (evt: CodexEvent) => void,
		options?: { reasoningEffort?: ReasoningEffortOption }
	): Promise<void> {
		const thread = await this.getOrCreateThread(cwd, options?.reasoningEffort);
		const { events } = await thread.runStreamed(prompt);

		for await (const evt of events) {
			onEvent(evt);
			if (evt.type === 'thread.started' && thread.id) {
				await this.storeThreadId(cwd, thread.id);
			}
		}

		if (thread.id) {
			await this.storeThreadId(cwd, thread.id);
		}
	}

	checkLoginStatus(): Promise<LoginStatusResult> {
		return new Promise((resolve, reject) => {
			const codexPath = this.resolvePreferredCodexPath();
			const binary = codexPath ?? 'codex';

			const child = cp.spawn(binary, ['login', 'status'], {
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
			const codexPath = this.resolvePreferredCodexPath();
			const binary = codexPath ?? 'codex';

			const child = cp.spawn(binary, ['login'], {
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

	private async getOrCreateThread(cwd: string, effort?: ReasoningEffortOption): Promise<Thread> {
		const key = this.workspaceKey(cwd);
		const desiredEffort = this.mapReasoningEffort(effort);

		const existing = this.threads.get(key);
		if (existing && existing.reasoningEffort === desiredEffort) {
			return existing.thread;
		}

		const storedId = this.context.globalState.get<string>(this.threadIdStorageKey(key));
		const threadOptions = {
			workingDirectory: cwd,
			sandboxMode: 'workspace-write' as const,
			skipGitRepoCheck: true,
			modelReasoningEffort: desiredEffort,
		};

		const codex = await this.getCodex();
		let thread: Thread;
		if (storedId) {
			try {
				thread = codex.resumeThread(storedId, threadOptions);
			} catch {
				thread = codex.startThread(threadOptions);
			}
		} else {
			thread = codex.startThread(threadOptions);
		}

		this.threads.set(key, { thread, reasoningEffort: desiredEffort });
		return thread;
	}

	private mapReasoningEffort(option?: ReasoningEffortOption): ModelReasoningEffort | undefined {
		if (!option) {
			return undefined;
		}
		if (option === 'xhigh') {
			return 'high';
		}
		return option as ModelReasoningEffort;
	}

	private async storeThreadId(cwd: string, id: string): Promise<void> {
		const key = this.workspaceKey(cwd);
		await this.context.globalState.update(this.threadIdStorageKey(key), id);
	}

	private workspaceKey(cwd: string): string {
		return path.resolve(cwd);
	}

	private threadIdStorageKey(workspaceKey: string): string {
		return `${this.threadIdKeyPrefix}:${workspaceKey}`;
	}

	private resolvePreferredCodexPath(): string | undefined {
		try {
			const bundled = getBundledCodexPath(this.context);
			if (bundled && fs.existsSync(bundled)) {
				return bundled;
			}
		} catch {
			// Unsupported platform or missing path; fall back to SDK default.
		}
		return undefined;
	}

	private buildCodexOptions(): { codexPathOverride?: string } {
		const maybePath = this.resolvePreferredCodexPath();
		return maybePath ? { codexPathOverride: maybePath } : {};
	}

	private async loadSdk(): Promise<CodexConstructor> {
		if (!this.codexCtorPromise) {
			const dynamicImport = new Function('specifier', 'return import(specifier);') as (s: string) => Promise<{ Codex: CodexConstructor }>;
			this.codexCtorPromise = dynamicImport('@openai/codex-sdk').then((mod) => mod.Codex);
		}
		return this.codexCtorPromise;
	}

	private async getCodex(): Promise<Codex> {
		if (this.codexInstance) {
			return this.codexInstance;
		}
		const Codex = await this.loadSdk();
		this.codexInstance = new Codex(this.buildCodexOptions());
		return this.codexInstance;
	}
}
