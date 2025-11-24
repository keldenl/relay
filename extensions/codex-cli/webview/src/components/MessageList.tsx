/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import type { AgentMessage } from '@shared/messages';
import MessageItem from './MessageItem';

interface Props {
	messages: AgentMessage[];
}

export default function MessageList({ messages }: Props): JSX.Element {
	return (
		<>
			{messages.map((msg, idx) => {
				if (msg.role === 'system') {
					return null;
				}
				return <MessageItem key={idx} message={msg} />;
			})}
		</>
	);
}
