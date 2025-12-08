# Repo-Grounded Research (Git/GitHub)

Use this whenever you need docs, behavior, or troubleshooting info for a library/API/tool—prefer repo sources before web search.

## Finding the Repo

- Use the packages installed to find Github Project URLs. The package name in may differ from the repo name. Then search PyPI/npm for the homepage.
- **Reuse existing clones**: Check `.agent/repos/<repo>` for existing clones before cloning fresh.

## Syncing & Version Management

- **Clone with history for debugging**: Use `git clone <url> .agent/repos/<repo> --depth 50` (not `--depth 1`) to have enough history for `git log` between versions.
- **Check installed version first**: Before exploring the repo, verify the exact version installed (`pip show <pkg>` or npm).
- **Checkout the matching version**: Use `git checkout v<version>` to match the installed version for accurate debugging.
- **Always cleanup when done**: Before finishing, return the repo to main branch and pull latest:
  ```bash
  git -C .agent/repos/<repo> checkout main && git -C .agent/repos/<repo> pull --ff-only
  ```
  This ensures future sessions start with up-to-date code.

## Exploring the Source

- **Priority reading order**: CHANGELOG.md → README.md → project dependencies → source code
- **CHANGELOG.md is gold**: Look for breaking changes, deprecations, and version-specific behavior that matches your issue.
- **Check dependencies**: Read package version requirements (e.g., `mcp>=1.12.0`).
- **Navigate with grep**: Use `git grep` or `rg` to find relevant code patterns across the repo.
- **Compare package versions**: When debugging, compare package version between working and broken environments.

## Using GitHub CLI for Troubleshooting

Here are some examples (but not limited to these):

- **Search issues**: `gh issue list --search "<keywords>" --limit 30 --state all`
- **View issue details**: `gh issue view <number> --comments`
- **Check recent activity**: `gh issue list --limit 50 --state all` to see recent bugs
- **Search for your error**: `gh issue list --search "424" --state all` or `gh issue list --search "connection failed production"`

Use `gh --help` to see all the commands available for other ways to troubleshoot and explore.

## Version-Specific Debugging

- **Compare versions**: `git log --oneline v1.21.0..v1.22.0` to see what changed between releases.
- **List all tags**: `git tag --sort=-v:refname | head -20`
- **Find deprecations**: Search the codebase for `warnings.warn` or `DeprecationWarning`.

## Multiple Repos

- If both upstream and fork exist, prefer the canonical upstream.
- For SDKs with multiple language implementations (e.g., MCP has python-sdk, typescript-sdk), pick the one matching your stack.

## Fallback

If no repo is available (private repo, no GitHub presence, clone fails, etc.), fall back to official docs or web search.
