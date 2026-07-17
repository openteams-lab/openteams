---
name: github-actions-run-and-fix
description: OpenTeams skill for manually starting a GitHub Actions workflow, watching its execution, diagnosing failures, rerunning transient failed jobs, repairing code or configuration errors, and dispatching the workflow again until it passes or the retry limit is reached.
---

# Run and Fix a GitHub Actions Workflow

Use this skill for workflows that support `workflow_dispatch`, or for inspecting and rerunning a known Actions run.

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

If `gh` is missing, stop and tell the user to install GitHub CLI. Offer the relevant command without installing it automatically:

- macOS: `brew install gh`
- Windows: `winget install --id GitHub.cli`
- Linux: follow `https://github.com/cli/cli/blob/trunk/docs/install_linux.md`

Then ask the user to run `gh auth login`. Never request, print, or persist their token.

## Workflow

1. Confirm the repository, workflow name or file, git ref, workflow inputs, and target environment. If any deployment target or input is ambiguous, ask before dispatching.
2. Start and watch a workflow with the bundled script from this skill directory:

   ```bash
   bash scripts/workflow-run.sh \
     --workflow <workflow-file-or-name> \
     --ref <branch-or-tag> \
     --field key=value
   ```

   Repeat `--field` for multiple inputs. Add `--repo OWNER/REPO` when the repository cannot be inferred.
3. To inspect an existing run, use `bash scripts/workflow-run.sh --run-id <id>`. For a clearly transient failure, use `--run-id <id> --rerun-failed` once.
4. When a run fails, read the summary and failed-step logs emitted by the script. Inspect the relevant workflow and reproduce the failing command locally when practical.
5. Classify the failure:
   - Runner, network, rate-limit, cache-service, or temporary external outage: rerun failed jobs once without editing code.
   - Code, test, lint, type, build, dependency, or deterministic configuration failure: make the smallest relevant fix and validate it locally.
   - Missing permission, secret, approval, protected environment, billing, or unavailable production resource: stop and report the required human action.
6. Review the diff, commit only related files, and push normally. Never force-push. Dispatch again only when a push does not already trigger the required workflow.
7. Repeat for at most three repair iterations, including at most one no-change rerun for the same failure signature.
8. Report the workflow, run URLs, root cause, reruns, files changed, local verification, pushed commit, and final conclusion.

## Safety boundaries

- Ask before starting a production deployment, destructive workflow, rollback, database migration, infrastructure mutation, or workflow with unclear inputs.
- Ask before changing `.github/workflows/**`, authentication, permissions, secrets, deployment configuration, or infrastructure.
- Do not invent workflow inputs. List available workflows with `gh workflow list` and inspect the selected YAML when necessary.
- Do not claim success until the target GitHub Actions run finishes successfully. If blocked, return the run URL and exact failed job or required user action.
