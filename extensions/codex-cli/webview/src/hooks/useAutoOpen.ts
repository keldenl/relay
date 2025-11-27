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
				if (!target) {
					continue;
				}
				const start = typeof part.lineStart === 'number' ? Math.max(0, part.lineStart) : 0;
				const end = typeof part.lineEnd === 'number' ? Math.max(start, part.lineEnd) : start;
				const key = `${target}:${start}-${end}`;
				if (autoOpened.current.has(key)) {
					continue;
				}
				autoOpened.current.add(key);
				postMessage({ type: 'openPath', path: target, isDir: false, selection: { start, end } });
			}
			renderedCount.current += 1;
		}
	}, [messages, postMessage]);
}
