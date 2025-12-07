/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export type AgentOverlayMode = 'thinking' | 'executing' | 'reading' | 'editing';

export interface AgentOverlayPayload {
	label: string;
	mode: AgentOverlayMode;
	targetUri?: vscode.Uri;
	targetRange?: { startLine: number; endLine?: number };
}

/**
 * Lightweight helper that bridges the extension host to the workbench overlay.
 */
export class AgentOverlayController {
	private visible = false;

	async show(payload: AgentOverlayPayload): Promise<void> {
		this.visible = true;
		await vscode.commands.executeCommand('_codex.agentOverlay.setState', {
			label: payload.label,
			mode: payload.mode,
			targetUri: payload.targetUri?.toString(),
			targetRange: payload.targetRange,
		});
	}

	async clear(): Promise<void> {
		if (!this.visible) {
			return;
		}
		this.visible = false;
		await vscode.commands.executeCommand('_codex.agentOverlay.clear');
	}
}
