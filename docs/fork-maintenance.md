# Fork Maintenance

This fork uses a two-layer branch model so fork-only changes stay easy to replay as `pingdotgg/t3code` moves:

- `main`: exact mirror of `upstream/main`
- `custom/main`: long-lived fork branch that carries all fork-only commits
- `feature/<name>`: short-lived feature branches that branch from `custom/main`
- `upstreamable/<name>`: short-lived branches that branch from `main` for work you may want to PR upstream later

## One-Time Setup

Add the upstream remote and fetch it:

```bash
git remote add upstream git@github.com:pingdotgg/t3code.git
git fetch upstream
```

Keep local `main` as the upstream mirror:

```bash
git switch main
git fetch origin
git merge --ff-only upstream/main
git push origin main
```

Create the long-lived fork branch once:

```bash
git switch -c custom/main
git push -u origin custom/main
```

Rules:

- Never commit fork-only work directly on `main`
- Never merge `custom/main` back into `main`
- Rebase fork branches instead of merging `main` into them

## Daily Update Flow

Update the upstream mirror first:

```bash
git switch main
git fetch upstream --prune
git fetch origin --prune
git merge --ff-only upstream/main
git push origin main
```

Then replay your fork branch onto the refreshed mirror:

```bash
git switch custom/main
git rebase main
git push --force-with-lease origin custom/main
```

Rebase active feature branches after that:

```bash
git switch feature/gitea-support
git rebase custom/main
git push --force-with-lease origin feature/gitea-support
```

## New Feature Flow

Branch new fork-only work from `custom/main`:

```bash
git switch custom/main
git pull --ff-only origin custom/main
git switch -c feature/my-change
```

When the feature is ready:

```bash
git switch custom/main
git merge --ff-only feature/my-change
git push origin custom/main
```

For work that may become an upstream PR later, branch from `main` instead:

```bash
git switch main
git pull --ff-only origin main
git switch -c upstreamable/my-fix
```

## Optional Worktrees

Separate worktrees reduce branch switching friction:

```bash
git worktree add ../t3code-main main
git worktree add ../t3code-custom custom/main
```

Add feature worktrees only when needed:

```bash
git worktree add ../t3code-gitea feature/gitea-support
```

## GitHub Sync Workflow

`.github/workflows/sync-upstream.yml` keeps `origin/main` fast-forwarded to `pingdotgg/t3code:main`.

The workflow only updates `main`. It never rebases `custom/main`, because replaying fork commits needs manual conflict resolution when upstream changes overlap your fork.
