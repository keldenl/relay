## Codex Agent Cursor Overlay – Implementation Plan

This document describes how to reimplement agent progress so it appears as a floating cursor overlay above the editor / empty-watermark area instead of as a pill in the Codex Agent view. The goal is a clean, minimally invasive design that stays scalable and easy to maintain.

---

## 1. UX & Behavioural Requirements

- Show a floating cursor icon over the editor area (or the empty “Show All Commands / Go to File …” watermark) whenever the Codex agent is running a turn.
- Cursor should:
  - Use the provided SVG cursor, scaled to a reasonable size (about 20–24px).
  - Float / bob smoothly up and down via CSS animation (not choppy).
  - Always be visible while a turn is active (from start of execution until completion/error).
  - Move near the line / region the agent is “reading” when we have file + line info.
- A small text pill should be attached to the bottom-right of the cursor, showing the latest reasoning step (what we currently show in the Agent view).
- The cursor + label must be rendered **above** the editor contents or watermark (z-indexed overlay), never underneath editor text or the empty watermark.
- When a file is focused, add a subtle animated gradient overlay across the editor area to indicate that the agent is actively working in that panel.
- When no turn is running (request finished, cancelled, or errored), hide the cursor and gradient entirely.
- The existing reasoning pill above the Agent input should be removed (or converted to a minimal status) to avoid duplicate progress surfaces.

---

## 2. High-Level Architecture

### 2.1. Overview

We will separate the concerns into three layers:

1. **Codex Agent View / Extension Host** (existing, in `extensions/codex-cli`):
   - Listens to Codex streaming events.
   - Computes a high-level “agent progress state” (latest reasoning text, what file/line is being touched).
   - Sends that state to the VS Code workbench via an internal command.

2. **Workbench Overlay Controller** (new, in core VS Code fork):
   - Lives on the main thread inside the editor workbench, not in the webview.
   - Renders the floating cursor + label + gradient as a DOM overlay above the editor group container.
   - Positions the cursor relative to the active text editor (or to a default position when there is no editor open).

3. **Command Bridge** (simple / scalable):
   - Internal commands registered in the workbench, e.g. `_codex.agentOverlay.setState` and `_codex.agentOverlay.clear`.
   - The Codex extension calls these via `vscode.commands.executeCommand(...)` so we avoid changing the public VS Code API surface.

This keeps all Codex-specific logic in the extension and keeps the overlay rendering in the minimal place where we have access to editor DOM and layout.

---

## 3. Workbench Overlay Implementation

### 3.1. New Overlay Class

**Files to add**

- `src/vs/workbench/browser/parts/editor/agentEditorOverlay.ts`
- `src/vs/workbench/browser/parts/editor/media/agentEditorOverlay.css`

**Responsibilities**

- Manage a single overlay per editor group (cursor + label + gradient).
- Attach to the editor group’s root element, above both the watermark and the editor contents.
- Keep the overlay hidden by default; show it only when the agent state is “active”.
- Provide methods:
  - `setState(state: AgentOverlayState | undefined): void`
  - `attachToEditor(editor: ICodeEditor | undefined): void`

**AgentOverlayState shape (main thread)**

```ts
interface AgentOverlayState {
  readonly label: string;                        // Latest reasoning / step description
  readonly mode: 'thinking' | 'executing' | 'reading' | 'editing';
  readonly targetUri?: URI;                      // File the agent is focusing on
  readonly targetRange?: {                      // Optional range within the file
    startLine: number;
    endLine?: number;
  };
}
```

If `state` is `undefined`, the overlay hides itself.

### 3.2. DOM Structure & Placement

In `EditorGroupView`’s constructor (in `src/vs/workbench/browser/parts/editor/editorGroupView.ts`), after the existing watermark and before/after progress bar setup, create the overlay instance:

- Instantiate `AgentEditorOverlay` with the group’s root `this.element` and `this.editorContainer`.
- `AgentEditorOverlay` should:
  - Create an absolutely positioned container:
    - `position: absolute; inset: 0; z-index: 100; pointer-events: none;`
    - Append to `this.element` (so it sits on top of both watermark and editor container).
  - Inside this container:
    - A full-size `div` for the animated gradient background.
    - A smaller `div` for the cursor + label.

**Key DOM nodes**

- `div.codex-agent-overlay` (root overlay, fills the group).
- `div.codex-agent-overlay-gradient` (full-size gradient).
- `div.codex-agent-overlay-cursor` (floating cursor wrapper).
  - Contains inline `<svg>` or `<img>` for the cursor.
  - Contains a pill `div.codex-agent-overlay-label` for the text.

### 3.3. CSS & Animation

In `agentEditorOverlay.css`:

