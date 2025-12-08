/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CodexModelId, ReasoningEffortOption, SessionListItem } from '@shared/messages';
import { cn } from '../utils/cn';
import {Check, ChevronDown, History, Pen} from 'lucide-react';

type Props = {
	effort: ReasoningEffortOption;
	model: CodexModelId;
	onChange: (effort: ReasoningEffortOption) => void;
	onModelChange: (model: CodexModelId) => void;
	onModelAndEffortChange: (model: CodexModelId, effort: ReasoningEffortOption) => void;
	sessionTitle: string;
	sessions: SessionListItem[];
	activeSessionId?: string;
	onNewSession: (title?: string) => void;
	onSwitchSession: (sessionId: string) => void;
};

const OPTION_META: Record<ReasoningEffortOption, { title: string; description: string }> = {
	low: { title: 'Low', description: 'Quick and simple asks' },
	medium: { title: 'Standard', description: 'Balanced quality and speed' },
	high: { title: 'High', description: 'Thinks longer for better answers' },
	xhigh: { title: 'xHigh', description: 'Deepest reasoning for the most complex tasks' },
};
const OPTION_ORDER: ReasoningEffortOption[] = ['low', 'medium', 'high', 'xhigh'];
const MODEL_META: Record<CodexModelId, { title: string; subtitle: string }> = {
	'gpt-5.1-codex-max': { title: 'GPT 5.1 Codex Max', subtitle: 'Best for coding and refactors' },
	'gpt-5.1': { title: 'GPT 5.1', subtitle: 'Great for planning and general help' },
};

