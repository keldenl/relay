# Codex Agent Cursor Overlay (Workbench)

This doc summarizes the overlay we added to show Codex agent progress directly above the editor / empty watermark area in the workbench. It’s meant as a quick guide for maintainers who need to tweak or extend the behavior.

## What it does

- Renders a floating cursor + label overlay on top of the active editor group whenever the agent is running.
- Shows a subtle animated gradient over the editor group to indicate activity.
- Swaps cursor icon based on mode:
  - Loader (pinwheel) while `thinking`.
  - Pointer for `executing` (default).
  - Pencil for `editing`.
  - Eye icon when mode is `reading` (line highlight + “reading” state).
- Cursor always visible during a turn; hides when the turn completes or errors.
- Cursor movement is animated (CSS transition) and bobs gently to convey “live” activity.
- Cursor stays anchored while the label grows/shrinks (label is offset to the bottom-right of the icon, so text changes don’t nudge the cursor anchor).
- Position anchors to:
  - First line of the target range when provided (e.g., reading a block).
  - Otherwise the center of the editor group (or mid/right inside an editor when we can derive layout info).
- Label sits to the right of the cursor so text length doesn’t shift the cursor anchor.

## Key code paths

### Workbench (main thread)
- **Overlay implementation:** `src/vs/workbench/browser/parts/editor/agentEditorOverlay.ts`
  - Computes overlay position from editor layout and target range.
  - Manages icon swap (pointer/eye), label text, and CSS vars for positioning.
  - Animates motion via CSS transition; bob animation lives on the inner body.
- **Styles:** `src/vs/workbench/browser/parts/editor/media/agentEditorOverlay.css`
  - Gradient, shadow, sizing, anchoring, animations.
- **Integration with editor groups:** `src/vs/workbench/browser/parts/editor/editorGroupView.ts`
  - Instantiates one overlay per group and attaches it to the active code editor.
- **Commands (extension → workbench):** `src/vs/workbench/browser/parts/editor/editor.contribution.ts`
  - `_codex.agentOverlay.setState` and `_codex.agentOverlay.clear` are internal commands the extension calls.

### Extension (extension host)
- **Bridge helper:** `extensions/codex-cli/src/agentOverlay.ts`
  - Simple controller that calls the internal commands with payload.
- **Agent wiring:** `extensions/codex-cli/src/agentView.ts`
  - Listens to Codex events and pushes overlay updates (mode, label, target file/line).
  - Clears overlay on completion/error; sets default “Thinking…” at turn start.
- **Webview UI:** `extensions/codex-cli/webview/src/App.tsx` and `components/AgentShell.tsx`
  - Progress pill removed so overlay is the sole progress surface.

## State payload (extension → workbench)

```ts
interface AgentOverlayStateDto {
  label: string;
  mode: 'thinking' | 'executing' | 'reading' | 'editing';
  targetUri?: string; // URI string (optional)
  targetRange?: { startLine: number; endLine?: number }; // 1-based lines
}
```

`mode === 'reading'` triggers the eye icon; others use the pointer.

## Positioning logic (high level)

1. Default: center of the host editor group.
2. If a code editor is active:
   - Use `getScrolledVisiblePosition` for `startLine` when available.
   - Fallback to `getTopForLineNumber(startLine, true) - scrollTop + lineHeight/2`.
   - X positioning biases:
     - `reading`: lean left-ish (about 30% into content) to avoid clipping against right UI.
     - all other modes: centered.
3. CSS variables `--overlay-x/--overlay-y` drive the wrapper transform; label is absolutely positioned to the bottom-right so the icon anchor does not move when text length changes.

## Visual details

- Icons: black fill, white stroke, ~16px wide; pointer, eye, and spinning loader variants.
  - Editing shows a pencil icon.
- Shadow: `drop-shadow(0 6px 14px rgba(0, 0, 0, 0.30))` for floating feel.
- Gradient: subtle dual radial gradients with slow animation.
- Motion: bob animation on inner body; movement between targets eased via `transition: transform 180ms ease-in-out`.
- Label positioning: bottom-right of the icon with a small offset so changing text width doesn’t shift the cursor anchor.
- Label text uses CSS variables for shimmer colors (`--shimmer-base`/`--shimmer-highlight`), duration, and width to keep the effect subtle and theme-friendly; defaults target the gray-to-white highlight used in the React example.

## How to extend

- New modes: update `AgentOverlayState`, mode-to-icon mapping (`setIconMode`), and any styling tweaks.
- Different positioning strategy: adjust `updatePosition` in `agentEditorOverlay.ts`—use editor layout info there.
- Colors/size/shadow: tweak `agentEditorOverlay.css`.
- If adding data to the payload, remember to update both the internal command DTO and the extension helper (`agentOverlay.ts`).

## Gotchas

- Keep transforms separated: wrapper handles absolute position; inner body handles bob animation.
- Don’t use `innerHTML`—SVGs are constructed with `createElementNS` to satisfy Trusted Types.
- Ensure overlay clears on all terminal paths (completion, error, cancellation) to avoid stuck cursors.
