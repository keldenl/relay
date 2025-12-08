/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentMessage, CodexModelId } from './shared/messages';
import { randomUUID } from 'crypto';

const SESSION_KEY_PREFIX = 'codex.sessions';
const LAST_ACTIVE_KEY_PREFIX = 'codex.sessions:last';
const LEGACY_THREAD_PREFIX = 'codex.threadId';
const MAX_SESSIONS = 20;
const MAX_MESSAGES = 100;
const FALLBACK_TITLE = 'New Chat';

export type StoredSession = {
	id: string;
	threadId?: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: AgentMessage[];
	model?: CodexModelId;
};

type SessionState = {
	sessions: StoredSession[];
	activeId?: string;
};

export type SessionSummary = {
	id: string;
	title: string;
	updatedAt: number;
	createdAt: number;
};

export class SessionStore {
	constructor(private readonly context: vscode.ExtensionContext) { }

	workspaceKey(cwd: string): string {
		return path.resolve(cwd);
	}

	async ensureState(workspaceKey: string): Promise<SessionState> {
		const state = await this.loadState(workspaceKey);
		if (state.sessions.length > 0) {
			const activeId = state.activeId ?? state.sessions[0]?.id;
			if (activeId !== state.activeId) {
				await this.setActiveSession(workspaceKey, activeId);
			}
			return { ...state, activeId: activeId ?? state.activeId };
		}

		const legacyThreadId = this.context.globalState.get<string>(`${LEGACY_THREAD_PREFIX}:${workspaceKey}`);
		const created = this.createSession('Chat 1', legacyThreadId);
		await this.saveState(workspaceKey, { sessions: [created], activeId: created.id });
		return { sessions: [created], activeId: created.id };
	}

	async createNewSession(workspaceKey: string, title?: string, threadId?: string, model?: CodexModelId): Promise<StoredSession> {
		const state = await this.ensureState(workspaceKey);
		const created = this.createSession(title ?? this.defaultTitle(), threadId, model);
		const sessions = this.pruneSessions([...state.sessions, created]);
		await this.saveState(workspaceKey, { sessions, activeId: created.id });
		return created;
	}

	async setActiveSession(workspaceKey: string, sessionId: string): Promise<void> {
		const state = await this.ensureState(workspaceKey);
		if (state.activeId === sessionId) {
			return;
		}
		await this.saveState(workspaceKey, { sessions: state.sessions, activeId: sessionId });
	}

	async renameSession(workspaceKey: string, sessionId: string, title: string): Promise<void> {
		const state = await this.ensureState(workspaceKey);
		const sessions = state.sessions.map((s) => (s.id === sessionId ? { ...s, title, updatedAt: Date.now() } : s));
		await this.saveState(workspaceKey, { sessions, activeId: state.activeId ?? sessionId });
	}

	async updateThreadId(workspaceKey: string, sessionId: string, threadId: string): Promise<void> {
		const state = await this.ensureState(workspaceKey);
		const sessions = state.sessions.map((s) => (s.id === sessionId ? { ...s, threadId, updatedAt: Date.now() } : s));
		await this.saveState(workspaceKey, { sessions, activeId: state.activeId ?? sessionId });
	}

	async updateModel(workspaceKey: string, sessionId: string, model: CodexModelId): Promise<void> {
		const state = await this.ensureState(workspaceKey);
		const sessions = state.sessions.map((s) => (s.id === sessionId ? { ...s, model, updatedAt: Date.now() } : s));
		await this.saveState(workspaceKey, { sessions, activeId: state.activeId ?? sessionId });
	}

	async recordMessage(workspaceKey: string, sessionId: string, message: AgentMessage): Promise<void> {
		const state = await this.ensureState(workspaceKey);
		const sessions = state.sessions.map((s) => {
			if (s.id !== sessionId) {
				return s;
			}
			const nextMessages = [...(s.messages ?? []), this.stripHeavyFields(message)];
			const pruned = nextMessages.slice(-MAX_MESSAGES);
			const updatedTitle = this.deriveTitle(s, message);
			return { ...s, title: updatedTitle, messages: pruned, updatedAt: Date.now() };
		});
		await this.saveState(workspaceKey, { sessions, activeId: state.activeId ?? sessionId });
	}

	async getActiveSession(workspaceKey: string): Promise<StoredSession | undefined> {
		const state = await this.ensureState(workspaceKey);
		return state.sessions.find((s) => s.id === state.activeId) ?? state.sessions[0];
	}

	async getSession(workspaceKey: string, sessionId: string): Promise<StoredSession | undefined> {
		const state = await this.ensureState(workspaceKey);
		return state.sessions.find((s) => s.id === sessionId);
	}

	async getState(workspaceKey: string): Promise<SessionState> {
		return this.ensureState(workspaceKey);
	}

	getSummaries(state: SessionState): SessionSummary[] {
		return state.sessions
			.slice()
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt }));
	}

	private async loadState(workspaceKey: string): Promise<SessionState> {
		const sessions = this.context.globalState.get<StoredSession[]>(`${SESSION_KEY_PREFIX}:${workspaceKey}`) ?? [];
		const activeId = this.context.globalState.get<string>(`${LAST_ACTIVE_KEY_PREFIX}:${workspaceKey}`);
		return { sessions, activeId };
	}

	private async saveState(workspaceKey: string, state: SessionState): Promise<void> {
		await this.context.globalState.update(`${SESSION_KEY_PREFIX}:${workspaceKey}`, this.pruneSessions(state.sessions));
		await this.context.globalState.update(`${LAST_ACTIVE_KEY_PREFIX}:${workspaceKey}`, state.activeId);
	}

	private createSession(title: string, threadId?: string, model?: CodexModelId): StoredSession {
		const now = Date.now();
		return {
			id: randomUUID(),
			threadId,
			title: title || FALLBACK_TITLE,
			createdAt: now,
			updatedAt: now,
			messages: [],
			model,
		};
	}

	private defaultTitle(): string {
		return FALLBACK_TITLE;
	}

	private pruneSessions(sessions: StoredSession[]): StoredSession[] {
		const sorted = sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt);
		return sorted.slice(0, MAX_SESSIONS);
	}

	private stripHeavyFields(message: AgentMessage): AgentMessage {
		if (!message) {
			return message;
		}
		// Avoid persisting oversized diffs; keep metadata shallow.
		const fileChanges = message.fileChanges?.map((c) => ({ path: c.path, absPath: c.absPath, kind: c.kind, line: c.line }));
		return { ...message, fileChanges };
	}

	private deriveTitle(session: StoredSession, incoming: AgentMessage): string {
		// Preserve any explicit title the user might set in the future; only override placeholder titles when the first user message arrives.
		const isPlaceholder = !session.title || session.title === FALLBACK_TITLE || /^Chat\s+\d+$/i.test(session.title);
		const wasEmpty = (session.messages?.length ?? 0) === 0;
		if (!isPlaceholder) {
			return session.title;
		}
		if ((incoming.role ?? 'assistant') !== 'user') {
			return session.title;
		}
		if (!wasEmpty) {
			return session.title;
		}
		const text = (incoming.text ?? '').trim().replace(/\s+/g, ' ');
		if (!text) {
			return FALLBACK_TITLE;
		}
		const maxLen = 50;
		const truncated = text.length > maxLen ? `${text.slice(0, maxLen).trimEnd()}…` : text;
		return truncated;
	}
}
