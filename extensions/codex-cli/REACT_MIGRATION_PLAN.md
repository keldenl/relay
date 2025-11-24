# Codex CLI VS Code Webview → React Migration Plan
Date: 2025-11-24  
Confidence target: ≥95% before coding. No code changes committed yet.

## 1) What we have today
- `AgentViewProvider` builds HTML/CSS/JS inline in `src/agentView.ts`; no bundler, no componentization, and CSP allows only nonce-based inline scripts.
- Webview options restrict resources to `media/` and keep context when hidden; messaging uses ad-hoc objects (`appendMessage`, `authState`, etc.) without shared types.
- Extension host is TS compiled via the repo’s gulp/tsbuild pipeline to `out/extension.js`; no separation between host bundle and UI bundle.

## 2) Design guardrails (keep it simple, scalable)
- Stay aligned with VS Code Webview UX rules: theme tokens, accessibility, and contextual activation remain intact. citeturn1search1
- Avoid depending on the deprecated Webview UI Toolkit (archived Jan 6, 2025); keep usage optional and easily swappable. citeturn0search0
- Use Vite + React for the webview to get fast dev-server + HMR while emitting a small production bundle.
- Keep the extension host on esbuild/tsup-style bundling (fast, small) per React-in-webview migration guidance. citeturn1search0
- Lean on an existing Vite/React webview starter pattern to minimize CSP/HMR friction. citeturn0search1
- If HMR proves brittle, enable the purpose-built `@tomjs/vite-plugin-vscode` as the drop-in HMR bridge. citeturn0search8

## 3) Target architecture (minimal churn)
- Keep extension host code in `src/` compiled to `out/extension.js` via current gulp task, but replace inline HTML with loading a built webview.
- Add `webview/` (React + Vite) that outputs static assets to `media/webview-dist/`.
- Webview loads `index.html` from `media/webview-dist` using `asWebviewUri`; CSP stays strict in prod (nonce + hash) but allows dev-server origins in debug.
- Shared message/types module (`src/shared/messages.ts`) consumed by both host and webview (via path alias or `packages/shared` if we split).

## 4) Migration phases
1. **Scaffold webview app**
   - `npm create vite@latest webview -- --template react-ts`.
   - Set `build.outDir = ../media/webview-dist` and `base = "./"`; add CSP-friendly `script`/`style` nonce helpers.
   - Add VS Code theme CSS variables bridge (use current CSS tokens).
2. **Wire dev + prod loading**
   - In `AgentViewProvider`, detect `process.env.VSCODE_DEV` (or context global) to choose dev-server URL vs built assets.
   - In dev: set CSP to allow `https://localhost:5173` and inject Vite HMR client (starter shows exact code). citeturn0search1
   - In prod: load `index.html` from `media/webview-dist`, inject nonce for scripts/styles.
3. **Introduce typed messaging**
   - Define `MessageToWebview` / `MessageFromWebview` enums + payloads in shared module.
   - Replace ad-hoc `postMessage` usages with a small dispatcher + runtime validation (zod-lite or manual guards).
4. **Port UI to React components**
   - Recreate layout (`messages`, `reasoning bar`, `input row`, `login state`) as components with state lifted to a top-level `AgentApp`.
   - Preserve auto-open file behavior and command summaries; move parsing helpers to shared utils.
   - Keep styling via CSS modules or Tailwind-lite tokens; no heavy design system unless we isolate optional toolkit wrappers (deprecated).
5. **Build pipeline integration**
   - Add `scripts` to `extensions/codex-cli/package.json`: `dev:webview`, `build:webview`, `build:ext` (esbuild/tsup), `dev` (run both).
   - Update gulp task (or a pre-step) to ensure `build:webview` runs before `vsce`/packaging; include `media/webview-dist/**` in `files`.
6. **CSP, security, and auth flow**
   - Keep nonce-based CSP; allow `img-src` for data/https and `style-src` with nonce; in dev allow `localhost:5173` only.
   - Verify `acquireVsCodeApi` usage is encapsulated in a single bridge module for easier testing.
7. **Testing and QA**
   - Add webview unit tests with React Testing Library for message handling and rendering.
   - Add extension integration test to open the view and round-trip a mock `CodexEvent`.
   - Manual a11y pass (keyboard, focus order, contrast) per UX guide. citeturn1search1
8. **Docs + handoff**
   - Document dev workflow (`npm run dev` to get HMR inside VS Code) and prod build steps.
   - Add troubleshooting for CSP/HMR (e.g., host mismatch) and for missing Codex binary.

## 5) Minimal viable execution order (frictionless)
1) Create `webview/` Vite React scaffold and commit `media/webview-dist` output path.  
2) Add dev/prod loader in `AgentViewProvider` with CSP toggles and shared nonce helper.  
3) Define shared message contracts and convert existing handler code to typed dispatcher.  
4) Rebuild UI in React using existing markup/styling to avoid visual churn.  
5) Integrate builds into gulp/package scripts; verify `codex.runTask` still works.  
6) Add tests + a11y checklist; freeze inline HTML path after parity is proven.

## 6) Known risks and mitigations
- **Toolkit deprecation**: keep toolkit usage optional/isolated; prefer plain React + CSS tokens. citeturn0search0  
- **HMR/CSP friction**: confine dev CSP to `localhost:5173`; fall back to full reload if HMR fails. citeturn0search8  
- **Bundle bloat**: use Vite code-splitting + esbuild/tsup for host; watch `.vscodeignore` to exclude `node_modules`/raw src.  
- **Message contract drift**: shared types + runtime validation before dispatch.  
- **Accessibility regression**: keep ARIA labels and keyboard affordances from current DOM; re-verify. citeturn1search1

## 7) Acceptance checklist
- Parity demo: prompts, reasoning updates, command summaries, and auto-open paths all work in React view.  
- Dev UX: `npm run dev` gives live HMR inside a VS Code debug session. citeturn0search1  
- Prod UX: packaged extension loads from `media/webview-dist` with strict CSP and no console errors.  
- Tests: React unit tests + one extension integration test pass in CI.  
- A11y/theming: respects VS Code theme tokens; keyboard-only navigation works.  
- Docs: README section covering dev, build, CSP, and troubleshooting.

## Sources
- Ken Muse, “Using React in Visual Studio Code Webviews,” Oct 18, 2024 (bundling extension + React entry with esbuild). citeturn1search0  
- VS Code UX Guidelines – Webviews (updated Nov 12, 2025) for theme/a11y requirements. citeturn1search1  
- Deprecation notice: Webview UI Toolkit archived Jan 6, 2025. citeturn0search0  
- Vite + React webview starter with dev-server and HMR wiring. citeturn0search1  
- `@tomjs/vite-plugin-vscode` HMR bridge for React webviews. citeturn0search8
