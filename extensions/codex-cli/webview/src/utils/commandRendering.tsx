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
		const lineStart = typeof part.lineStart === 'number' ? Math.max(0, part.lineStart) : undefined;
		const lineEnd = typeof part.lineEnd === 'number' ? Math.max(lineStart ?? 0, part.lineEnd) : undefined;
		const rangeLabel = lineStart !== undefined && lineEnd !== undefined
			? `${lineStart + 1}-${lineEnd + 1}`
			: undefined;
		return (
			<>
				Read{' '}
				<LinkToTarget
					label={part.label || part.name || part.path || part.raw || 'file'}
					path={part.absPath || part.path}
					lineStart={lineStart}
					lineEnd={lineEnd ?? lineStart}
				/>
				{rangeLabel ? (
					<span className="ml-1 text-[11px] text-description align-middle">{rangeLabel}</span>
				) : null}
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

export function LinkToTarget({
	label,
	path,
	isDir,
	lineStart,
	lineEnd,
}: { label: string; path?: string; isDir?: boolean; lineStart?: number; lineEnd?: number }): JSX.Element {
	if (!path) {
		return <>{label}</>;
	}

	return (
		<a
			href="#"
			onClick={(e) => {
				e.preventDefault();
				const hasLineInfo = typeof lineStart === 'number' || typeof lineEnd === 'number';
				const start = typeof lineStart === 'number' ? Math.max(0, lineStart) : 0;
				const end = typeof lineEnd === 'number' ? Math.max(start, lineEnd) : start;
				postMessage({
					type: 'openPath',
					path,
					isDir: Boolean(isDir),
					...(hasLineInfo && !isDir ? { selection: { start, end } } : {}),
				});
			}}
		>
			{label}
		</a>
	);
}
