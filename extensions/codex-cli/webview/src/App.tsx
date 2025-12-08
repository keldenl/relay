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
	const { auth, busy, reasoning, messages, reasoningEffort, model, sessions, activeSessionId } = state;

	useAutoOpen(messages, postMessage);
	useAutoScroll(listRef, [messages, reasoning, busy]);

	const showAgent = auth.status === 'loggedIn';
	const activeSessionTitle = sessions.find((s) => s.id === activeSessionId)?.title ?? 'Chat';

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
		<div className="flex h-full w-full min-h-0 flex-col bg-editor text-editor">
			<LoginShell
				visible={!showAgent}
				auth={auth}
				onLogin={onLogin}
			/>

			<AgentShell
				visible={showAgent}
				messages={messages}
				busy={busy}
				input={input}
				setInput={setInput}
				onSubmit={onSubmit}
				listRef={listRef}
				reasoningEffort={reasoningEffort}
				model={model}
				onReasoningEffortChange={handlers.setReasoningEffort}
				onModelChange={handlers.setModel}
				onModelAndEffortChange={handlers.setModelAndEffort}
				sessionTitle={activeSessionTitle}
				sessions={sessions}
				activeSessionId={activeSessionId}
				onNewSession={handlers.newSession}
				onSwitchSession={handlers.switchSession}
			/>
		</div>
	);
}
