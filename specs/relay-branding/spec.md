<!--
Copyright (c) 2025.
Licensed under the MIT License. See License.txt in the project root for license information.
-->

## Overview

- Replace all user-facing "Code - OSS", "Visual Studio Code", "VS Code", and `code-oss` branding in this fork with a coherent Relay brand so that the shipped product feels like Relay, not a VS Code derivative, while still preserving upstream attribution in source and legal docs.
- Cover every major surface where the old brand appears: app name, window title, menus, welcome and onboarding copy, protocol handlers, CLI command name, icons and OS integration, data folders, and built-in extension behavior.
- Centralize brand configuration so future copy and feature work can refer to Relay generically via `product` metadata instead of hard-coding "VS Code" strings, minimizing ongoing upstream merge pain.

## Requirements

- The primary product name shown in the UI, window title, menus, and system task switchers MUST be "Relay" (for example, "Relay" or "Relay – FolderName") and MUST NOT display "Code - OSS", "Visual Studio Code", or "VS Code".
- The application name metadata in `product.json` and `src/vs/platform/product/common/product.ts` (`nameShort`, `nameLong`, `applicationName`, `win32*` names, `darwinBundleIdentifier`, `linuxIconName`, `urlProtocol`, `dataFolderName`, `serverApplicationName`, `serverDataFolderName`, `tunnelApplicationName`) MUST be updated to Relay-specific values (for example, `nameShort: "Relay"`, `applicationName: "relay"`, `dataFolderName: ".relay"`).
- The fallback dev-time configuration in `src/vs/platform/product/common/product.ts` and the `src/main.ts` user data path default (currently `'code-oss-dev'`) MUST be updated so that running from source identifies as Relay Dev (for example, `nameShort: "Relay Dev"`, `applicationName: "relay-dev"`, data folder `'.relay-dev'`).
- The CLI entry point and OS launchers (`resources/darwin/bin/code.sh`, `resources/linux/bin/code.sh`, `resources/win32/bin/code.*`, `resources/completions/*/code`) MUST be updated so that the primary documented command to launch the app is `relay`, not `code`; a `code` alias MAY be preserved for compatibility but MUST NOT be referenced in user-facing docs or UI.
- The URI scheme / protocol handler configuration (currently using `code-oss` in `product.json.urlProtocol`, Linux `code-url-handler.desktop`, and related launcher scripts) MUST be changed so Relay registers and handles a `relay://` protocol (for example, `relay://file/...`) and no longer advertises `code-oss://` or `vscode://` schemes as its primary identity.
- All OS-specific packaging metadata (Linux `.desktop` and AppStream files, macOS bundle metadata, Windows AppX/installer manifests and shortcuts) MUST display Relay branding: app name "Relay", Relay icon, and Relay description; legacy names like "Code - OSS" or VS Code logo MUST NOT appear in those user-facing artifacts.
- The icons and logos shown in the product (splash/loading graphic, empty workbench background logo, app icons in `resources/*` that currently carry the VS Code mark) MUST be replaced with Relay assets, keeping the same file formats and resolutions; the spec MAY assume new icon files will be provided out-of-band but MUST enumerate the file paths that need replacement.
- In-app strings that today refer to "VS Code" or "Visual Studio Code" (for example, in getting started content, walkthroughs, notifications, and issue reporting copy under `src/vs/workbench/**`) MUST be updated to use the Relay name and a Relay-focused description (for example, "Relay" or "Relay editor"), except where legally required to attribute upstream.
- All in-app strings and menus that refer to "VS Code" in a generic way (for example, "This extension handles issues outside of VS Code", "Reload VS Code", "VS Code for the Web") MUST instead refer to Relay (for example, "outside of Relay", "Reload Relay", "`{product.nameLong} for the Web`"), and SHOULD be wired through `product.nameShort` / `nameLong` where practical instead of hard-coding "Relay".
- User-facing documentation and onboarding content that ships inside the product (for example, welcome walkthroughs, editor tours, getting-started pages, snippets of copy pointing to `code.visualstudio.com`) MUST be reviewed; references to "VS Code" MUST be rewritten in Relay terms, and external links SHOULD be updated to Relay-hosted docs where available or, if still pointing to `code.visualstudio.com`, SHOULD label them generically as "documentation" without suggesting the app is VS Code.
- The "About" dialog / command (including OS-specific About windows) MUST clearly present Relay branding (name, icon, version) and MUST include an attribution statement that Relay is built on the MIT-licensed Code - OSS project without suggesting official affiliation with Microsoft or Visual Studio Code.
- The "Report Issue" / "Submit Feedback" flows MUST no longer default to the upstream VS Code GitHub issue URL (`product.reportIssueUrl` and derivative code paths) and SHOULD instead point at a Relay-specific support or feedback URL, or MAY be disabled if no public tracker exists.
- Built-in extensions that branch on the URI scheme or app identity (for example, places where `'code-oss'` appears in `extensions/**` such as GitHub and Microsoft authentication, TypeScript, and experimentation services) MUST treat the Relay application scheme (for example, `'relay'`) as equivalent to `'vscode'`/`'vscode-insiders'` for feature availability, and MUST NOT assume `'code-oss'` specifically.
- Any built-in extension descriptions, titles, or notifications that name "VS Code" MUST be updated to say "Relay" where they describe the host product, while still preserving third-party names like "GitHub Copilot" and obeying their branding requirements.
- Default data and configuration locations (for example, `product.dataFolderName`, `.vscode-oss-dev` paths in `src/vs/platform/environment/node/userDataPath.ts`, tests in `src/vs/platform/windows/test/**`, and CLI constants in `cli/src/constants.rs`) MUST migrate to Relay-specific folder names; the implementation SHOULD attempt to detect and optionally import settings from existing `code-oss` folders on first run, but this migration MUST be explicit and reversible (for example, via a prompt or documented CLI flag).
- The URL protocol and desktop integration tests and fixtures (for example, references to `code-oss-dev`, `.vscode-oss-dev`, or `code-oss://` in `test/**` and `resources/linux/*.template`) MUST be updated to expect the Relay application name, data folder, and protocol, and new tests SHOULD be added where needed to validate that branding-sensitive entry points (URI handling, desktop files, app IDs) remain correct.
- Source-level references to VS Code that are required for legal or historical reasons (for example, `README-VSCODE.md`, license headers, and upstream documentation snapshots) MAY remain unchanged but MUST NOT be linked from primary end-user surfaces inside the app; instead, the top-level `README.md` and in-product "Help" entries SHOULD highlight Relay-branded docs and only reference upstream docs in an "Open Source Credits" or similar section.
- The Relay brand configuration (name, URL protocol, description, icons) MUST be defined in a single authoritative place (`product.json` plus a small helper module) so that future upstream merges or Fork-specific tweaks only need changes in that layer, and hard-coded "Relay" strings SHOULD be minimized in favor of using the shared `product` service.
- All branding changes MUST be verified across the three primary platforms (macOS, Windows, Linux) in both dev-from-source (`npm run watch` / `./scripts/code.sh`) and packaged builds to ensure there are no remaining "Code - OSS" / "VS Code" appearances in app metadata, installers, or system UIs (dock, taskbar, launchers).

