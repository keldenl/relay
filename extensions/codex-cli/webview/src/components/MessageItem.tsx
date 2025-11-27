/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import type { AgentMessage, FileChangePreview } from '@shared/messages';
import { buildSummary } from '../utils/commandRendering';
import { cn } from '../utils/cn';
import { postMessage } from '../vscode';

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
	const hasFileChanges = Array.isArray(message.fileChanges) && message.fileChanges.length > 0;

	if (hasFileChanges) {
		const single = message.fileChanges!.length === 1;
		const first = message.fileChanges![0];
		const titleContent = single ? (
			<span>
				Updated{' '}
				<FileLink change={first} />
			</span>
		) : (
			<span>Updated files</span>
		);
		return (
			<div className={cn(
				'message command',
				'p-0 border-0 bg-transparent text-[color:var(--vscode-foreground)] shadow-none'
			)}>
				<div className="mb-2 text-[13px] font-semibold">{titleContent}</div>
				<FileChangeList changes={message.fileChanges ?? []} hideLabel={single} />
			</div>
		);
	}

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

function FileChangeList({ changes, hideLabel }: { changes: FileChangePreview[]; hideLabel?: boolean }): JSX.Element {
	return (
		<div className="flex flex-col gap-3">
			{changes.map((change, idx) => (
				<div key={idx} className="text-[13px]">
					{hideLabel ? null : (
						<div className="mb-1">
							<strong>Updated </strong>
							<FileLink change={change} />
						</div>
					)}
					{change.diff ? <DiffBlock diff={change.diff} /> : null}
				</div>
			))}
		</div>
	);
}

function DiffBlock({ diff }: { diff: string }): JSX.Element {
	const lines = React.useMemo(() => diff.split(/\r?\n/), [diff]);
	return (
		<div className="diff-block" aria-label="File diff">
			{lines.map((line, idx) => (
				<div key={idx} className={cn('diff-line', diffClass(line))}>
					{line || '\u00a0'}
				</div>
			))}
		</div>
	);
}

function jumpToLine(change: FileChangePreview): void {
	const target = change.absPath ?? change.path;
	if (!target) return;
	const start = typeof change.line === 'number' ? Math.max(0, change.line - 1) : undefined;
	postMessage({ type: 'openPath', path: target, selection: start !== undefined ? { start, end: start } : undefined });
}

function badgeClass(kind?: string): string {
	switch ((kind ?? '').toLowerCase()) {
		case 'add':
			return 'bg-[rgba(46,204,113,0.15)] text-[color:var(--vscode-testing-iconPassed)] border border-[color:var(--vscode-testing-iconPassed)]';
		case 'delete':
			return 'bg-[rgba(231,76,60,0.15)] text-[color:var(--vscode-testing-iconFailed)] border border-[color:var(--vscode-testing-iconFailed)]';
		default:
			return 'bg-[rgba(52,152,219,0.12)] text-[color:var(--vscode-focusBorder)] border border-[color:var(--vscode-focusBorder)]';
	}
}

function diffClass(line: string): string {
	if (line.startsWith('+')) return 'is-add';
	if (line.startsWith('-')) return 'is-del';
	if (line.startsWith('@@')) return 'is-hunk';
	return '';
}
function FileLink({ change }: { change: FileChangePreview }): JSX.Element {
	const label = basename(change.path);
	return (
		<a
			href="#"
			onClick={(e) => {
				e.preventDefault();
				jumpToLine(change);
			}}
			className="text-link hover:underline"
			title={change.absPath || change.path}
		>
			{label}
		</a>
	);
}

function basename(p: string): string {
	const parts = p.split(/[\\/]/);
	return parts[parts.length - 1] || p;
}
