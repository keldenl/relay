/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* global acquireVsCodeApi */
import type { WebviewToHostMessage } from '@shared/messages';

interface VSCodeApi<T> {
	postMessage(message: T): void;
	getState(): unknown;
	setState(data: unknown): void;
}

const vscode: VSCodeApi<WebviewToHostMessage> =
	typeof acquireVsCodeApi === 'function'
		? acquireVsCodeApi()
		: {
			// Fallback for tests / preview outside VS Code
			postMessage: (message: WebviewToHostMessage) => {
				console.log('[vscode mock] postMessage', message);
			},
			getState: () => undefined,
			setState: () => undefined,
		};

export function postMessage(message: WebviewToHostMessage): void {
	vscode.postMessage(message);
}

export default vscode;
