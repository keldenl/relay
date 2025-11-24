/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useReducer } from 'react';
import type { AgentMessage, AuthStatus, HostToWebviewMessage } from '@shared/messages';
import vscode, { postMessage } from '../vscode';

type State = {
	auth: { status: AuthStatus; detail?: string };
	busy: boolean;
	reasoning: string;
	messages: AgentMessage[];
};

type Action =
	| { type: 'setAuth'; status: AuthStatus; detail?: string }
	| { type: 'setBusy'; busy: boolean }
	| { type: 'setReasoning'; text: string }
	| { type: 'appendMessage'; message: AgentMessage }
	| { type: 'clear' };

const initialState: State = {
	auth: { status: 'checking' },
	busy: false,
	reasoning: '',
	messages: [],
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
			return { ...state, messages: [...state.messages, action.message] };
		case 'clear':
			return { ...state, messages: [], reasoning: '' };
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

	return {
		state,
		handlers: { submitPrompt, login, requestStatus },
		postMessage: vscode.postMessage,
	};
}
