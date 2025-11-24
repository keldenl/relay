/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type AgentMessageRole = 'assistant' | 'command' | 'system' | 'user';

export type AuthStatus = 'checking' | 'loggedIn' | 'loggedOut' | 'loggingIn' | 'error';

export interface ParsedCommandPart {
	kind?: string;
	raw?: string;
	name?: string;
	path?: string;
	absPath?: string;
	label?: string;
	query?: string;
}

export interface AgentMessage {
	role?: AgentMessageRole;
	text?: string;
	command?: string;
	friendlyTitle?: string;
	friendlySummary?: string;
	targets?: Array<{ label: string; path: string; isDir?: boolean }>;
	parsed?: ParsedCommandPart[];
}

export type HostToWebviewMessage =
	| ({ type: 'appendMessage' } & AgentMessage)
	| { type: 'clearMessages' }
	| { type: 'setBusy'; busy?: boolean }
	| { type: 'reasoningUpdate'; text?: string }
	| { type: 'authState'; status: AuthStatus; detail?: string };

export type WebviewToHostMessage =
	| { type: 'submitPrompt'; prompt: string }
	| { type: 'requestLogin' }
	| { type: 'requestStatus' }
	| { type: 'openPath'; path: string; isDir?: boolean };

export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const msg = value as Partial<WebviewToHostMessage>;
	if (msg.type === 'submitPrompt') {
		return typeof msg.prompt === 'string';
	}
	if (msg.type === 'requestLogin' || msg.type === 'requestStatus') {
		return true;
	}
	if (msg.type === 'openPath') {
		return typeof msg.path === 'string';
	}
	return false;
}