export default function TopBar({ effort, model, onChange, onModelChange, onModelAndEffortChange, sessionTitle, sessions, activeSessionId, onNewSession, onSwitchSession }: Props): JSX.Element {
	const [effortOpen, setEffortOpen] = useState(false);
	const [modelOpen, setModelOpen] = useState(false);
	const [activeModelHover, setActiveModelHover] = useState<CodexModelId | null>(null);
	const [sessionOpen, setSessionOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const sessionRef = useRef<HTMLDivElement | null>(null);
	const effortPanelRef = useRef<HTMLDivElement | null>(null);

	const title = useMemo(() => {
		const modelTitle = MODEL_META[model]?.title ?? 'GPT';
		const suffix = effort === 'medium' ? '' : ` • ${OPTION_META[effort].title}`;
		return `${modelTitle}${suffix}`;
	}, [effort, model]);

	useEffect(() => {
		if (!modelOpen) return;
		const onClick = (evt: MouseEvent) => {
			const target = evt.target as Node;
			if (menuRef.current?.contains(target) || triggerRef.current?.contains(target) || effortPanelRef.current?.contains(target)) {
				return;
			}
			setModelOpen(false);
			setEffortOpen(false);
			setActiveModelHover(null);
		};
		const onKey = (evt: KeyboardEvent) => {
			if (evt.key === 'Escape') {
				setModelOpen(false);
				setEffortOpen(false);
				setActiveModelHover(null);
			}
		};
		window.addEventListener('mousedown', onClick);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('mousedown', onClick);
			window.removeEventListener('keydown', onKey);
		};
	}, [modelOpen]);

	useEffect(() => {
		if (!sessionOpen) return;
		const onClick = (evt: MouseEvent) => {
			const target = evt.target as Node;
			if (sessionRef.current?.contains(target)) return;
			setSessionOpen(false);
		};
		const onKey = (evt: KeyboardEvent) => {
			if (evt.key === 'Escape') setSessionOpen(false);
		};
		window.addEventListener('mousedown', onClick);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('mousedown', onClick);
			window.removeEventListener('keydown', onKey);
		};
	}, [sessionOpen]);

	const selectEffort = (next: ReasoningEffortOption) => {
		onChange(next);
		setEffortOpen(false);
		setModelOpen(false);
	};

	const commitModelAndEffort = (nextModel: CodexModelId, nextEffort: ReasoningEffortOption) => {
		onModelAndEffortChange(nextModel, nextEffort);
		setActiveModelHover(null);
		setEffortOpen(false);
		setModelOpen(false);
	};

	const selectModel = (nextModel: CodexModelId) => {
		onModelChange(nextModel);
		setActiveModelHover(null);
		setModelOpen(false);
	};

	return (
		<header className="relative flex items-center justify-between gap-4 px-4 py-3">
			<div className="relative">
				<button
					ref={triggerRef}
					type="button"
					aria-haspopup="listbox"
					aria-expanded={modelOpen}
					onClick={() => {
						setModelOpen((v) => !v);
						setEffortOpen(false);
						setActiveModelHover(null);
					}}
					className="group inline-flex items-center gap-1 text-description text-lg font-light transition cursor-pointer hover:border-button hover:text-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vscode-focusBorder)]"
				>
					<span className="truncate text-editor">{title}</span>
					<ChevronDown className={cn('transition-transform size-4', modelOpen && 'rotate-180')}/>
				</button>

				{modelOpen && (
					<div
						ref={menuRef}
						className="absolute left-0 z-10 mt-2 w-[18rem] rounded-xl border border-input bg-[var(--vscode-editorWidget-background)] shadow-lg overflow-visible"
						role="listbox"
					>
						{(Object.keys(MODEL_META) as CodexModelId[]).map((value) => {
							const meta = MODEL_META[value];
							const active = model === value;
							const hovered = activeModelHover === value;
							return (
								<div
									key={value}
									className="relative flex w-full items-stretch"
								>
									<button
										type="button"
										onClick={() => selectModel(value)}
										onMouseEnter={() => { setActiveModelHover(value); setEffortOpen(true); }}
										onFocus={() => { setActiveModelHover(value); setEffortOpen(true); }}
										className={cn(
											'flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-[var(--vscode-list-hoverBackground)]',
											active && 'bg-[var(--vscode-list-activeSelectionBackground)]'
										)}
										role="option"
										aria-selected={active}
									>
										<div className="flex-1">
											<div className="text-sm font-semibold text-editor">{meta.title}</div>
											<div className="text-xs text-description">{meta.subtitle}</div>
										</div>
										{active && <Check className="text-button size-4" />}
									</button>

									{effortOpen && hovered && (
										<div
											ref={effortPanelRef}
											className="absolute left-full top-0 z-20 ml-1 w-64 rounded-xl border border-input bg-[var(--vscode-editorWidget-background)] shadow-lg overflow-hidden"
											role="listbox"
											aria-label="Reasoning effort"
										>
											{OPTION_ORDER.map((valueEffort) => {
												const metaEffort = OPTION_META[valueEffort];
												const activeEffort = effort === valueEffort && model === value;
												return (
													<button
														key={valueEffort}
														type="button"
														onClick={() => commitModelAndEffort(value, valueEffort)}
														className={cn(
															'flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-[var(--vscode-list-hoverBackground)]',
															activeEffort && 'bg-[var(--vscode-list-activeSelectionBackground)]'
														)}
														role="option"
														aria-selected={activeEffort}
													>
														<div className="flex-1">
															<div className="text-sm font-semibold text-editor">{metaEffort.title}</div>
															<div className="text-xs text-description">{metaEffort.description}</div>
														</div>
														{activeEffort && <Check className="text-button size-4" />}
													</button>
												);
											})}
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>

			<div className="flex items-center gap-2">
				<div className="relative" ref={sessionRef}>
					<button
						type="button"
						aria-haspopup="listbox"
						aria-expanded={sessionOpen}
						onClick={() => setSessionOpen((v) => !v)}
						title={sessionTitle}
						className="inline-flex items-center justify-center rounded-full p-2 text-editor transition hover:bg-[var(--vscode-list-hoverBackground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vscode-focusBorder)]"
					>
						<History className="size-4" />
					</button>
					{sessionOpen && (
						<div
							className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-input bg-[var(--vscode-editorWidget-background)] shadow-lg"
							role="listbox"
							aria-label="Chat sessions"
						>
							{sessions.length === 0 && (
								<div className="px-3 py-2 text-xs text-description text-right">No prior chats yet.</div>
							)}
							{sessions.map((s) => {
								const active = s.id === activeSessionId;
								return (
									<button
										key={s.id}
										type="button"
										onClick={() => { onSwitchSession(s.id); setSessionOpen(false); }}
										className={cn(
											'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-[var(--vscode-list-hoverBackground)]',
											active && 'bg-[var(--vscode-list-activeSelectionBackground)] font-semibold'
										)}
										role="option"
										aria-selected={active}
									>
										{active && <Check className="size-4 text-button" />}
										<span className="truncate flex-1">{s.title}</span>
									</button>
								);
							})}
						</div>
					)}
				</div>

				<button
					type="button"
					title="New chat"
					onClick={() => onNewSession()}
					className="inline-flex items-center justify-center rounded-full bg-[var(--vscode-button-background)] p-2 text-[var(--vscode-button-foreground)] shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vscode-focusBorder)]"
				>
					<Pen className="size-4" />
				</button>
			</div>
		</header>
	);
}
