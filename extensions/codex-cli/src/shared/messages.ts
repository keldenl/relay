/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type AgentMessageRole = 'assistant' | 'command' | 'system' | 'user';

export type AuthStatus = 'checking' | 'loggedIn' | 'loggedOut' | 'loggingIn' | 'error';
export type ReasoningEffortOption = 'low' | 'medium' | 'high' | 'xhigh';
export type CodexModelId = 'gpt-5.1-codex-max' | 'gpt-5.1';

export interface ParsedCommandPart {
	kind?: string;
	raw?: string;
	name?: string;
	path?: string;
	absPath?: string;
	label?: string;
	query?: string;
	lineStart?: number;
	lineEnd?: number;
}

export interface FileChangePreview {
	path: string;
	absPath?: string;
	kind?: string;
	diff?: string;
	/** First line number (1-based) of the changed block, if known. */
	line?: number;
}

export interface AgentMessage {
	role?: AgentMessageRole;
	sessionId?: string;
	text?: string;
	command?: string;
	friendlyTitle?: string;
	friendlySummary?: string;
	targets?: Array<{ label: string; path: string; isDir?: boolean }>;
	parsed?: ParsedCommandPart[];
	fileChanges?: FileChangePreview[];
}

export interface SessionListItem {
	id: string;
	title: string;
	createdAt?: number;
	updatedAt?: number;
}

export type HostToWebviewMessage =
	| ({ type: 'appendMessage' } & AgentMessage)
	| { type: 'clearMessages' }
	| { type: 'setBusy'; busy?: boolean }
	| { type: 'reasoningUpdate'; text?: string }
	| { type: 'authState'; status: AuthStatus; detail?: string }
	| { type: 'reasoningState'; effort: ReasoningEffortOption }
	| { type: 'modelState'; model: CodexModelId }
	| { type: 'sessionState'; activeSessionId: string; sessions: SessionListItem[]; messages: AgentMessage[] };

export type WebviewToHostMessage =
	| { type: 'submitPrompt'; prompt: string }
	| { type: 'requestLogin' }
	| { type: 'requestStatus' }
	| { type: 'setReasoningEffort'; effort: ReasoningEffortOption }
	| { type: 'setModel'; model: CodexModelId }
	| { type: 'setModelAndEffort'; model: CodexModelId; effort: ReasoningEffortOption }
	| { type: 'openPath'; path: string; isDir?: boolean; selection?: { start: number; end?: number } }
	| { type: 'newSession'; title?: string }
	| { type: 'switchSession'; sessionId: string }
	| { type: 'renameSession'; sessionId: string; title: string };

function isReasoningEffort(effort: unknown): effort is ReasoningEffortOption {
	return effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh';
}

function isCodexModelId(model: unknown): model is CodexModelId {
	return model === 'gpt-5.1-codex-max' || model === 'gpt-5.1';
}

export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const msg = value as Partial<WebviewToHostMessage>;

	if (msg.type === 'setReasoningEffort') {
		return isReasoningEffort((msg as { effort?: ReasoningEffortOption }).effort);
	}

	if (msg.type === 'setModel') {
		return isCodexModelId((msg as { model?: CodexModelId }).model);
	}

	if (msg.type === 'setModelAndEffort') {
		const candidate = msg as { model?: CodexModelId; effort?: ReasoningEffortOption };
		return isCodexModelId(candidate.model) && isReasoningEffort(candidate.effort);
	}

	if (msg.type === 'submitPrompt') {
		return typeof msg.prompt === 'string';
	}
	if (msg.type === 'requestLogin' || msg.type === 'requestStatus') {
		return true;
	}
	if (msg.type === 'openPath') {
		return typeof msg.path === 'string';
	}
	if (msg.type === 'newSession') {
		return true;
	}
	if (msg.type === 'switchSession') {
		return typeof msg.sessionId === 'string';
	}
	if (msg.type === 'renameSession') {
		return typeof msg.sessionId === 'string' && typeof msg.title === 'string';
	}
	return false;
}