## Design

- Product and brand configuration
  - Keep `product.json` as the primary brand configuration file and redefine Relay’s core identity there: `nameShort`, `nameLong`, `applicationName`, `dataFolderName`, `urlProtocol`, `win32*` names, `darwinBundleIdentifier`, `linuxIconName`, and Relay-specific issue/reporting URLs.
  - Update the dev-time fallback block in `src/vs/platform/product/common/product.ts` to mirror the Relay identity (for example, "Relay Dev" and `.relay-dev`) so running from source behaves like a branded Relay dev build.
  - Introduce a small `brand` helper (for example, `src/vs/platform/product/common/brand.ts`) that wraps the `product` service and exposes derived properties (tagline, short description, URL protocol, canonical CLI name) to avoid scattering Relay-specific literals.
  - Audit places in the code that manually construct "VS Code" or "Code - OSS" labels and refactor them to use `product.nameShort` / `nameLong` (pulled via the existing `IProductService`) or the new `brand` helper, especially for menu labels, window titles, and notifications.

- OS integration and launchers
  - For macOS:
    - Update the bundle identifier (`product.darwinBundleIdentifier`), app display name, and icon assets (`resources/darwin/code.icns` and related icons) to Relay-specific values; ensure that Dock, Spotlight, and "About Relay" show the Relay icon and name.
    - Review any macOS-specific packaging scripts or plist templates in `resources/darwin` and `build/` to remove "Code" / "Visual Studio Code" naming.
  - For Windows:
    - Change the app name and executable branding in `resources/win32` (including `code.ico`, `VisualElementsManifest.xml`, AppX manifest, and Inno Setup templates) to Relay and point them at the new Relay icon resources.
    - Update `product.win32DirName`, `win32NameVersion`, `win32RegValueName`, and `win32AppUserModelId` so the installer, Start menu, and taskbar use Relay-branded identifiers; verify jumplist and notifications display the Relay name.
  - For Linux:
    - Update `.desktop` files and templates under `resources/linux` (for example, `code.desktop`, `code-url-handler.desktop`, `code.appdata.xml`) to `relay.desktop` / `relay-url-handler.desktop`, with `Name=Relay`, a Relay description, and `Exec=relay`.
    - Ensure `product.linuxIconName` and icon assets (`resources/linux/code.png`, `resources/linux/rpm/code.xpm`) are renamed or replaced to display Relay’s icon in desktop environments and package metadata.
  - For CLI launchers and completions:
    - Rename or wrap the platform-specific launcher scripts (`resources/darwin/bin/code.sh`, `resources/linux/bin/code.sh`, `resources/win32/bin/code.*`) so `relay` is the primary entry point; optionally keep thin `code` shims that forward to `relay` for existing users.
    - Update shell completion definitions under `resources/completions/*/code` to new `relay` equivalents and adjust any references in README or help output to advertise `relay` as the command name.

