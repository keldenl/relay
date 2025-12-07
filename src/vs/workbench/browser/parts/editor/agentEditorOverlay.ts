/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/agentEditorOverlay.css';
import { clamp } from '../../../../base/common/numbers.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor, IDiffEditor, isDiffEditor, isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { URI } from '../../../../base/common/uri.js';

export interface AgentOverlayState {
	label: string;
	mode: 'thinking' | 'executing' | 'reading' | 'editing';
	targetUri?: URI;
	targetRange?: {
		startLine: number;
		endLine?: number;
	};
}

export class AgentEditorOverlay extends Disposable {

	private readonly container: HTMLElement;
	private readonly gradient: HTMLElement;
	private readonly cursorWrapper: HTMLElement;
	private readonly cursorBody: HTMLElement;
	private readonly label: HTMLElement;
	private readonly labelText: HTMLElement;
	private readonly svgPointer: HTMLElement;
	private readonly svgEye: HTMLElement;
	private readonly svgLoader: HTMLElement;
	private readonly svgEdit: HTMLElement;
	private readonly workbenchRoot: HTMLElement;

	private readonly editorListeners = this._register(new MutableDisposable<DisposableStore>());
	private activeCodeEditor: ICodeEditor | undefined;
	private state: AgentOverlayState | undefined;

