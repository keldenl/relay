## Overview

- Introduce an explicit model switcher in the Codex Agent top bar so users can quickly swap between the two primary models, `gpt-5.1-codex-max` (coding-focused) and `gpt-5.1` (general reasoning and planning), without leaving the Relay UI.
- Replace the current top-left “reasoning effort” dropdown with a model-first control that still exposes the existing Low/Standard/High/xHigh reasoning effort options via a secondary sub-menu.
- Ensure the selected model and effort are clearly visible, persisted per workspace, and correctly wired through the Codex CLI extension to the `@openai/codex-sdk` `ThreadOptions` so runs actually use the chosen model and effort.

## Requirements

- The Codex Agent top bar MUST show the currently selected model prominently (for example, “GPT 5.1 Codex Max” or “GPT 5.1”) instead of showing only the reasoning effort label.
- The model switcher MUST offer at least two options: `gpt-5.1-codex-max` (described in the UI as best for coding / editing code) and `gpt-5.1` (described as best for general use, planning, and non-code tasks).
- The existing reasoning effort options (`low`, `medium`, `high`, `xhigh`) MUST remain available and MUST retain their current semantic meaning, but they MUST be presented as a secondary selection associated with a chosen model, not as the primary dropdown list.
- When the user opens the model dropdown, the primary list MUST show models, not effort levels. When the user hovers or keyboard-focuses a model row, a sub-menu to the right MUST offer the available effort levels for that model.
- Selecting an item in the sub-menu (model + effort pair) MUST update both the selected model and the selected reasoning effort in a single interaction and MUST close the dropdown(s).
- Clicking a model row itself (without using the sub-menu) MAY select the model while leaving the current effort unchanged; if so, the UI MUST make it clear which effort remains active (for example, via the label text).
- The top-bar label MUST reflect both the selected model and effort in a concise way (for example, “GPT 5.1 Codex Max • Standard” and “GPT 5.1 • High”), so users can see at a glance what configuration is active.
- The selected model and reasoning effort MUST be persisted per workspace using VS Code’s `ExtensionContext.globalState`, and MUST be restored when Relay reloads or the workspace is reopened.
- If no model preference is stored, the Agent view MUST default to `gpt-5.1-codex-max` and the existing default reasoning effort (`medium`), matching the current behavior as closely as possible.
- Changing the model or effort while a session is active MUST affect all subsequent runs in that session (and future sessions in that workspace) but MUST NOT retroactively change how past responses are interpreted or displayed.
- The CodexClient integration MUST ensure that the selected model and reasoning effort are passed through to `@openai/codex-sdk` so that the backend actually uses the chosen configuration; silently ignoring the model choice MUST NOT happen.
- If the selected model is not available (for example, due to environment, auth, or version issues), the extension SHOULD surface a clear, non-technical error in the Agent view and SHOULD fall back to a safe default model (`gpt-5.1-codex-max`) rather than failing silently.
- Keyboard users MUST be able to operate the model and effort menus (for example, via Tab/Shift+Tab and arrow keys) without relying on hover, and focus handling MUST not trap the keyboard inside the dropdown.

## Design

- Model and effort configuration
  - Define a `CodexModelId` union type (for example, `'gpt-5.1-codex-max' | 'gpt-5.1'`) in `extensions/codex-cli/src/shared/messages.ts`, and use it consistently for host/webview messages and internal state.
  - Introduce a new global state key (for example, `codex.model`) managed by `AgentViewProvider` to persist the selected `CodexModelId` per workspace; default to `'gpt-5.1-codex-max'` when no preference exists.
  - Extend `AgentViewProvider` to hold a `selectedModel: CodexModelId` field, initialize it from `globalState`, and expose a helper similar to `getStoredReasoningEffort` / `postReasoningState` for reading, updating, persisting, and broadcasting model changes.
  - Extend `CodexClient.runExec` options to accept an optional `model?: CodexModelId` and thread that through to `getOrCreateThread` so each execution is aware of both the model and reasoning effort chosen in the UI.
  - Update `CodexClient.getOrCreateThread` to include `model?: string` alongside `reasoningEffort?: ModelReasoningEffort` in `ThreadRecord`, and only reuse an existing `Thread` when both the stored `model` and `modelReasoningEffort` match the requested values; otherwise start a new thread with the requested configuration.
  - Pass the selected model into the `@openai/codex-sdk` `ThreadOptions` via its `model` field alongside `modelReasoningEffort`, ensuring that every new or resumed thread is configured with the correct model string (e.g., `"gpt-5.1-codex-max"` or `"gpt-5.1"`).

- Host/webview messaging and state
  - Extend `HostToWebviewMessage` in `extensions/codex-cli/src/shared/messages.ts` with a new message variant such as `{ type: 'modelState'; model: CodexModelId }` to deliver the current model to the webview on load and when it changes.
  - Extend `WebviewToHostMessage` with a new variant (for example, `{ type: 'setModel'; model: CodexModelId }`) and update `isWebviewToHostMessage` to validate the model values similarly to how reasoning effort is validated today.
  - In `AgentViewProvider.resolveWebviewView`, send the initial `modelState` message alongside existing `reasoningState` when handling `requestStatus` and on first webview load, so the webview always has both pieces of configuration.
  - In the webview’s `useHostMessaging` hook, add `model: CodexModelId` to the reducer state, handle the new `modelState` host message, and introduce a `setModel` action that updates local state and posts a `setModel` message back to the host.
  - Ensure that when the user changes model or effort from the webview, the host persists both values in `globalState` and updates any in-memory defaults used for new sessions or threads.

- Top bar UI and nested menu behavior
  - Update `AgentShell` and `TopBar` props so `TopBar` receives both `model: CodexModelId` and `effort: ReasoningEffortOption`, plus corresponding change handlers like `onModelChange` and `onEffortChange` (or a combined `(model, effort)` change handler).
  - Replace the current effort-only dropdown in `TopBar` with a model-first control: the button label should be derived from the selected `CodexModelId` and `ReasoningEffortOption` using small metadata maps (for example, `MODEL_META` and the existing `OPTION_META`).
  - Implement the primary dropdown panel as a list of models (e.g., “GPT 5.1 Codex Max” and “GPT 5.1”), each row showing a brief description (coding vs planning) and a visual indicator of which model is active.
  - For each model row, implement a nested sub-menu that appears to the right on hover or keyboard focus, rendering the four effort options with the same titles and descriptions used today; clicking an item in the sub-menu commits both the model and effort.
  - Ensure the nested sub-menu stays anchored to the corresponding model row, respects the webview theme variables (e.g., `--vscode-editorWidget-background`, `--vscode-list-hoverBackground`), and visually matches existing dropdown styling (rounded corners, shadows, active/hover states).
  - Maintain sensible focus and dismissal behavior: clicking outside either menu closes both, pressing Escape closes the open menu(s), and keyboard navigation can move between model rows and effort options without visual glitches.

- Session and UX considerations
- Keep effort selection global per workspace for now. Model selection SHOULD be persisted per session once a user changes it in that session, while new sessions SHOULD inherit the current global default model at creation time.  
- When the user starts a “New chat” session, the session SHOULD inherit the current model and effort configuration; changing model later SHOULD be remembered for that session when returning to it, while leaving the stored session transcript unchanged. Effort changes remain global.  
  - Optionally, the session summary metadata MAY later be extended to record which model/effort was active when each session was last updated, but this spec does not require exposing that in the UI.
  - If changing the model would require a new Codex thread for correctness, the extension MAY start a fresh thread under the hood while keeping the user-visible session ID and transcript stable; any such behavior SHOULD avoid user-visible surprises or errors.
