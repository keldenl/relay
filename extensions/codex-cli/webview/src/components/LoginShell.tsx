/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import type { AuthStatus } from '@shared/messages';
import { cn } from '../utils/cn';

interface Props {
	visible: boolean;
	auth: { status: AuthStatus; detail?: string };
	onLogin: () => void;
}

export default function LoginShell({ visible, auth, onLogin }: Props): JSX.Element {
	if (!visible) return <></>;

	return (
		<div className="flex h-full flex-1 items-center justify-center bg-editor px-6 py-6" aria-live="polite">
			<div className="flex max-w-xl flex-col items-center gap-3 text-center">
				<div className="text-base font-semibold tracking-wide text-editor">Sign in to Codex</div>
				<p className="m-0 text-sm leading-relaxed text-description">
					{auth.detail || 'Log in with ChatGPT to run Codex tasks in this workspace.'}
				</p>
				<button
					type="button"
					className={cn(
						'mt-1 h-9 rounded-md border border-button bg-button px-4 text-xs font-semibold text-button shadow-sm transition-opacity',
						auth.status === 'loggingIn' ? 'opacity-80' : 'hover:opacity-90',
						'disabled:cursor-default disabled:opacity-75'
					)}
					onClick={onLogin}
					disabled={auth.status === 'loggingIn'}
				>
					{auth.status === 'loggingIn' ? 'Opening…' : 'Log in with ChatGPT'}
				</button>
			</div>
		</div>
	);
}