	constructor(private readonly host: HTMLElement) {
		super();

		this.host.classList.add('codex-agent-overlay-host');

		this.container = document.createElement('div');
		this.container.className = 'codex-agent-overlay';
		this.container.setAttribute('aria-hidden', 'true');

		this.gradient = document.createElement('div');
		this.gradient.className = 'codex-agent-overlay-gradient';
		this.container.appendChild(this.gradient);

		this.cursorWrapper = document.createElement('div');
		this.cursorWrapper.className = 'codex-agent-overlay-cursor';
		this.container.appendChild(this.cursorWrapper);

		this.cursorBody = document.createElement('div');
		this.cursorBody.className = 'codex-agent-overlay-cursor-body';
		this.cursorWrapper.appendChild(this.cursorBody);

		this.svgPointer = this.createIcon({
			className: 'codex-agent-overlay-cursor-icon',
			viewBox: '0 0 24 24',
			paths: [
				{ tag: 'path', attrs: { d: 'M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z' } },
			],
		});
		this.cursorBody.appendChild(this.svgPointer);

		this.svgEye = this.createIcon({
			className: 'codex-agent-overlay-cursor-icon codex-agent-overlay-eye-icon',
			viewBox: '0 0 24 24',
			paths: [
				{ tag: 'path', attrs: { d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0' } },
				{ tag: 'circle', attrs: { cx: '12', cy: '12', r: '3' } },
			],
		});
		this.cursorBody.appendChild(this.svgEye);

		this.svgLoader = this.createIcon({
			className: 'codex-agent-overlay-cursor-icon codex-agent-overlay-loader-icon',
			viewBox: '0 0 24 24',
			svgAttrs: { fill: 'none' },
			paths: [
				{ tag: 'path', attrs: { d: 'M22 12a1 1 0 0 1-10 0 1 1 0 0 0-10 0' } },
				{ tag: 'path', attrs: { d: 'M7 20.7a1 1 0 1 1 5-8.7 1 1 0 1 0 5-8.6' } },
				{ tag: 'path', attrs: { d: 'M7 3.3a1 1 0 1 1 5 8.6 1 1 0 1 0 5 8.6' } },
				{ tag: 'circle', attrs: { cx: '12', cy: '12', r: '10' } },
			],
		});
		this.cursorBody.appendChild(this.svgLoader);

		this.svgEdit = this.createIcon({
			className: 'codex-agent-overlay-cursor-icon codex-agent-overlay-edit-icon',
			viewBox: '0 0 24 24',
			paths: [
				{ tag: 'path', attrs: { d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z' } },
				{ tag: 'path', attrs: { d: 'm15 5 4 4' } },
			],
		});
		this.cursorBody.appendChild(this.svgEdit);

		this.label = document.createElement('div');
		this.label.className = 'codex-agent-overlay-label';
		this.labelText = document.createElement('span');
		this.labelText.className = 'codex-agent-overlay-label-text';
		this.label.appendChild(this.labelText);
		this.cursorBody.appendChild(this.label);


		const root = host.closest('.monaco-workbench') ?? host.ownerDocument.body;
		this.workbenchRoot = root as HTMLElement;
		this.workbenchRoot.appendChild(this.container);
	}

	setState(state: AgentOverlayState | undefined): void {
		this.state = state;
		if (!state) {
			this.container.classList.remove('codex-agent-overlay--active');
			this.label.textContent = '';
			this.setIconMode('pointer');
			return;
		}

		this.labelText.textContent = state.label.trim();
		this.labelText.style.setProperty('--shimmer-base', '#9ca3af');
		this.labelText.style.setProperty('--shimmer-highlight', '#ffffff');
		this.labelText.style.setProperty('--shimmer-width', '300%');
		this.labelText.style.setProperty('--shimmer-duration', '3s');
		this.container.classList.add('codex-agent-overlay--active');
		this.setIconMode(
			state.mode === 'thinking' ? 'loader' :
				state.mode === 'reading' ? 'eye' :
					state.mode === 'editing' ? 'edit' :
						'pointer'
		);
		this.updatePosition();
	}

	attachToEditor(editor: ICodeEditor | IDiffEditor | undefined): void {
		this.activeCodeEditor = this.getUsableEditor(editor);
		this.editorListeners.value = undefined;

		if (!this.activeCodeEditor) {
			this.updatePosition();
			return;
		}

		const store = new DisposableStore();
		store.add(this.activeCodeEditor.onDidScrollChange(() => this.updatePosition()));
		store.add(this.activeCodeEditor.onDidLayoutChange(() => this.updatePosition()));
		store.add(this.activeCodeEditor.onDidChangeConfiguration(() => this.updatePosition()));
		this.editorListeners.value = store;

		this.updatePosition();
	}

	private updatePosition(): void {
		if (!this.state) {
			return;
		}

		const hostRect = this.host.getBoundingClientRect();
		const fallbackWidth = Math.max(0, hostRect.width);
		const fallbackHeight = Math.max(0, hostRect.height);

		this.container.style.left = `${Math.round(hostRect.left)}px`;
		this.container.style.top = `${Math.round(hostRect.top)}px`;
		this.container.style.width = `${Math.round(fallbackWidth)}px`;
		this.container.style.height = `${Math.round(fallbackHeight)}px`;
		let top = fallbackHeight / 2;
		let left = fallbackWidth / 2;

		const editor = this.activeCodeEditor;
		if (editor) {
			const editorNode = editor.getDomNode();
			const layout = editor.getLayoutInfo();

			if (editorNode && layout) {
				const editorRect = editorNode.getBoundingClientRect();
				const offsetTop = editorRect.top - hostRect.top;
				const offsetLeft = editorRect.left - hostRect.left;

				const anchorLine = this.getAnchorLine(editor);
				const pos = anchorLine
					? editor.getScrolledVisiblePosition({ lineNumber: anchorLine, column: 1 })
					: undefined;

				// If visible, use scrolled position; otherwise compute from scrollTop + lineTop.
				const lineTop = anchorLine
					? editor.getTopForLineNumber(anchorLine, true) - editor.getScrollTop()
					: undefined;
				const lineHeight = (layout as { lineHeight?: number }).lineHeight ?? 20;

				const cursorY = pos
					? offsetTop + pos.top + pos.height * 0.5
					: lineTop !== undefined
						? offsetTop + lineTop + lineHeight * 0.5
						: offsetTop + layout.height * 0.5;

				// Prefer center; when reading, skew slightly left to avoid clipping on the right.
				const cursorX = offsetLeft + layout.contentLeft + (
					this.state?.mode === 'reading'
						? layout.contentWidth * 0.8
						: layout.contentWidth * 0.6
				);

				top = clamp(cursorY, 0, hostRect.height);
				left = clamp(cursorX, 0, hostRect.width);
			}
		}

		this.cursorWrapper.style.setProperty('--overlay-x', `${Math.round(left)}px`);
		this.cursorWrapper.style.setProperty('--overlay-y', `${Math.round(top)}px`);
	}

	private getUsableEditor(editor: ICodeEditor | IDiffEditor | undefined): ICodeEditor | undefined {
		if (!editor) {
			return undefined;
		}

		if (isCodeEditor(editor)) {
			return editor;
		}

		if (isDiffEditor(editor)) {
			return editor.getModifiedEditor();
		}

		return undefined;
	}

	private getAnchorLine(editor: ICodeEditor): number | undefined {
		const range = this.state?.targetRange;
		if (range?.startLine && range.startLine > 0) {
			return range.startLine;
		}

		const visible = editor.getVisibleRanges();
		if (!visible || visible.length === 0) {
			return undefined;
		}

		const first = visible[0];
		return Math.floor((first.startLineNumber + first.endLineNumber) / 2);
	}

	private setIconMode(mode: 'pointer' | 'eye' | 'loader' | 'edit'): void {
		this.svgPointer.style.display = mode === 'pointer' ? 'block' : 'none';
		this.svgEye.style.display = mode === 'eye' ? 'block' : 'none';
		this.svgLoader.style.display = mode === 'loader' ? 'block' : 'none';
		this.svgEdit.style.display = mode === 'edit' ? 'block' : 'none';
	}

	private createIcon(def: { className: string; viewBox: string; svgAttrs?: Record<string, string>; paths: Array<{ tag: 'path' | 'circle'; attrs: Record<string, string> }> }): HTMLElement {
		const wrapper = document.createElement('div');
		wrapper.className = def.className;
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('width', '20');
		svg.setAttribute('height', '20');
		svg.setAttribute('viewBox', def.viewBox);
		svg.setAttribute('fill', '#000');
		svg.setAttribute('stroke', '#fff');
		svg.setAttribute('stroke-width', '2');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');
		if (def.svgAttrs) {
			for (const [k, v] of Object.entries(def.svgAttrs)) {
				svg.setAttribute(k, v);
			}
		}
		for (const p of def.paths) {
			const el = document.createElementNS('http://www.w3.org/2000/svg', p.tag);
			for (const [k, v] of Object.entries(p.attrs)) {
				el.setAttribute(k, v);
			}
			svg.appendChild(el);
		}
		wrapper.appendChild(svg);
		return wrapper;
	}

	override dispose(): void {
		this.container.remove();
		super.dispose();
	}
}
