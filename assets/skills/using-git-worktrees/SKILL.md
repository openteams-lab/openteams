---
name: using-git-worktrees
description: Use when starting feature work that needs isolation from current workspace or before executing implementation plans - ensures an isolated workspace exists via native tools, git worktree fallback, or non-git copy fallback
---

# Using Git Worktrees

## Overview

Ensure work happens in an isolated workspace. Prefer your platform's native worktree tools. Fall back to manual git worktrees only when no native tool is available. If git is unavailable or the project is not a git repository, create an isolated filesystem copy instead.

**Core principle:** Detect existing isolation first. Then use native tools. Then fall back to git. Then use a non-git copy fallback. Never fight the harness.

**Announce at start:** "I'm using the using-git-worktrees skill to set up an isolated workspace."

## Step 0: Detect Git Availability And Existing Isolation

**Before creating anything, check whether git can be used here.**

```bash
command -v git >/dev/null 2>&1
git rev-parse --is-inside-work-tree >/dev/null 2>&1
```

**If git is not installed:** Skip git-specific detection and go to Step 2 (Non-Git Copy Fallback).

**If the current directory is not inside a git work tree:** Skip git-specific detection and go to Step 2 (Non-Git Copy Fallback).

**If git is available and the project is a git repository, check if you are already in an isolated workspace.**

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
BRANCH=$(git branch --show-current)
```

**Submodule guard:** `GIT_DIR != GIT_COMMON` is also true inside git submodules. Before concluding "already in a worktree," verify you are not in a submodule:

```bash
# If this returns a path, you're in a submodule, not a worktree - treat as normal repo
git rev-parse --show-superproject-working-tree 2>/dev/null
```

**If `GIT_DIR != GIT_COMMON` (and not a submodule):** You are already in a linked worktree. Skip to Step 3 (Project Setup). Do NOT create another worktree.

Report with branch state:
- On a branch: "Already in isolated workspace at `<path>` on branch `<name>`."
- Detached HEAD: "Already in isolated workspace at `<path>` (detached HEAD, externally managed). Branch creation needed at finish time."

**If `GIT_DIR == GIT_COMMON` (or in a submodule):** You are in a normal repo checkout.

Has the user already indicated their worktree preference in your instructions? If not, ask for consent before creating a worktree or copy:

> "Would you like me to set up an isolated workspace? It protects your current directory from changes."

Honor any existing declared preference without asking. If the user declines consent, work in place and skip to Step 3.

## Step 1: Create Isolated Workspace

**You have two git-aware mechanisms. Try them in this order.**

### 1a. Native Worktree Tools (preferred)

The user has asked for an isolated workspace (Step 0 consent). Do you already have a way to create a worktree? It might be a tool with a name like `EnterWorktree`, `WorktreeCreate`, a `/worktree` command, or a `--worktree` flag. If you do, use it and skip to Step 3.

Native tools handle directory placement, branch creation, and cleanup automatically. Using `git worktree add` when you have a native tool creates phantom state your harness can't see or manage.

Only proceed to Step 1b if you have no native worktree tool available and git is usable in the project.

### 1b. Git Worktree Fallback

**Only use this if Step 1a does not apply** - you have no native worktree tool available, git is installed, and the current project is a git repository. Create a worktree manually using git.

#### Directory Selection

Follow this priority order. Explicit user preference always beats observed filesystem state.

1. **Check your instructions for a declared worktree directory preference.** If the user has already specified one, use it without asking.

2. **Check for an existing project-local worktree directory:**
   ```bash
   ls -d .worktrees 2>/dev/null     # Preferred (hidden)
   ls -d worktrees 2>/dev/null      # Alternative
   ```
   If found, use it. If both exist, `.worktrees` wins.

3. **Check for an existing global directory:**
   ```bash
   project=$(basename "$(git rev-parse --show-toplevel)")
   ls -d ~/.config/superpowers/worktrees/$project 2>/dev/null
   ```
   If found, use it (backward compatibility with legacy global path).

4. **If there is no other guidance available**, default to `.worktrees/` at the project root.

#### Safety Verification (project-local directories only)

**MUST verify directory is ignored before creating worktree:**

```bash
git check-ignore -q .worktrees 2>/dev/null || git check-ignore -q worktrees 2>/dev/null
```

**If NOT ignored:** Add to .gitignore, commit the change, then proceed.

**Why critical:** Prevents accidentally committing worktree contents to repository.

Global directories (`~/.config/superpowers/worktrees/`) need no verification.

#### Create the Worktree

```bash
project=$(basename "$(git rev-parse --show-toplevel)")

# Determine path based on chosen location
# For project-local: path="$LOCATION/$BRANCH_NAME"
# For global: path="~/.config/superpowers/worktrees/$project/$BRANCH_NAME"

