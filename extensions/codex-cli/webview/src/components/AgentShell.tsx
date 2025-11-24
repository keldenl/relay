/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import type { AgentMessage } from '@shared/messages';
import MessageList from './MessageList';

interface Props {
	visible: boolean;
	messages: AgentMessage[];
	reasoning: string;
	showReasoning: boolean;
	busy: boolean;
	input: string;
	setInput: (v: string) => void;
	onSubmit: (event?: React.FormEvent) => void;
	listRef: React.RefObject<HTMLDivElement>;
}

export default function AgentShell({
	visible,
	messages,
	reasoning,
	showReasoning,
	busy,
	input,
	setInput,
	onSubmit,
	listRef,
}: Props): JSX.Element {
	if (!visible) return <></>;

	return (
		<div className="agent-shell">
			<section className="messages" aria-label="Agent messages" ref={listRef}>
				<MessageList messages={messages} />
			</section>

			<div
				className="reasoning-bar"
				hidden={!showReasoning}
				aria-hidden={!showReasoning}
				aria-live="polite"
			>
				<div className="reasoning-spinner" aria-hidden="true" />
				<div className="reasoning-text">{reasoning || 'Thinking…'}</div>
			</div>

			<div className="input-row">
				<form aria-label="Send a prompt" onSubmit={onSubmit}>
					<input
						type="text"
						name="prompt"
						placeholder="Ask anything..."
						aria-label="Agent prompt"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						disabled={busy}
					/>
					<button type="submit" disabled={busy || !input.trim()}>
						Send
					</button>
				</form>
			</div>
		</div>
	);
}
