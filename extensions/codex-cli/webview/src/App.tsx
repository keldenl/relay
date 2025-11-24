/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentMessage, AuthStatus, HostToWebviewMessage, ParsedCommandPart } from '@shared/messages';
import { postMessage } from './vscode';

type AuthState = { status: AuthStatus; detail?: string };

const READ_KIND = 'read';
const LIST_KIND = 'list';
const SEARCH_KIND = 'search';

export default function App(): JSX.Element {
	const [auth, setAuth] = useState<AuthState>({ status: 'checking' });
	const [busy, setBusy] = useState(false);
	const [reasoning, setReasoning] = useState('');
	const [messages, setMessages] = useState<AgentMessage[]>([]);
	const [input, setInput] = useState('');

	const autoOpened = useRef<Set<string>>(new Set());
	const listRef = useRef<HTMLDivElement | null>(null);
	const renderedCount = useRef(0);

	useEffect(() => {
		const handler = (event: MessageEvent<HostToWebviewMessage>) => {
			const message = event.data;
			if (!message || typeof message !== 'object') {
				return;
			}

			switch (message.type) {
				case 'appendMessage': {
					const next: AgentMessage = {
						role: message.role ?? 'assistant',
						text: message.text ?? '',
						command: message.command,
						friendlyTitle: message.friendlyTitle,
						friendlySummary: message.friendlySummary,
						targets: message.targets ?? [],
						parsed: message.parsed ?? [],
					};
					setMessages((prev) => [...prev, next]);
					break;
				}
				case 'clearMessages':
					setMessages([]);
					renderedCount.current = 0;
					setReasoning('');
					autoOpened.current.clear();
					break;
				case 'setBusy':
					setBusy(Boolean(message.busy));
					if (!message.busy) {
						setReasoning('');
					}
					break;
				case 'reasoningUpdate':
					setReasoning(message.text ?? '');
					break;
				case 'authState':
					setAuth({ status: message.status, detail: message.detail });
					if (message.status !== 'loggingIn') {
						setBusy(false);
					}
					break;
				default:
					break;
			}
		};

		window.addEventListener('message', handler);
		postMessage({ type: 'requestStatus' });

		return () => {
			window.removeEventListener('message', handler);
		};
	}, []);

	// Auto-open read targets (only once).
	useEffect(() => {
		for (const msg of messages.slice(renderedCount.current)) {
			if (msg.role !== 'command' || !Array.isArray(msg.parsed)) {
				renderedCount.current += 1;
				continue;
			}
			for (const part of msg.parsed) {
				if (part?.kind !== READ_KIND) {
					continue;
				}
				const target = part.absPath || part.path;
				if (!target || autoOpened.current.has(target)) {
					continue;
				}
				autoOpened.current.add(target);
				postMessage({ type: 'openPath', path: target, isDir: false });
			}
			renderedCount.current += 1;
		}
	}, [messages]);

	// Keep scroll pinned to bottom.
	useEffect(() => {
		const el = listRef.current;
		if (!el) { return; }
		el.scrollTop = el.scrollHeight;
	}, [messages, reasoning, busy]);

	const showAgent = auth.status === 'loggedIn';
	const showReasoning = busy || Boolean(reasoning?.trim());

	function handleSubmit(event?: React.FormEvent) {
		event?.preventDefault();
		const value = input.trim();
		if (!value || busy) {
			return;
		}
		postMessage({ type: 'submitPrompt', prompt: value });
		setInput('');
	}

	function handleLogin() {
		setAuth({ status: 'loggingIn', detail: 'Opening browser for Codex login…' });
		postMessage({ type: 'requestLogin' });
	}

	return (
		<div className="app-shell" style={{ width: '100%' }}>
			<div className="login-shell" style={{ display: showAgent ? 'none' : 'flex' }} aria-live="polite">
				<div className="login-content">
					<div className="login-title">Sign in to Codex</div>
					<p className="login-copy">
						{auth.detail || 'Log in with ChatGPT to run Codex tasks in this workspace.'}
					</p>
					<button
						type="button"
						className="login-button"
						onClick={handleLogin}
						disabled={auth.status === 'loggingIn'}
					>
						{auth.status === 'loggingIn' ? 'Opening…' : 'Log in with ChatGPT'}
					</button>
				</div>
			</div>

			<div className="agent-shell" style={{ display: showAgent ? 'flex' : 'none' }}>
				<section className="messages" aria-label="Agent messages" ref={listRef}>
					{messages.map((msg, idx) => {
						if (msg.role === 'system') {
							return null;
						}
						return (
							<MessageItem
								key={idx}
								message={msg}
							/>
						);
					})}
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
					<form aria-label="Send a prompt" onSubmit={handleSubmit}>
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
		</div>
	);
}

function MessageItem({ message }: { message: AgentMessage }): JSX.Element {
	const role = message.role ?? 'assistant';
	const hasRead = Array.isArray(message.parsed) && message.parsed.some((p) => p?.kind === READ_KIND);
	const [entering, setEntering] = React.useState(true);

	React.useEffect(() => {
		const id = requestAnimationFrame(() => setEntering(false));
		return () => cancelAnimationFrame(id);
	}, []);

	const className = ['message', role, entering ? 'is-entering' : ''].filter(Boolean).join(' ');

	const summary = useMemo(() => buildSummary(message.parsed, message), [message.parsed, message]);

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

function buildSummary(parsed: ParsedCommandPart[] | undefined, msg: AgentMessage): JSX.Element {
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

function LinkToTarget({ label, path, isDir }: { label: string; path?: string; isDir?: boolean }): JSX.Element {
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