git worktree add "$path" -b "$BRANCH_NAME"
cd "$path"
```

**Sandbox fallback:** If `git worktree add` fails with a permission error (sandbox denial), tell the user the sandbox blocked worktree creation and you're working in the current directory instead. Then run setup and baseline tests in place.

**Other git worktree failure:** If `git worktree add` fails because git metadata is broken, the repository has unsupported layout, or worktree commands are unavailable, go to Step 2 (Non-Git Copy Fallback).

## Step 2: Non-Git Copy Fallback

Use this when git is not installed, the current directory is not a git repository, or git worktree creation is impossible for a non-permission reason.

**Goal:** Preserve the user's current workspace by copying source files to a sibling or project-local isolated directory, then work from the copy.

### Directory Selection

Follow this priority order. Explicit user preference always beats observed filesystem state.

1. **Check your instructions for a declared isolated workspace directory preference.** If the user has already specified one, use it without asking.

2. **Check for an existing project-local isolation directory:**
   ```bash
   ls -d .worktrees 2>/dev/null
   ls -d worktrees 2>/dev/null
   ```
   If found, use it. If both exist, `.worktrees` wins.

3. **If the project has a parent directory you can write to**, default to a sibling directory named `<project-name>-workspace/<task-name-or-timestamp>`.

4. **If a sibling directory is not possible**, default to `.worktrees/<task-name-or-timestamp>` inside the current project.

### Copy Rules

Copy source files while excluding generated, dependency, cache, and runtime artifacts. At minimum exclude:

```text
.git/
.worktrees/
worktrees/
.openteams/
node_modules/
target/
dist/
build/
.next/
.turbo/
.cache/
__pycache__/
.pytest_cache/
venv/
.venv/
```

Prefer a platform-native copy tool that supports excludes:

```bash
# rsync-style environments
rsync -a --exclude-from=<exclude-file> "$source/" "$dest/"

# Windows PowerShell fallback
robocopy "$source" "$dest" /E /XD .git .worktrees worktrees .openteams node_modules target dist build .next .turbo .cache __pycache__ .pytest_cache venv .venv
```

**If no safe exclude-capable copy tool is available:** Ask the user before copying, because dependency/build directories can be large and noisy.

### Report Non-Git Isolation

Report clearly that this is a copy, not a git worktree:

```
Git is unavailable or this is not a git repository.
Created isolated copy at <full-path>.
Changes in this copy will not be tracked by git unless the project is initialized later.
```

## Step 3: Project Setup

Auto-detect and run appropriate setup:

```bash
# Node.js
if [ -f package.json ]; then npm install; fi

# Rust
if [ -f Cargo.toml ]; then cargo build; fi

# Python
if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
if [ -f pyproject.toml ]; then poetry install; fi

# Go
if [ -f go.mod ]; then go mod download; fi
```

## Step 4: Verify Clean Baseline

Run tests to ensure workspace starts clean:

```bash
# Use project-appropriate command
npm test / cargo test / pytest / go test ./...
```

**If tests fail:** Report failures, ask whether to proceed or investigate.

**If tests pass:** Report ready.

### Report

For git worktrees:

```
Worktree ready at <full-path>
Tests passing (<N> tests, 0 failures)
Ready to implement <feature-name>
```

For non-git copies:

```
Isolated copy ready at <full-path>
Tests passing (<N> tests, 0 failures)
Ready to implement <feature-name>
```

## Quick Reference

| Situation | Action |
|-----------|--------|
| Git not installed | Non-git copy fallback (Step 2) |
| Not inside a git repository | Non-git copy fallback (Step 2) |
| Already in linked worktree | Skip creation (Step 0) |
| In a submodule | Treat as normal repo (Step 0 guard) |
| Native worktree tool available | Use it (Step 1a) |
| No native tool | Git worktree fallback (Step 1b) |
| Git worktree unavailable for non-permission reason | Non-git copy fallback (Step 2) |
| `.worktrees/` exists | Use it (verify ignored) |
| `worktrees/` exists | Use it (verify ignored) |
| Both exist | Use `.worktrees/` |
| Neither exists | Check instruction file, then default `.worktrees/` |
| Global path exists | Use it (backward compat) |
| Directory not ignored | Add to .gitignore + commit |
| Permission error on create | Sandbox fallback, work in place |
| Tests fail during baseline | Report failures + ask |
| No package.json/Cargo.toml | Skip dependency install |

## Common Mistakes

### Fighting the harness

- **Problem:** Using `git worktree add` when the platform already provides isolation
- **Fix:** Step 0 detects existing isolation. Step 1a defers to native tools.

### Skipping detection

- **Problem:** Creating a nested worktree inside an existing one
- **Fix:** Always run Step 0 before creating anything

### Assuming git exists

- **Problem:** Running `git rev-parse` in a non-git project or on a machine without git blocks isolation entirely
- **Fix:** Step 0 checks git availability and repository status before git-specific commands

### Skipping ignore verification

- **Problem:** Worktree contents get tracked, pollute git status
- **Fix:** Always use `git check-ignore` before creating project-local worktree

### Assuming directory location

- **Problem:** Creates inconsistency, violates project conventions
- **Fix:** Follow priority: existing > global legacy > instruction file > default

### Copying too much in non-git fallback

- **Problem:** Dependency, build, cache, or runtime directories make the isolated copy huge and noisy
- **Fix:** Use exclude-capable copy commands and exclude common generated directories

### Proceeding with failing tests

- **Problem:** Can't distinguish new bugs from pre-existing issues
- **Fix:** Report failures, get explicit permission to proceed

## Red Flags

**Never:**
- Create a worktree when Step 0 detects existing isolation
- Use `git worktree add` when you have a native worktree tool (e.g., `EnterWorktree`). This is the #1 mistake - if you have it, use it.
- Skip Step 1a by jumping straight to Step 1b's git commands
- Run git-specific worktree commands before confirming git exists and the project is a git repository
- Create worktree without verifying it's ignored (project-local)
- Copy generated dependency/build/cache directories in non-git fallback
- Skip baseline test verification
- Proceed with failing tests without asking

**Always:**
- Run Step 0 detection first
- Prefer native tools over git fallback
- Use non-git copy fallback when git is unavailable or the project is not a git repository
- Follow directory priority: existing > global legacy > instruction file > default
- Verify directory is ignored for project-local
- Auto-detect and run project setup
- Verify clean test baseline