- Root overlay:
  - `opacity: 0; transition: opacity 150ms ease-out;`
  - `pointer-events: none;` so it never blocks user interaction.
  - When active (e.g. `.codex-agent-overlay--active`), set `opacity: 1`.

- Gradient:
  - Use a semi-transparent gradient; example:
    - `background: radial-gradient(circle at top right, rgba(94, 234, 212, 0.16), transparent 60%);`
  - Add a subtle motion animation (e.g. moving background-position or pulsing opacity).
  - Keep alpha low so code is readable underneath.

- Cursor:
  - Size: CSS `width: 20px; height: auto;` (or 24px, but keep tiny compared to screenshot).
  - Apply a “bob” animation:
    - `@keyframes codex-agent-overlay-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }`
    - `animation: codex-agent-overlay-bob 1.4s ease-in-out infinite;`

- Label pill:
  - Rounded pill (`border-radius: 9999px`), dark background, light text.
  - Small font (11–12px).
  - Slight drop shadow to lift it above code.
  - Position relative to the cursor: e.g. cursor wrapper is a flex column where the label sits to the bottom-right using margins.
  - Truncate text with ellipsis to avoid huge bubbles, with a max width (e.g. 320px).

### 3.4. Positioning Relative to Editor

`AgentEditorOverlay` must position the cursor:

- When a text editor is open and we have `targetRange`:
  - Use `ICodeEditor.getScrolledVisiblePosition({ lineNumber: startLine, column: 1 })` to get the pixel `top` / `left` for the target line.
  - Convert editor-local coordinates to overlay coordinates by:
    - Getting the editor’s DOM node (`editor.getDomNode()`).
    - Computing its offset relative to the overlay container.
  - Position the cursor wrapper with `transform: translate(...)` or `top/left`.
  - Clamp Y into visible viewport and prefer placing the cursor on the right side of the editor (e.g. near the right edge, not left margin) to stay clear of line numbers.

- When a text editor is open but there is no `targetRange`:
  - Position cursor near the middle-right of the current viewport: use the editor’s visible range (`getVisibleRanges()`) and compute a middle line.

- When no editor is open (empty group / watermark only):
  - Position cursor near the primary “Show All Commands / Go to File …” area.
  - For simplicity, place it slightly above and to the right of the center of the editor group container.

**Updating position on scroll / layout**

- `AgentEditorOverlay` should subscribe to:
  - `editor.onDidScrollChange`
  - `editor.onDidLayoutChange`
  - `editor.onDidChangeConfiguration` (for font size/line height changes, if necessary)
- On any of these events, recompute the cursor position using the same logic as above.
- When focus switches to a different editor within the group, call `attachToEditor()` with the new editor so the overlay can rebind event listeners and re-position.

### 3.5. Integration with EditorGroupView

- In `EditorGroupView`:
  - Maintain a reference to the `AgentEditorOverlay` instance.
  - When the active editor changes (there are already hooks for this in `EditorGroupView` / `EditorPanes`), call `overlay.attachToEditor(activeCodeEditorOrUndefined)`.
  - Ensure overlay visibility updates when the group is hidden or disposed (dispose overlay with the group).

---

## 4. Command Bridge (Extension ↔ Workbench)

### 4.1. Internal Commands

**File to touch**

- `src/vs/workbench/browser/parts/editor/editor.contribution.ts` (or a nearby central place for editor-related commands).

**Commands to register**

1. `_codex.agentOverlay.setState`
   - Arguments: a JSON-serializable payload `AgentOverlayStateDto`:
     ```ts
     interface AgentOverlayStateDto {
       label: string;
       mode: 'thinking' | 'executing' | 'reading' | 'editing';
       targetUri?: string; // fs path or URI string
       targetRange?: { startLine: number; endLine?: number };
     }
     ```
   - Implementation:
     - Parse `targetUri` into a `URI` if provided.
     - Ask `IEditorGroupsService` for the active group.
     - Call the group’s `AgentEditorOverlay.setState(...)` with the converted state.

2. `_codex.agentOverlay.clear`
   - No arguments.
   - Implementation:
     - Clear overlay state on the active group (and optionally on all groups to be safe).

These commands are internal and intentionally not documented as public API. Only the Codex extension should call them.

### 4.2. Safety & Fallbacks

- If there is no active editor group, `_codex.agentOverlay.setState` should no-op.
- If the provided `targetUri` does not match the active editor, still show the overlay in the active group; we’re using this as a hint, not a strict requirement.
- If the payload is malformed, commands should log a warning and fail silently rather than throwing.

---

## 5. Extension-Side Integration (Codex Agent)

### 5.1. Central overlay helper in the extension

**Files to touch**

