/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import type { AgentMessage } from '@shared/messages';
import { buildSummary } from '../utils/commandRendering';
import { cn } from '../utils/cn';

const READ_KIND = 'read';

interface Props {
	message: AgentMessage;
}

export default function MessageItem({ message }: Props): JSX.Element {
	const role = message.role ?? 'assistant';
	const hasRead = Array.isArray(message.parsed) && message.parsed.some((p) => p?.kind === READ_KIND);
	const [entering, setEntering] = React.useState(true);

	React.useEffect(() => {
		const id = requestAnimationFrame(() => setEntering(false));
		return () => cancelAnimationFrame(id);
	}, []);

	const summary = React.useMemo(() => buildSummary(message.parsed, message), [message.parsed, message]);

	if (role === 'command') {
		return (
			<div className={cn(
				'message command',
				'p-0 border-0 bg-transparent text-[color:var(--vscode-foreground)] shadow-none'
			)}>
				<div className="mb-1 text-[13px] font-semibold">{summary}</div>
				{!hasRead && (
					<pre className="m-0 max-h-[5.6em] overflow-auto rounded-md border border-block bg-editor px-3 py-2 text-[13px] leading-[1.4] whitespace-pre-wrap">
						{message.text ?? ''}
					</pre>
				)}
			</div>
		);
	}

	const body = message.text ?? '';

	return (
		<div className={cn(
			'message',
			role,
			entering && 'is-entering',
			role === 'assistant'
				? 'border-0 bg-transparent p-0 shadow-none text-[color:var(--vscode-foreground)]'
				: 'rounded-md border border-input bg-input p-3 text-[13px] leading-[1.5] text-input shadow-sm',
			role === 'system' && 'border-dashed border-block bg-side text-description'
		)}>
			<div className="whitespace-pre-wrap text-[13px] leading-[1.5]">{body}</div>
		</div>
	);
}
