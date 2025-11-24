/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useMemo, useRef, useState } from 'react';
import type { HostToWebviewMessage } from '@shared/messages';
import { useHostMessaging } from './hooks/useHostMessaging';
import { useAutoOpen } from './hooks/useAutoOpen';
import { useAutoScroll } from './hooks/useAutoScroll';
import LoginShell from './components/LoginShell';
import AgentShell from './components/AgentShell';

export default function App(): JSX.Element {
	const [input, setInput] = useState('');
	const listRef = useRef<HTMLDivElement | null>(null);

	const { state, handlers, postMessage } = useHostMessaging();
	const { auth, busy, reasoning, messages } = state;

	useAutoOpen(messages, postMessage);
	useAutoScroll(listRef, [messages, reasoning, busy]);

	const showAgent = auth.status === 'loggedIn';
	const showReasoning = busy || Boolean(reasoning?.trim());

	const onSubmit = useMemo(
		() => (event?: React.FormEvent) => {
			event?.preventDefault();
			const value = input.trim();
			if (!value || busy) {
				return;
			}
			handlers.submitPrompt(value);
			setInput('');
		},
		[input, busy, handlers]
	);

	const onLogin = () => handlers.login();

	return (
		<div className="app-shell" style={{ width: '100%' }}>
			<LoginShell
				visible={!showAgent}
				auth={auth}
				onLogin={onLogin}
			/>

			<AgentShell
				visible={showAgent}
				messages={messages}
				reasoning={reasoning}
				showReasoning={showReasoning}
				busy={busy}
				input={input}
				setInput={setInput}
				onSubmit={onSubmit}
				listRef={listRef}
			/>
		</div>
	);
}