- `extensions/codex-cli/src/agentView.ts`
- (Optional) new helper: `extensions/codex-cli/src/agentOverlay.ts`

Create a small helper module to abstract command calls:

```ts
interface AgentOverlayPayload {
  label: string;
  mode: 'thinking' | 'executing' | 'reading' | 'editing';
  targetUri?: vscode.Uri;
  targetRange?: { startLine: number; endLine?: number };
}

class AgentOverlayController {
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
    if (!this.visible) return;
    this.visible = false;
    await vscode.commands.executeCommand('_codex.agentOverlay.clear');
  }
}
```

Instantiate a single `AgentOverlayController` inside `AgentViewProvider` and reuse it across prompts.

### 5.2. Tie overlay to Codex run lifecycle

In `AgentViewProvider` (`extensions/codex-cli/src/agentView.ts`):

1. **On prompt submission (`handlePrompt`)**
   - After setting `this.busy = true` and sending `setBusy` to the webview, also:
     - Derive a default status label (e.g. `'Thinking…'`).
     - Get the active text editor (if any) via `vscode.window.activeTextEditor`.
     - Call `overlay.show({ label: 'Thinking…', mode: 'thinking', targetUri: activeEditor?.document.uri })`.
   - This ensures the cursor appears as soon as the agent turn starts, even before the first reasoning item.

2. **On Codex events (`forwardCodexEvent`)**
   - Maintain a `lastOverlayLabel` string to avoid flicker if the same text is repeated.
   - For each event:
     - `item.completed` / `item.updated` with `type === 'reasoning'`:
       - Use `evt.item.text` (trimmed); if empty, fall back to `'Thinking…'`.
       - Call `overlay.show({ mode: 'thinking', label, targetUri: currentUri, targetRange: currentRange })`.
     - `item.started` / `item.updated` / `item.completed` with `type === 'command_execution'`:
       - Derive a short label from `summarizeCommand` (e.g. `'Running: git diff'`, `'Listing files…'`).
       - Use `mode: 'executing'`.
     - `item.completed` with `type === 'file_change'`:
       - Use the enriched file info already computed in `forwardCodexEvent`:
         - `absPath` → `vscode.Uri.file(...)` for `targetUri`.
         - `line` → `targetRange.startLine`.
       - Label example: `'Updating foo.ts'`.
       - Use `mode: 'editing'`.
       - This is where we should move the cursor to the line being edited.

3. **On file open with highlight (`openFileWithHighlight`)**
   - After calling `showTextDocument` and applying `readDecoration`/`readLabelDecoration`, also update the overlay:
     - Use the same `selection.start` line as `targetRange.startLine`.
     - Mode: `'reading'`.
     - Label example: `'Reading foo.ts'` or reuse the latest reasoning text if available.

4. **On turn completion / error**
   - `CodexEvent` stream includes `turn.completed` (visible in `simulateStream`).
     - When you see `evt.type === 'turn.completed'`, call `overlay.clear()`.
   - Additionally, in the `finally` block of `handlePrompt` (where `this.busy` is set back to `false`), call `overlay.clear()` as a fallback.
   - On `handleRunError`, after posting error messages, ensure `overlay.clear()` is called.

This guarantees the cursor is **always visible** during a turn and disappears promptly once the turn ends, even if the server fails to send a final event.

### 5.3. Removing the AgentView reasoning pill

In `extensions/codex-cli/webview/src/components/AgentShell.tsx`:

- Currently, the reasoning pill is rendered as a `div` with the spinner and `{reasoning || 'Thinking…'}` above the input.
- We want to keep the *data* (`reasoning`/`busy`) but drop the visible pill to avoid duplication with the new cursor overlay.

Implementation steps:

- Remove or comment out the reasoning pill `div`:
  - Option A (hard removal): delete the block and rely solely on the overlay.
  - Option B (minimal status, more conservative): turn it into a tiny inline “Agent is running…” label somewhere in the shell footer, without detailed text.
- Make sure `showReasoning` is still computed and kept for future uses if needed, but no longer controls that pill.

Result: progress is now visually represented only in the overlay, while the Agent view remains focused on conversation history and input.

---

## 6. Cursor & Gradient Behaviour Details

### 6.1. Cursor Size & Visibility

- Use the provided SVG cursor as an inline SVG or as a data URI.
- In CSS, constrain it to a small size:
  - `max-width: 24px;` (or 20px) and `height: auto`.
- The overlay controller should always show some cursor while `busy === true` for the active agent run; do not hide it between events.

### 6.2. Label Text Rules

- Trim whitespace and strip outer markdown markers (e.g. leading `**` / trailing `**`) in a small helper so the label looks like plain text.
- Limit to a reasonable maximum length (e.g. 120 characters) and add ellipsis.
- For early phases when no reasoning text exists yet:
  - Use `'Thinking…'` as a default label.
