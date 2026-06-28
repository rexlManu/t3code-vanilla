# AGENTS.md

## Task Completion Requirements

- `vp check` and `vp run typecheck` must pass before considering tasks completed.
  - If changing native mobile code, `vp run lint:mobile` must also pass.
- Use `vp test` for the built-in Vite+ test command and `vp run test` when you specifically need the `test` package script.

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Fork Maintenance

This repository is `rexlManu/t3code-vanilla`, a personal fork of upstream `pingdotgg/t3code`.

- `main` must mirror upstream `pingdotgg/t3code/main` exactly. Do not put custom commits on `main`.
- `custom/main` is the working fork branch: upstream `main` plus fork-only commits.
- New fork features should target `custom/main` and are not intended for upstream submission unless the user says otherwise.
- To bring the fork current:
  1. Start from a clean worktree on `custom/main`.
  2. Fetch both remotes: `git fetch upstream main && git fetch origin main custom/main`.
  3. Verify fork `main` has no fork-only commits: `git rev-list --left-right --count upstream/main...origin/main`. The right side must be `0`.
  4. If upstream is ahead, fast-forward fork `main` directly: `git push origin refs/remotes/upstream/main:refs/heads/main`.
  5. Update local refs: `git fetch origin main custom/main`.
  6. Merge upstream mirror into the fork branch: `git merge --no-ff origin/main`.
  7. Resolve conflicts by keeping upstream structure/API changes and reapplying fork-only behavior intentionally.
  8. Run the required checks from this AGENTS.md.
  9. Push directly to `origin/custom/main` when the user asks for direct updates; otherwise open a PR against `custom/main`.
- After the merge, verify:
  - `git rev-list --left-right --count upstream/main...origin/main` is `0 0`.
  - `git merge-base --is-ancestor origin/main origin/custom/main` succeeds.
- The sync workflow `.github/workflows/sync-upstream.yml` keeps fork `main` aligned with upstream using GitHub's fork-sync API. If it fails on workflow-file updates, do not switch back to a direct Actions `git push`; use an appropriately permissioned token or the GitHub API path.
- The local desktop launcher is managed in `/home/emmanuel/dotfiles/.local/bin/t3code` and runs this checkout with `T3CODE_STATE_PROFILE=dev`. Keep `/home/emmanuel/workspace/t3code` on `custom/main` and dependency links current for that launcher.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and client applications. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.
- `packages/client-runtime`: Shared runtime package for sharing client code across web and mobile.

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Vendored Repositories

This project vendors external repositories under `.repos/` as read-only reference material for coding
agents.

- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `.repos/` unless explicitly asked.
- Do not import from `.repos/`; application code must continue importing from normal package dependencies.
- Manage vendored subtrees with `bun run sync:repos`; use `bun run sync:repos --repo <id>` to sync one
  configured repository.
- When updating a dependency with a configured vendored subtree, sync that subtree in the same change so
  `.repos/` matches the installed dependency version.
- When writing Effect code, read `.repos/effect-smol/LLMS.md` first and inspect `.repos/effect-smol/` for
  examples of idiomatic usage, tests, module structure, and API design.
- When writing relay infrastructure code with Alchemy, inspect `.repos/alchemy-effect/` for examples of
  idiomatic usage, tests, module structure, and API design.
