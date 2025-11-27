/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ReasoningEffortOption } from '@shared/messages';
import { cn } from '../utils/cn';

type Props = {
	effort: ReasoningEffortOption;
	onChange: (effort: ReasoningEffortOption) => void;
};

const OPTION_META: Record<ReasoningEffortOption, { title: string; description: string }> = {
	low: { title: 'Low', description: 'Quick and simple asks' },
	medium: { title: 'Standard', description: 'Balanced quality and speed' },
	high: { title: 'High', description: 'Thinks longer for better answers' },
	xhigh: { title: 'xHigh', description: 'Deepest reasoning for the most complex tasks' },
};
const OPTION_ORDER: ReasoningEffortOption[] = ['low', 'medium', 'high', 'xhigh'];

export default function TopBar({ effort, onChange }: Props): JSX.Element {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);

	const title = useMemo(() => {
		const suffix = effort === 'medium' ? '' : ` ${OPTION_META[effort].title}`;
		return `5.1 Codex Max${suffix}`;
	}, [effort]);

	useEffect(() => {
		if (!open) return;
		const onClick = (evt: MouseEvent) => {
			const target = evt.target as Node;
			if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
				return;
			}
			setOpen(false);
		};
		const onKey = (evt: KeyboardEvent) => {
			if (evt.key === 'Escape') {
				setOpen(false);
			}
		};
		window.addEventListener('mousedown', onClick);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('mousedown', onClick);
			window.removeEventListener('keydown', onKey);
		};
	}, [open]);

	const selectEffort = (next: ReasoningEffortOption) => {
		onChange(next);
		setOpen(false);
	};

	return (
		<header className="relative flex items-center justify-start px-4 py-3">
			<div className="relative">
				<button
					ref={triggerRef}
					type="button"
					aria-haspopup="listbox"
					aria-expanded={open}
					onClick={() => setOpen((v) => !v)}
					className="group inline-flex items-center gap-2 text-description text-lg font-light transition hover:border-button hover:text-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vscode-focusBorder)]"
				>
					<span className="truncate"><span className="font-normal text-editor">GPT{" "}</span>{title}</span>
					{/* // allow-any-unicode-next-line */}
					<span className={cn('transition-transform', open && 'rotate-180')}>▾</span>
				</button>

				{open && (
					<div
						ref={menuRef}
						className="absolute left-0 z-10 mt-2 w-72 rounded-xl border border-input bg-[var(--vscode-editorWidget-background)] shadow-lg overflow-hidden"
						role="listbox"
					>
						{OPTION_ORDER.map((value) => {
							const meta = OPTION_META[value];
							const active = effort === value;
							return (
								<button
									key={value}
									type="button"
									onClick={() => selectEffort(value)}
									className={cn(
										'flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-[var(--vscode-list-hoverBackground)]',
										active && 'bg-[var(--vscode-list-activeSelectionBackground)]'
									)}
									role="option"
									aria-selected={active}
								>
									<div className="flex-1">
										<div className="text-sm font-semibold text-editor">{meta.title}</div>
										<div className="text-xs text-description">{meta.description}</div>
									</div>
									{active && <div className="text-button text-sm">✓</div>}
								</button>
							);
						})}
					</div>
				)}
			</div>
		</header>
	);
}