- For command execution events:
  - Show high-level summary like `Running: npm test` or `Listing files…`.
- For file events:
  - Show `Reading {basename(path)}` or `Editing {basename(path)}`.

### 6.3. Gradient Intensity

- Keep gradient subtle so it doesn’t overpower the code:
  - Alpha ~0.08–0.16 is a good starting point.
  - Prefer theme-aware colors:
    - Introduce a new theme color key like `codexAgentOverlay.background` and use that in the CSS.
    - Provide sensible defaults for dark/light themes.
- Animate slowly (2–4 seconds per cycle) to avoid distraction.

---

## 7. Lifecycle & Edge Cases

### 7.1. Multiple Editor Groups

- The initial implementation can scope the overlay to the **active group only**:
  - `_codex.agentOverlay.setState` always targets `IEditorGroupsService.activeGroup`.
  - If focus switches to a different group while an agent run is active, the overlay will move with it (because the active group changes).
- Optional enhancement (later): track a specific group ID per agent run and keep the overlay pinned to that group.

### 7.2. Switching Files While Agent Runs

- If the active text editor changes within the group while the agent is running:
  - `AgentEditorOverlay.attachToEditor` is called with the new editor.
  - The overlay repositions the cursor based on the same `targetRange` but in the new editor.
  - If the new editor doesn’t match the `targetUri`, either:
    - Keep showing the cursor in the middle-right of the new editor as a generic “agent is working” indicator, or
    - Hide the cursor until the agent touches a file in the new editor (configurable design choice; start with the generic indicator for simplicity).

### 7.3. No Workspace / No Editor

- When the user has no workspace folder or no editor open:
  - The overlay still appears over the watermark area in the active editor group.
  - Cursor uses the center-ish position described earlier.

### 7.4. Errors & Cancellations

- In any error path in `AgentViewProvider.handlePrompt` or `forwardCodexEvent`:
  - Ensure `overlay.clear()` is called so the cursor never gets “stuck”.
- For user-initiated cancellation (if we add it later):
  - Wire the cancellation code path to also clear the overlay.

---

## 8. Testing & Validation Checklist

When implementing, validate the following scenarios manually:

- **Happy path**:
  - Run a simple agent task with no file open on the right.
    - Cursor appears over the watermark, animating up and down.
    - Label shows “Thinking…” and then updates to the latest reasoning steps.
  - When the turn completes, cursor and gradient disappear.

- **File reading path**:
  - Run a task that causes the agent to open and read a file.
    - Overlay appears over the editor with the gradient.
    - Cursor moves near the highlighted line when `openFileWithHighlight` is called.

- **File editing path**:
  - Run a task that edits a file.
    - On `file_change` events, cursor moves to the changed line and label text reflects the edited file.

- **Multiple events**:
  - Ensure label updates smoothly as reasoning/command/file events stream.
  - Cursor does not flicker or disappear between events.

- **Edge cases**:
  - Start a run, then quickly switch editor tabs or split editor groups.
  - Start a run, then trigger an error (e.g. Codex CLI missing).
  - Cancel / stop a run (if supported) and confirm overlay hides.

---

## 9. Implementation Order (for a Junior Engineer)

1. **Core overlay skeleton**
   - Implement `AgentEditorOverlay` with static positioning and a dummy cursor + label.
   - Hard-code a test label and enable it via a temporary debug flag.

2. **Hook into EditorGroupView**
   - Instantiate overlay per group.
   - Make sure it sits above both watermark and editor contents.

3. **Cursor positioning**
   - Add `attachToEditor` and use `getScrolledVisiblePosition` to place the cursor on a fixed line.
   - Wire up scroll/layout listeners.

4. **Gradient styling & animation**
   - Add gradient background and subtle animation.
   - Introduce a theme color key if needed.

5. **Command bridge**
   - Register `_codex.agentOverlay.setState` and `_codex.agentOverlay.clear`.
   - Call these commands from a temporary test command to confirm they work.

6. **Extension integration**
   - Add `AgentOverlayController` in the Codex extension.
   - Call it from `handlePrompt`, `forwardCodexEvent`, and `openFileWithHighlight`.

7. **Remove Agent view pill**
   - Delete or minimize the reasoning pill in `AgentShell.tsx`.
   - Verify the Agent view still works without visual regressions.

8. **Polish & QA**
   - Tweak cursor size, gradient strength, and animation timing to feel smooth and non-intrusive.
   - Manually test the scenarios in Section 8.

Once these steps are complete, the Codex agent progress will be driven entirely by a floating cursor overlay above the editor/watermark area, with no progress text in the Agent view itself.

