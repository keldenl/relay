/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import type { AuthStatus } from '@shared/messages';

interface Props {
	visible: boolean;
	auth: { status: AuthStatus; detail?: string };
	onLogin: () => void;
}

export default function LoginShell({ visible, auth, onLogin }: Props): JSX.Element {
	if (!visible) return <></>;

	return (
		<div className="login-shell" aria-live="polite">
			<div className="login-content">
				<div className="login-title">Sign in to Codex</div>
				<p className="login-copy">
					{auth.detail || 'Log in with ChatGPT to run Codex tasks in this workspace.'}
				</p>
				<button
					type="button"
					className="login-button"
					onClick={onLogin}
					disabled={auth.status === 'loggingIn'}
				>
					{auth.status === 'loggingIn' ? 'Opening…' : 'Log in with ChatGPT'}
				</button>
			</div>
		</div>
	);
}
