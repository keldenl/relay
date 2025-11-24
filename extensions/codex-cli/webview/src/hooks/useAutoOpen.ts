/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef } from 'react';
import type { AgentMessage, WebviewToHostMessage } from '@shared/messages';

export function useAutoOpen(messages: AgentMessage[], postMessage: (msg: WebviewToHostMessage) => void): void {
	const autoOpened = useRef<Set<string>>(new Set());
	const renderedCount = useRef(0);

	useEffect(() => {
		for (const msg of messages.slice(renderedCount.current)) {
			if (msg.role !== 'command' || !Array.isArray(msg.parsed)) {
				renderedCount.current += 1;
				continue;
			}
			for (const part of msg.parsed) {
				if (part?.kind !== 'read') {
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
	}, [messages, postMessage]);
}