- URI scheme and application identity
  - Set `product.urlProtocol` to `relay` and update protocol handler templates (Linux URL handler .desktop file, Windows URL registration, macOS URL schemes) so `relay://` links launch Relay.
  - Audit all usages of `code-oss://` and `vscode://` in the repo (for example, test fixtures in `test/**`, comments in `extensions/**`) and change them to `relay://` where they refer to this fork’s behavior; keep upstream examples intact only in clearly marked docs.
  - Ensure that `vscode.env.uriScheme` equals the new Relay scheme and that any built-in extensions that switch on the scheme (for example, GitHub / Microsoft authentication and experimentation services) treat `'relay'` the same way they previously treated `'code-oss'` or `'vscode'`.

- Data folders, configuration, and migration
  - Change default data and config folder names via `product.dataFolderName` and related constants (for example, `.vscode-oss-dev` in `src/vs/platform/environment/node/userDataPath.ts` and `.vscode-oss` in `cli/src/constants.rs`) to `.relay` / `.relay-dev`.
  - Implement a simple migration helper that, on first startup with new Relay paths, detects an existing `code-oss`/`.vscode-oss` data folder and offers to import settings, extensions, and keybindings into the new Relay folders (or run in a "fresh profile" mode if the user declines).
  - Update tests in `src/vs/platform/windows/test/**`, `src/vs/platform/workspaces/test/**`, and similar locations so they reference the new Relay paths and protocols, while adding at least one test to confirm the migration helper behaves correctly.

- UI strings, onboarding, and docs
  - Use `rg`-style searches to enumerate all strings under `src/vs/**` that mention "VS Code", "Visual Studio Code", or "Code - OSS", and categorize them into: UI labels/tooltips, inline documentation snippets, links to `code.visualstudio.com`, and upstream-only content.
  - For UI labels, tooltips, and interactive onboarding (for example, `welcomeGettingStarted`, editor walkthroughs, issue reporter, notifications), replace references to "VS Code" with `product.nameShort` or "Relay" directly, and review the tone so it matches Relay's "fork for non-coders" positioning.
  - For inline documentation snippets that link to `code.visualstudio.com`, either (a) update them to point at Relay-hosted docs once available, or (b) keep the links but revise the surrounding text to refer generically to "documentation" instead of "VS Code docs".
  - Leave `README-VSCODE.md` and other upstream snapshot docs intact for developers, but ensure the primary documentation entry points (`README.md`, any "Help > Documentation" menu entries, and welcome content) point to Relay-branded materials and clearly state that Relay is built on Code - OSS rather than presenting itself as Visual Studio Code.

- Built-in extensions and ecosystem behavior
  - Audit built-in extensions under `extensions/**` for hard-coded checks against `'code-oss'`, `'VS Code'`, or `code.visualstudio.com`, and update them to recognize the Relay URI scheme and product identity while preserving any necessary behavior for upstream compatibility.
  - For authentication-related extensions (for example, GitHub / Microsoft auth), ensure that `env.uriScheme === 'relay'` is treated as a supported host so sign-in and callback handling remain functional.
  - For any built-in extension descriptions or notifications that explicitly mention "VS Code" as the host app, update the text to "Relay" where appropriate, taking care not to change third-party product names or licenses.

- Icons, imagery, and visual branding
  - Replace app icons and any embedded logos (for example, the empty workbench background logo, splash/loader graphics, icon assets in `resources/darwin`, `resources/win32`, and `resources/linux`) with Relay-specific artwork, keeping the same dimensions and file formats so build scripts remain unchanged.
  - Verify that the new icons propagate correctly through installers, OS app lists, taskbars/docks, and file-type associations on all three platforms.

- Verification and ongoing maintenance
  - After implementing branding changes, run platform-specific smoke tests (including dev and packaged builds) to validate that launching via the Relay CLI, protocol links, desktop shortcuts, and recent file lists consistently shows Relay branding.
  - Add a small automated check (for example, a script or test that greps built artifacts under `out*/` and `resources/` for "Code - OSS" / "Visual Studio Code" / "VS Code") and fails the build if any new user-facing references to the old brand are introduced.
  - Document the Relay branding rules in a short contributor note (for example, in `AGENTS.md` or `CONTRIBUTING.md`), reminding future contributors to avoid reintroducing "VS Code" in new UI strings and to use `product`/`brand` helpers instead.

