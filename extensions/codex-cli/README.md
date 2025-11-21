# Codex CLI Integration

Built-in scaffolding that launches a bundled Codex CLI binary and streams its JSON events into a `Codex` output channel via the `Codex: Run Task` command. No edits are applied to files yet—this is logging-only plumbing.

## Bundled Codex CLI

The extension expects a Codex CLI binary to be present under the `bin` directory for your platform:

- On this dev fork (darwin-arm64): `extensions/codex-cli/bin/darwin-arm64/codex`
- Windows would use `codex.exe` in the corresponding `bin/<platform>` folder (platform support is a TODO).

The tracked file in git is a placeholder. To use the real CLI:

1) Download the Codex CLI for your platform.  
2) Rename it to `codex` (or `codex.exe` on Windows).  
3) Place it at `extensions/codex-cli/bin/<platform>/`.  
4) Make it executable on macOS/Linux: `chmod +x extensions/codex-cli/bin/<platform>/codex`.

When the binary is missing, not executable, or still a placeholder, the extension surfaces a clear error with the exact path to fix.
