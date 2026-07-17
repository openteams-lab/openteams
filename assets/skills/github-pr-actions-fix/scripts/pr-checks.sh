#!/usr/bin/env bash

set -uo pipefail

usage() {
  cat <<'EOF'
Usage: pr-checks.sh [options]

Inspect or watch checks for a pull request and print failed GitHub Actions logs.

Options:
  --pr NUMBER|URL|BRANCH  Pull request to inspect; defaults to the current branch PR
  --repo OWNER/REPO       Repository; defaults to the current repository
  --watch                 Wait until checks finish
  --interval SECONDS      Watch interval (default: 10)
  --no-logs               Do not print failed GitHub Actions logs
  -h, --help              Show this help

Exit codes:
  0  checks passed
  1  checks failed or could not be inspected
  8  checks are still pending
  126 GitHub CLI is not authenticated
  127 GitHub CLI is not installed
EOF
}

require_gh() {
  if ! command -v gh >/dev/null 2>&1; then
    cat >&2 <<'EOF'
GitHub CLI (gh) is required.
Install it with one of the following, then run: gh auth login
  macOS:   brew install gh
  Windows: winget install --id GitHub.cli
  Linux:   https://github.com/cli/cli/blob/trunk/docs/install_linux.md
EOF
    exit 127
  fi

  if ! gh auth status >/dev/null 2>&1; then
    echo "GitHub CLI is not authenticated. Run: gh auth login" >&2
    exit 126
  fi
}

pr=""
repo=""
watch=false
interval=10
show_logs=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr)
      [[ $# -ge 2 ]] || { echo "--pr requires a value" >&2; exit 2; }
      pr="$2"
      shift 2
      ;;
    --repo)
      [[ $# -ge 2 ]] || { echo "--repo requires a value" >&2; exit 2; }
      repo="$2"
      shift 2
      ;;
    --watch)
      watch=true
      shift
      ;;
    --interval)
      [[ $# -ge 2 ]] || { echo "--interval requires a value" >&2; exit 2; }
      interval="$2"
      shift 2
      ;;
    --no-logs)
      show_logs=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! [[ "$interval" =~ ^[1-9][0-9]*$ ]]; then
  echo "--interval must be a positive integer" >&2
  exit 2
fi

require_gh

if [[ -z "$repo" ]]; then
  repo="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')" || exit 1
fi

if [[ -z "$pr" ]]; then
  pr="$(gh pr view --repo "$repo" --json number --jq '.number')" || {
    echo "No pull request is associated with the current branch. Pass --pr." >&2
    exit 1
  }
fi

echo "Repository: $repo"
echo "Pull request: $pr"

if [[ "$watch" == true ]]; then
  echo "Waiting for pull request checks..."
  gh pr checks "$pr" --repo "$repo" --watch --interval "$interval"
  watch_status=$?
  if [[ $watch_status -ne 0 && $watch_status -ne 1 && $watch_status -ne 8 ]]; then
    echo "Unable to watch pull request checks (exit $watch_status)." >&2
  fi
fi

echo
echo "Check summary:"
gh pr checks "$pr" --repo "$repo"
checks_status=$?

if [[ "$show_logs" == true && $checks_status -ne 0 && $checks_status -ne 8 ]]; then
  links="$(
    gh pr checks "$pr" --repo "$repo" --json bucket,link \
      --jq '.[] | select(.bucket == "fail" or .bucket == "cancel") | .link' 2>/dev/null || true
  )"
  run_ids="$(printf '%s\n' "$links" | sed -nE 's#^https://github.com/[^/]+/[^/]+/actions/runs/([0-9]+).*$#\1#p' | sort -u)"

  if [[ -n "$run_ids" ]]; then
    while IFS= read -r run_id; do
      [[ -n "$run_id" ]] || continue
      echo
      echo "Failed Actions run: $run_id"
      gh run view "$run_id" --repo "$repo" \
        --json databaseId,workflowName,displayTitle,headBranch,headSha,status,conclusion,url \
        --jq '{run_id: .databaseId, workflow: .workflowName, title: .displayTitle, branch: .headBranch, head_sha: .headSha, status: .status, conclusion: .conclusion, url: .url}' || true
      echo "Failed step logs:"
      gh run view "$run_id" --repo "$repo" --log-failed || true
    done <<< "$run_ids"
  else
    echo "No failed GitHub Actions run URL was found; inspect the check links above." >&2
  fi
fi

exit "$checks_status"
