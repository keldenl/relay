/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import type { AgentMessage, ParsedCommandPart } from '@shared/messages';
import { postMessage } from '../vscode';

const READ_KIND = 'read';
const LIST_KIND = 'list';
const SEARCH_KIND = 'search';

export function buildSummary(parsed: ParsedCommandPart[] | undefined, msg: AgentMessage): JSX.Element {
	if (Array.isArray(parsed) && parsed.length > 0) {
		const pieces = parsed.map((p, idx) => (
			<React.Fragment key={idx}>
				{idx > 0 ? ' | ' : null}
				{renderPart(p)}
			</React.Fragment>
		));
		return <span>{pieces}</span>;
	}

	return <span>{msg.friendlySummary || (msg.command ? `> ${msg.command}` : 'Command output')}</span>;
}

function renderPart(part: ParsedCommandPart): JSX.Element {
	if (part.kind === READ_KIND) {
		return (
			<>
				Read{' '}
				<LinkToTarget label={part.label || part.name || part.path || part.raw || 'file'} path={part.absPath || part.path} />
			</>
		);
	}

	if (part.kind === LIST_KIND) {
		return (
			<>
				Listed{' '}
				<LinkToTarget label={part.label || part.name || part.path || '.'} path={part.absPath || part.path || '.'} isDir />
			</>
		);
	}

	if (part.kind === SEARCH_KIND) {
		const targetLabel = part.label || part.name || part.path;
		return (
			<>
				Searched {part.query ? `"${part.query}"` : 'files'}
				{targetLabel ? (
					<>
						{' in '}
						<LinkToTarget label={targetLabel} path={part.absPath || part.path} isDir />
					</>
				) : null}
			</>
		);
	}

	return <span>Ran {part.raw || part.label || part.name || part.path || 'command'}</span>;
}

export function LinkToTarget({ label, path, isDir }: { label: string; path?: string; isDir?: boolean }): JSX.Element {
	if (!path) {
		return <>{label}</>;
	}

	return (
		<a
			href="#"
			onClick={(e) => {
				e.preventDefault();
				postMessage({ type: 'openPath', path, isDir: Boolean(isDir) });
			}}
		>
			{label}
		</a>
	);
}
