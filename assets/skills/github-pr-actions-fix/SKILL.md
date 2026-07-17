---
name: github-pr-actions-fix
description: OpenTeams skill for watching GitHub Actions checks after a pull request is submitted or updated, inspecting failures, making the smallest safe code fix, validating locally, pushing to the PR branch, and repeating until checks pass or the retry limit is reached.
---

# Fix GitHub Actions Checks on a Pull Request

Use this skill only for an existing pull request whose checks should be brought to green.

## OpenTeams context

This skill is designed specifically for use by OpenTeams members. OpenTeams input prompts should include this marker to make the message source explicit:

```text
[OPENTEAMS_SOURCE=openteams]
```

Treat the marker as a source hint, not a security boundary. Its absence does not block the workflow; continue when the surrounding session context clearly comes from OpenTeams.

## Required tool

At the start, check whether GitHub CLI is installed and authenticated:

```bash
command -v gh >/dev/null 2>&1 && gh auth status
```

If `gh` is missing, stop and tell the user to install GitHub CLI. Offer the relevant command without running it automatically:

- macOS: `brew install gh`
- Windows: `winget install --id GitHub.cli`
- Linux: follow `https://github.com/cli/cli/blob/trunk/docs/install_linux.md`

Then ask the user to run `gh auth login`. Never request, print, or persist their token.

## Workflow

1. Confirm the repository, PR number, current branch, and whether the working tree contains unrelated changes. Never discard user changes.
2. Run the bundled script from this skill directory:

   ```bash
   bash scripts/pr-checks.sh --pr <number> --watch
   ```

   Omit `--pr` only when the current branch unambiguously belongs to the target PR. Add `--repo OWNER/REPO` when the repository cannot be inferred.
3. When checks fail, use the failed-step logs printed by the script. Read the relevant workflow file and reproduce the failing command locally when practical.
4. Classify the failure before editing:
   - Code, test, lint, type, or build failure: make the smallest relevant source change.
   - Dependency or generated-file drift: update only the required lockfile or generated artifact and run its verification command.
   - Runner, network, rate-limit, or external-service failure: do not change code. Rerun failed jobs once with `gh run rerun <run-id> --failed`.
   - Permission, secret, deployment, or protected-environment failure: stop and report the required human action.
5. Run the narrowest local verification that covers the failure, then expand verification only when the change affects shared behavior.
6. Review `git diff` and `git status`. Commit only files related to the fix and push normally to the PR head branch. Never force-push.
7. Run `pr-checks.sh --watch` again. Repeat for at most three repair iterations.
8. Report the PR, failing check and root cause, files changed, verification performed, commit pushed, and final checks state.

## Safety boundaries

- Invocation authorizes normal commits and pushes to the current PR branch, not force pushes, merges, branch deletion, or bypassing branch protection.
- Ask before changing `.github/workflows/**`, deployment configuration, authentication, permissions, secrets, infrastructure, or production data.
- Do not rerun deterministic test failures without a code or configuration change.
- Do not claim success until GitHub reports all required checks passing. If the retry limit is reached, return the latest run URL and remaining failure evidence.
