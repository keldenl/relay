/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useReducer } from 'react';
import type { AgentMessage, AuthStatus, HostToWebviewMessage, ReasoningEffortOption, SessionListItem } from '@shared/messages';
import vscode, { postMessage } from '../vscode';

type State = {
	auth: { status: AuthStatus; detail?: string };
	busy: boolean;
	reasoning: string;
	messages: AgentMessage[];
	reasoningEffort: ReasoningEffortOption;
	sessions: SessionListItem[];
	activeSessionId?: string;
};

type Action =
	| { type: 'setAuth'; status: AuthStatus; detail?: string }
	| { type: 'setBusy'; busy: boolean }
	| { type: 'setReasoning'; text: string }
	| { type: 'appendMessage'; message: AgentMessage }
	| { type: 'clear' }
	| { type: 'setReasoningEffort'; effort: ReasoningEffortOption }
	| { type: 'setSessionState'; sessions: SessionListItem[]; activeSessionId: string; messages: AgentMessage[] };

const initialState: State = {
	auth: { status: 'checking' },
	busy: false,
	reasoning: '',
	messages: [],
	reasoningEffort: 'medium',
	sessions: [],
};

function reducer(state: State, action: Action): State {
	switch (action.type) {
		case 'setAuth':
			return { ...state, auth: { status: action.status, detail: action.detail }, busy: action.status === 'loggingIn' ? state.busy : state.busy };
		case 'setBusy':
			return { ...state, busy: action.busy, reasoning: action.busy ? state.reasoning : '' };
		case 'setReasoning':
			return { ...state, reasoning: action.text };
		case 'appendMessage':
			if (action.message.sessionId && state.activeSessionId && action.message.sessionId !== state.activeSessionId) {
				return state;
			}
			return { ...state, messages: [...state.messages, action.message] };
		case 'setReasoningEffort':
			return { ...state, reasoningEffort: action.effort };
		case 'clear':
			return { ...state, messages: [], reasoning: '' };
		case 'setSessionState':
			return {
				...state,
				sessions: action.sessions,
				activeSessionId: action.activeSessionId,
				messages: action.messages,
			};
		default:
			return state;
	}
}

function handleHostMessage(dispatch: React.Dispatch<Action>, message: HostToWebviewMessage): void {
	switch (message.type) {
		case 'appendMessage':
			dispatch({
				type: 'appendMessage',
				message: {
					role: message.role ?? 'assistant',
					text: message.text ?? '',
					command: message.command,
					friendlyTitle: message.friendlyTitle,
					friendlySummary: message.friendlySummary,
					targets: message.targets ?? [],
					parsed: message.parsed ?? [],
					fileChanges: message.fileChanges ?? [],
				},
			});
			return;
		case 'clearMessages':
			dispatch({ type: 'clear' });
			return;
		case 'setBusy':
			dispatch({ type: 'setBusy', busy: Boolean(message.busy) });
			if (!message.busy) {
				dispatch({ type: 'setReasoning', text: '' });
			}
			return;
		case 'reasoningUpdate':
			dispatch({ type: 'setReasoning', text: message.text ?? '' });
			return;
		case 'authState':
			dispatch({ type: 'setAuth', status: message.status, detail: message.detail });
			if (message.status !== 'loggingIn') {
				dispatch({ type: 'setBusy', busy: false });
			}
			return;
		case 'reasoningState':
			dispatch({ type: 'setReasoningEffort', effort: message.effort });
			return;
		case 'sessionState':
			dispatch({
				type: 'setSessionState',
				sessions: message.sessions ?? [],
				activeSessionId: message.activeSessionId,
				messages: message.messages ?? [],
			});
			return;
		default:
			return;
	}
}

export function useHostMessaging() {
	const [state, dispatch] = useReducer(reducer, initialState);

	useEffect(() => {
		const listener = (event: MessageEvent<HostToWebviewMessage>) => {
			const message = event.data;
			if (!message || typeof message !== 'object') {
				return;
			}
			handleHostMessage(dispatch, message);
		};

		window.addEventListener('message', listener);
		postMessage({ type: 'requestStatus' });

		return () => window.removeEventListener('message', listener);
	}, []);

	const submitPrompt = (prompt: string) => {
		postMessage({ type: 'submitPrompt', prompt });
	};

	const login = () => {
		dispatch({ type: 'setAuth', status: 'loggingIn', detail: 'Opening browser for Codex login…' });
		postMessage({ type: 'requestLogin' });
	};

	const requestStatus = () => postMessage({ type: 'requestStatus' });
	const setReasoningEffort = (effort: ReasoningEffortOption) => {
		dispatch({ type: 'setReasoningEffort', effort });
		postMessage({ type: 'setReasoningEffort', effort });
	};

	const newSession = (title?: string) => postMessage({ type: 'newSession', title });
	const switchSession = (sessionId: string) => postMessage({ type: 'switchSession', sessionId });
	const renameSession = (sessionId: string, title: string) => postMessage({ type: 'renameSession', sessionId, title });

	return {
		state,
		handlers: { submitPrompt, login, requestStatus, setReasoningEffort, newSession, switchSession, renameSession },
		postMessage: vscode.postMessage,
	};
}
