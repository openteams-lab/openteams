#!/usr/bin/env bash

set -uo pipefail

usage() {
  cat <<'EOF'
Usage: workflow-run.sh [options]

Dispatch and watch a workflow_dispatch run, or inspect/rerun an existing run.

Dispatch options:
  --workflow NAME|FILE     Workflow name or YAML file
  --ref BRANCH|TAG         Git ref; defaults to current branch, then default branch
  --field KEY=VALUE        Workflow input; may be repeated

Existing-run options:
  --run-id ID              Inspect and watch an existing run
  --rerun-failed           Rerun failed jobs for --run-id before watching

Common options:
  --repo OWNER/REPO        Repository; defaults to the current repository
  --interval SECONDS       Watch interval (default: 10)
  --no-watch               Return after dispatch/rerun without waiting
  -h, --help               Show this help

Exit codes:
  0  run completed successfully, or dispatch succeeded with --no-watch
  1  run failed or command failed
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

workflow=""
ref=""
repo=""
run_id=""
interval=10
watch=true
rerun_failed=false
fields=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workflow)
      [[ $# -ge 2 ]] || { echo "--workflow requires a value" >&2; exit 2; }
      workflow="$2"
      shift 2
      ;;
    --ref)
      [[ $# -ge 2 ]] || { echo "--ref requires a value" >&2; exit 2; }
      ref="$2"
      shift 2
      ;;
    --field)
      [[ $# -ge 2 ]] || { echo "--field requires KEY=VALUE" >&2; exit 2; }
      [[ "$2" == *=* ]] || { echo "--field requires KEY=VALUE" >&2; exit 2; }
      fields+=("$2")
      shift 2
      ;;
    --repo)
      [[ $# -ge 2 ]] || { echo "--repo requires a value" >&2; exit 2; }
      repo="$2"
      shift 2
      ;;
    --run-id)
      [[ $# -ge 2 ]] || { echo "--run-id requires a value" >&2; exit 2; }
      run_id="$2"
      shift 2
      ;;
    --rerun-failed)
      rerun_failed=true
      shift
      ;;
    --interval)
      [[ $# -ge 2 ]] || { echo "--interval requires a value" >&2; exit 2; }
      interval="$2"
      shift 2
      ;;
    --no-watch)
      watch=false
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

if [[ -n "$run_id" && -n "$workflow" ]]; then
  echo "Use either --run-id or --workflow, not both." >&2
  exit 2
fi

if [[ -z "$run_id" && -z "$workflow" ]]; then
  echo "--workflow is required when --run-id is not provided." >&2
  usage >&2
  exit 2
fi

if [[ "$rerun_failed" == true && -z "$run_id" ]]; then
  echo "--rerun-failed requires --run-id." >&2
  exit 2
fi

require_gh

if [[ -z "$repo" ]]; then
  repo="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')" || exit 1
fi

if [[ -z "$run_id" ]]; then
  if [[ -z "$ref" ]]; then
    ref="$(git branch --show-current 2>/dev/null || true)"
  fi
  if [[ -z "$ref" ]]; then
    ref="$(gh repo view "$repo" --json defaultBranchRef --jq '.defaultBranchRef.name')" || exit 1
  fi

  previous_id="$(
    gh run list --repo "$repo" --workflow "$workflow" --branch "$ref" \
      --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId // ""' 2>/dev/null || true
  )"

  dispatch_args=(workflow run "$workflow" --repo "$repo" --ref "$ref")
  for field in "${fields[@]}"; do
    dispatch_args+=(--field "$field")
  done

  echo "Dispatching workflow '$workflow' on '$repo' at ref '$ref'..."
  gh "${dispatch_args[@]}" || exit 1

  echo "Waiting for the new workflow run to appear..."
  for _ in $(seq 1 30); do
    candidate_id="$(
      gh run list --repo "$repo" --workflow "$workflow" --branch "$ref" \
        --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId // ""' 2>/dev/null || true
    )"
    if [[ -n "$candidate_id" && "$candidate_id" != "$previous_id" ]]; then
      run_id="$candidate_id"
      break
    fi
    sleep 2
  done

  if [[ -z "$run_id" ]]; then
    echo "The workflow was dispatched, but its run ID was not found. Inspect with: gh run list --workflow '$workflow'" >&2
    exit 1
  fi
elif [[ "$rerun_failed" == true ]]; then
  echo "Rerunning failed jobs for run $run_id..."
  gh run rerun "$run_id" --repo "$repo" --failed || exit 1
fi

echo "Run: $run_id"
gh run view "$run_id" --repo "$repo" \
  --json databaseId,workflowName,displayTitle,headBranch,headSha,status,conclusion,url \
  --jq '{run_id: .databaseId, workflow: .workflowName, title: .displayTitle, branch: .headBranch, head_sha: .headSha, status: .status, conclusion: .conclusion, url: .url}' || exit 1

if [[ "$watch" != true ]]; then
  exit 0
fi

echo "Watching run $run_id..."
gh run watch "$run_id" --repo "$repo" --interval "$interval" --exit-status
run_status=$?

echo
echo "Final run summary:"
gh run view "$run_id" --repo "$repo" \
  --json databaseId,workflowName,displayTitle,headBranch,headSha,status,conclusion,url,jobs \
  --jq '{run_id: .databaseId, workflow: .workflowName, title: .displayTitle, branch: .headBranch, head_sha: .headSha, status: .status, conclusion: .conclusion, url: .url, jobs: [.jobs[] | {name, status, conclusion, url}]}' || true

if [[ $run_status -ne 0 ]]; then
  echo
  echo "Failed step logs:"
  gh run view "$run_id" --repo "$repo" --log-failed || true
fi

exit "$run_status"
