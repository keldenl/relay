/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import type { AgentMessage, ReasoningEffortOption } from '@shared/messages';
import MessageList from './MessageList';
import TopBar from './TopBar';
import { ArrowUp } from 'lucide-react';

interface Props {
	visible: boolean;
	messages: AgentMessage[];
	busy: boolean;
	input: string;
	setInput: (v: string) => void;
	onSubmit: (event?: React.FormEvent) => void;
	listRef: React.RefObject<HTMLDivElement>;
	reasoningEffort: ReasoningEffortOption;
	onReasoningEffortChange: (effort: ReasoningEffortOption) => void;
}

export default function AgentShell({
	visible,
	messages,
	busy,
	input,
	setInput,
	onSubmit,
	listRef,
	reasoningEffort,
	onReasoningEffortChange,
}: Props): JSX.Element {
	if (!visible) return <></>;

	return (
		<div className="flex h-full min-h-0 w-full flex-1 flex-col bg-editor">
			<TopBar effort={reasoningEffort} onChange={onReasoningEffortChange} />
			<section
				className="messages flex flex-1 min-h-0 flex-col gap-2 overflow-y-auto bg-editor px-4 pb-2"
				aria-label="Agent messages"
				ref={listRef}
			>
				<MessageList messages={messages} />
			</section>

			<div className="bg-editor px-4 pt-2 pb-4">
				<form className="flex items-center gap-2" aria-label="Send a prompt" onSubmit={onSubmit}>
					<input
						type="text"
						name="prompt"
						placeholder="Describe the task..."
						aria-label="Agent prompt"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						disabled={busy}
						className="text-placeholder focus-visible:ring-[var(--vscode-focusBorder)] focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none flex-1 rounded-full border border-input bg-input px-4 py-2 text-sm text-input disabled:opacity-70"
					/>
					<button
						type="submit"
						disabled={busy || !input.trim()}
						className="rounded-full border border-button bg-button p-2 text-button shadow-sm transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-60"
					>
						<ArrowUp className="size-5"/>
					</button>
				</form>
			</div>
		</div>
	);
}
