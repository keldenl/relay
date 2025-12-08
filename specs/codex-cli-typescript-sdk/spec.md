## Overview

- Replace the ad-hoc `codex exec` child-process integration in `extensions/codex-cli/src/codexClient.ts` with the official `@openai/codex-sdk` TypeScript library, so the extension talks to Codex through the SDK’s `Codex` / `Thread` abstractions instead of manually spawning the CLI.
- Keep the existing Agent view and overlay wiring (`AgentViewProvider`, webview shell, and `AgentOverlayController`) but feed them strongly-typed SDK `ThreadEvent` objects, preserving the current event schema (`thread.started`, `item.completed`, `turn.completed`, etc.).
- Introduce a small session layer in the extension host that owns Codex threads per workspace folder, enabling reliable multi-turn conversations and future session-history features while hiding SDK details from the UI.
- Simplify binary and environment handling by relying on the SDK’s built-in CLI discovery and JSON parsing, and by centralizing sandbox / working-directory / reasoning-effort configuration in one place.

## Requirements

- The Codex CLI extension MUST use `@openai/codex-sdk` for all agent execution (`exec`) calls; it MUST NOT spawn the `codex` binary directly for runs or stream parsing in `codexClient.ts`.
- The `CodexEvent` surface consumed by `AgentViewProvider.forwardCodexEvent` MUST remain compatible with the SDK’s `ThreadEvent` type so the existing UI logic and webview protocol can be reused with minimal changes.
- `CodexClient.runExec(prompt, cwd, onEvent, options)` MUST execute via a long-lived SDK `Thread` whose events are streamed with `thread.runStreamed`, and it MUST forward each `ThreadEvent` to the provided callback in order, without buffering until completion.
- For each VS Code workspace folder, the client MUST reuse a single Codex `Thread` across prompts (multi-turn) instead of starting a brand-new one every time; threads SHOULD be keyed by workspace folder path.
- Thread IDs returned via `thread.started` MUST be tracked, and the client SHOULD persist them in `ExtensionContext.globalState` per workspace so sessions can be resumed with `codex.resumeThread(id)` after reload when safe to do so.
- Each thread MUST be configured with `sandboxMode: "workspace-write"` and `workingDirectory` set to the active workspace root (matching the current `--sandbox workspace-write --cd <cwd>` behavior); when no workspace is open, the agent MUST refuse to run and SHOULD log a clear message in the shell.
- The reasoning effort chosen in the UI (`ReasoningEffortOption` of `low`, `medium`, `high`, `xhigh`) MUST influence the SDK’s `modelReasoningEffort` option; `low`, `medium`, and `high` MUST map directly, and `xhigh` MAY temporarily map to `high` until the SDK surface supports an explicit `"xhigh"` level.
- Authentication status exposed to the webview (`AuthStatus`) MUST accurately reflect whether the Codex CLI can execute requests (e.g., based on `codex login status`); login and login-status helpers MAY continue to shell out to `codex login` / `codex login status` but SHOULD be separated from the execution client to keep responsibilities clear.
- Error messages surfaced to users MUST be updated away from “bundled Codex CLI binary not found” to SDK-appropriate messages (for example, unsupported platform, missing login, or CLI execution failure) and SHOULD include concise remediation hints.
- The new client MUST handle stream termination and errors robustly: it MUST clear the agent overlay and busy state on normal completion, on stream errors, and on cancellations, and SHOULD avoid leaving orphaned child processes or dangling listeners.
- The design SHOULD allow unit testing of session and error handling by injecting a lightweight abstraction over the SDK (e.g., an interface for `Codex` / `Thread`) so tests can run without invoking real Codex runs.

## Design

- Codex SDK integration
  - Create a singleton `Codex` instance inside `CodexClient` (or a dedicated `CodexService`) constructed from `@openai/codex-sdk`, using default CLI discovery rather than `getBundledCodexPath`, unless an explicit override is required for development.
  - Import and re-export the SDK’s `ThreadEvent` type as `CodexEvent` so the rest of the extension code can depend on the SDK’s event schema while preserving the existing name.
  - Map the current `ReasoningEffortOption` values to `ThreadOptions.modelReasoningEffort` when creating or reconfiguring threads: `low → "low"`, `medium → "medium"`, `high → "high"`, `xhigh → "high"` (or a future `"xhigh"` when available).
- Session management
  - Have `CodexClient` maintain an in-memory map from workspace folder path to a `Thread` instance; `runExec` looks up (or lazily creates) the `Thread` for the given `cwd`.
  - When no prior thread exists for a workspace, call `codex.startThread({ workingDirectory: cwd, sandboxMode: "workspace-write", modelReasoningEffort, skipGitRepoCheck: true })` to avoid hard failures in non-Git folders while still sandboxing writes to the workspace.
  - After the first `thread.started` event, capture `thread.id` and store it in both the in-memory `Thread` wrapper and in `ExtensionContext.globalState` keyed by workspace; on extension activation, attempt to resume previously saved threads with `codex.resumeThread(id, { workingDirectory, sandboxMode: "workspace-write" })` where appropriate.
  - Keep the session layer internal to `codexClient.ts`, exposing only `runExec` (and possibly future `resetSession` / `getSessionInfo` helpers) so `AgentViewProvider` and `extension.ts` do not need to understand `Thread` or session IDs directly.
- Streaming and cancellation
  - Implement `runExec` in terms of `thread.runStreamed(prompt, { signal })`, where `signal` comes from an `AbortController` owned by `CodexClient` for the current turn; expose a cancellation hook so a future “Cancel run” command can abort the in-flight request.
  - For each call to `runExec`, iterate `for await (const event of events)` and invoke `onEvent(event)` immediately; ensure that any thrown SDK error is caught, translated via existing error-formatting helpers, and rethrown or returned to callers.
  - Ensure overlay and busy-state cleanup mirrors the current behavior by having `AgentViewProvider.handlePrompt` treat a rejected `runExec` as a terminal path, always clearing overlays in `finally`.
- Auth and login wiring
  - Move `checkLoginStatus` and `runLogin` into a small `CodexAuthClient` that still shells out to `codex login status` / `codex login`, reusing the existing parsing logic but decoupled from the execution client and from SDK usage.
  - Keep `AgentViewProvider.refreshAuthState` and `handleLogin` wired to this auth helper, updating only user-visible strings where necessary to reflect that runs are now SDK-based rather than directly CLI-based.
- Error handling and compatibility
  - Replace `CodexBinaryError` and `ensureBinaryUsable` with error types and branches that reflect SDK failures (e.g., `ThreadErrorEvent`, non-zero exit from `CodexExec.run`, or platform discovery issues) while preserving friendly messages surfaced in the Agent shell and the `Codex` output channel.
  - Preserve the existing `Codex: Run Task` command’s behavior by routing it through the new `CodexClient.runExec`, logging raw `ThreadEvent`s to the output channel as JSON for debugging, and keeping its prompt / CWD selection unchanged.
  - Leave the webview messaging contract (`HostToWebviewMessage` / `WebviewToHostMessage`) and overlay integration unchanged, relying on event compatibility to ensure that higher-level features like progress labels and edited-file summaries continue to work after the migration.

