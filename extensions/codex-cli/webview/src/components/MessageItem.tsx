/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import type { AgentMessage, ParsedCommandPart } from '@shared/messages';
import { buildSummary, LinkToTarget } from '../utils/commandRendering';

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

	const className = ['message', role, entering ? 'is-entering' : ''].filter(Boolean).join(' ');
	const summary = React.useMemo(() => buildSummary(message.parsed, message), [message.parsed, message]);

	if (role === 'command') {
		return (
			<div className={className + ' command'}>
				<div className="command-title">{summary}</div>
				{!hasRead && (
					<pre className="body">{message.text ?? ''}</pre>
				)}
			</div>
		);
	}

	const body = message.text ?? '';

	return (
		<div className={className}>
			<div className="body">{body}</div>
		</div>
	);
}
