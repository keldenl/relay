## Overview

- Restore and improve Codex chat session visibility in Relay so users can clearly see the current conversation history, switch between past sessions, and start fresh chats, even after reloading the window or reopening a workspace.
- Layer an explicit “session” concept on top of the existing `@openai/codex-sdk` `Thread` integration in `CodexClient`, so each visible chat session maps to a Codex thread and can be resumed reliably per workspace.
- Provide a lightweight, discoverable session UI in the Codex webview (built in React) that fits Relay’s non-coder audience: a simple session picker and “New chat” affordances, without exposing low-level implementation details.

## Requirements

- The Codex Agent view MUST display the full message history for the active chat session (user prompts and assistant replies) within the webview, not just messages from the current VS Code window lifetime.
- When Relay is restarted or a workspace is reopened, the Agent view MUST restore the last active chat session for that workspace and MUST render its recent message history so it is obvious the user is continuing an existing conversation.
- Users MUST be able to start a new chat session from the webview via a clear “New chat” control (button and/or menu item) that does not require knowing or invoking VS Code commands manually.
- Users MUST be able to see a list of recent chat sessions for the current workspace and MUST be able to switch between them from within the webview; the currently active session SHOULD be visually distinguished from others.
- Each chat session MUST correspond to a Codex SDK `Thread` under the hood; starting a new chat MUST create a new thread, and switching sessions MUST route subsequent prompts to the thread backing that session.
- The extension MUST persist session metadata in `ExtensionContext.globalState` (or workspace-scoped storage) per workspace, including at minimum a stable session ID, associated thread ID, created/updated timestamps, and a human-readable title.
- The webview state for the active session’s message history MUST be persisted and restored from storage so that previous messages remain visible after reload; it SHOULD be pruned to a reasonable limit (for example, most recent N messages) to avoid unbounded growth.
- The design MUST migrate existing per-workspace thread state (stored under `codex.threadId:<workspaceKey>`) into the new session model on first run so that users’ current ongoing session is preserved and appears as a named session in the UI.
- The session UI SHOULD provide a sensible default title for each new session (for example, using the first user prompt or a timestamp) and MAY allow the user to rename sessions later via a simple inline edit or quick input.
- When starting a new chat session, the Agent view MUST show an empty message area for that session; it MUST NOT silently reuse the previous session’s visible messages, even if Codex internally reuses cached context.
- When switching sessions, the Agent view MUST swap the visible message list to the selected session and MUST update any “current session” indicator; it SHOULD smoothly scroll to the end of the restored transcript.
- If session history fails to load (for example, due to corrupted stored data), the extension SHOULD fall back to creating a fresh session while surfacing a concise, non-technical error message in the Agent view instead of breaking the UI.
- Session behaviors and controls SHOULD align conceptually with upstream VS Code chat patterns where practical (e.g., “New chat” semantics, recent history on empty state), while remaining visually lightweight and tailored to the Codex panel.

## Design

- Session model and storage
  - Introduce a `CodexSession` model owned by the Codex CLI extension host, with fields such as `{ id, threadId, workspaceKey, title, createdAt, updatedAt, lastPromptSummary, messagesSnapshot? }`.
  - Store a per-workspace collection of sessions in `ExtensionContext.globalState` keyed by a prefix like `codex.sessions:<workspaceKey>`, plus a `codex.sessions:lastActive:<workspaceKey>` key that records the last active session ID.
  - Represent the persisted message history for each session as a compact array of simplified `AgentMessage`-like objects (role, text, minimal metadata) sufficient for reconstructing the chat UI; omit heavy payloads like full diff text when necessary to keep storage small.
  - On first startup after this feature ships, if a legacy `codex.threadId:<workspaceKey>` value exists but no sessions are stored, create a single default `CodexSession` that links to that thread ID and starts with an empty or partial message snapshot so users can continue from their existing underlying session.
- Thread and session coordination
  - Extend `CodexClient` with session-aware helpers (for example, `runExecInSession(sessionId, cwd, onEvent, options)`) that map a given session ID and workspace key to a `Thread`, starting a new thread when the session is first used.
  - Maintain an internal map from `(workspaceKey, sessionId)` to active `Thread` instances; when a session already has a stored `threadId`, call `codex.resumeThread(threadId, threadOptions)`, otherwise call `codex.startThread(threadOptions)` and persist the resulting thread ID once a `thread.started` event is observed.
  - Ensure that creating a “New chat” session always results in a distinct Codex thread, so prompts in that session do not affect or reuse prior session context, matching user expectations for a fresh conversation.
  - Keep the existing reasoning-effort wiring (low/medium/high/xhigh) but apply it per session thread at creation time; changing reasoning effort SHOULD affect subsequent runs for the active session’s thread.
- Webview protocol and state
  - Extend the `HostToWebviewMessage` / `WebviewToHostMessage` contracts in `extensions/codex-cli/src/shared/messages.ts` to cover session-related operations: for example, `sessionList`, `switchSession`, `newSession`, and optionally `renameSession`.
  - Add a new initial handshake from the extension host to the webview (triggered on `requestStatus` or on first load) that sends `{ type: 'sessionList', activeSessionId, sessions: [...] }` and, for the active session, a `messagesSnapshot` array to pre-populate the webview’s `messages` state.
  - Update `useHostMessaging` in the webview to store the active `sessionId`, list of sessions, and restored messages in its React reducer; ensure that incoming `appendMessage` events are associated with the active session and mirrored back into persistent storage via a `saveSessionSnapshot` host message when appropriate.
  - When the user starts a new chat or switches sessions, the webview SHOULD emit a typed message (for example, `{ type: 'switchSession', sessionId }` or `{ type: 'newSession', title? }`), then replace its `messages` state with the host-provided snapshot for the selected session.
- Session UI in the webview
  - Introduce a simple session control in the existing top bar of `AgentShell` (for example, next to the reasoning-effort dropdown) that shows the current session title and opens a small menu listing recent sessions plus a “New chat” action.
  - In the session menu, render each session with its title and a relative timestamp (e.g., “5 min ago”), visually indicating the active one; keep the list to a reasonable number of recent sessions and optionally group older sessions under a “More…” item.
  - Provide a clear “New chat” action in the session control (for example, a dedicated button or primary item in the menu) that creates a new session, clears the messages area, and focuses the prompt input.
  - Optionally, allow renaming a session by invoking a VS Code quick input (or simple inline rename affordance) when the user chooses a “Rename” option from the session menu; the host updates the stored session metadata and pushes an updated `sessionList` message back to the webview.
- Persistence and limits
  - Implement pruning rules on the host side so that each session only keeps a bounded number of messages in its snapshot (for example, the last 50–100 messages), dropping older entries from persisted storage while allowing the underlying Codex thread to retain full context.
  - Limit the number of stored sessions per workspace (for example, keep the most recent 20 sessions), deleting the oldest ones when the limit is exceeded, and updating the webview session list accordingly.
  - When storage or deserialization fails (e.g., JSON parse error or unexpected schema), log detailed diagnostics to the Codex output channel while surfacing only a concise notice in the UI and falling back to a fresh, empty session.

