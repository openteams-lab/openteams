#!/usr/bin/env python3
"""Live model acceptance against an isolated OpenTeams instance.

Build `cargo build -p server --bin server`, then run prepare, start, discover,
baseline, create, turn, restart, verify, turn --resume, failure-cache, audit,
stop in order. Run phases sequentially. `turn` makes real model requests
using the current CLI account. Outputs stay in the gitignored report directory.
Use --help for phase and case selection. No credentials are copied or reported.
"""

import argparse
import json
import os
from pathlib import Path
import queue
import shlex
import signal
import socket
import sqlite3
import subprocess
import time
import threading
import urllib.parse
import urllib.request
import uuid


REPO = Path(__file__).resolve().parent.parent
CASES = {
    "codex-astra": ("CODEX", "gpt-6.2-astra", "low"),
    "codex-sol": ("CODEX", "gpt-6.2-sol", "low"),
    "codex-terra": ("CODEX", "gpt-6.1-terra", "low"),
    "claude-fable": ("CLAUDE_CODE", "fable", "low"),
    "claude-fable-pinned": ("CLAUDE_CODE", "claude-fable-5-2", "low"),
    "kimi-pro": ("KIMI_CODE", "kimi-code/k3.1-pro", "low"),
    "kimi-highspeed": ("KIMI_CODE", "kimi-code/k3.1-pro-highspeed", "low"),
    "invalid-effort": ("CODEX", "gpt-6-luna", "ultra"),
}


def save(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


class Acceptance:
    def __init__(self, args):
        self.args = args
        self.root = Path(args.report_dir).resolve()
        self.data = self.root / "data"
        self.workspace = self.root / "workspace"
        self.receipt_path = self.root / "receipt.json"
        self.receipt = json.loads(self.receipt_path.read_text()) if self.receipt_path.exists() else {}
        self.base = f"http://127.0.0.1:{args.port}"

    def record(self, key, value):
        if self.receipt_path.exists():
            self.receipt = json.loads(self.receipt_path.read_text())
        self.receipt[key] = value
        save(self.receipt_path, self.receipt)
        print(json.dumps({key: value}, ensure_ascii=False), flush=True)

    def api(self, path, payload=None, method=None, timeout=180):
        request = urllib.request.Request(
            self.base + "/api" + path,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={"Content-Type": "application/json", "Origin": self.base},
            method=method or ("POST" if payload is not None else "GET"),
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.load(response)
        if not result.get("success"):
            raise RuntimeError(f"{path}: {result.get('message')}")
        return result["data"]

    def prepare(self):
        if self.data.exists():
            raise RuntimeError("Report directory already contains data; choose a new directory")
        self.data.mkdir(parents=True)
        self.workspace.mkdir()
        # Minimal fresh application config; native CLI credentials remain in place.
        config = {
            "config_version": "v10", "theme": "LIGHT",
            "executor_profile": {"executor": "CODEX"},
            "disclaimer_acknowledged": True, "onboarding_acknowledged": True,
            "notifications": {"sound_enabled": False, "push_enabled": False,
                              "sound_file": "ABSTRACT_SOUND1"},
            "editor": {"editor_type": "VS_CODE"}, "github": {},
            "analytics_enabled": False, "error_reporting_enabled": False,
            "workspace_dir": str(self.workspace), "last_app_version": None,
            "show_release_notes": False, "language": "ZH_HANS",
        }
        save(self.data / "config.json", config)
        subprocess.run(["git", "init", "-q", str(self.workspace)], check=True)
        subprocess.run(["git", "-C", str(self.workspace), "-c", "user.name=ModelAcceptance",
                        "-c", "user.email=model-acceptance@example.invalid", "commit",
                        "--allow-empty", "-qm", "Initial acceptance workspace"], check=True)
        self.record("environment", {"revision": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
            "workspace": str(self.workspace), "data_dir": str(self.data), "port": self.args.port})

    def start(self):
        if (self.root / "server-process.json").exists():
            raise RuntimeError("This report directory already has a server; use restart")
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", self.args.port))
        env = dict(os.environ, OPENTEAMS_ASSET_DIR=str(self.data),
                   BACKEND_PORT=str(self.args.port), HOST="127.0.0.1",
                   OPENTEAMS_SKIP_BROWSER="1", OPENTEAMS_AUTO_MIGRATE_PROJECTS="0",
                   VK_ALLOWED_ORIGINS=f"{self.base},http://localhost:24081,http://127.0.0.1:24081")
        with (self.root / "server.log").open("ab") as log:
            child = subprocess.Popen([str(REPO / "target/debug/server")], cwd=REPO,
                                     env=env, stdout=log, stderr=log, start_new_session=True)
        save(self.root / "server-process.json", {"pid": child.pid})
        for _ in range(120):
            if child.poll() is not None:
                raise RuntimeError("Server exited; inspect local server.log")
            try:
                self.api("/health", timeout=2)
                if not (self.data / "db.sqlite").exists():
                    child.terminate()
                    raise RuntimeError("Server did not honour OPENTEAMS_ASSET_DIR; rebuild it first")
                self.record("server_start", {"pid": child.pid, "ready": True})
                return
            except (OSError, ValueError, RuntimeError):
                time.sleep(1)
        raise TimeoutError("Server did not become ready")

    def stop(self):
        process = self.root / "server-process.json"
        if not process.exists():
            return
        pid = json.loads(process.read_text())["pid"]
        # Only terminate a process that still names this server binary.
        command = subprocess.run(["ps", "-p", str(pid), "-o", "command="],
                                 capture_output=True, text=True).stdout.strip()
        if command != str(REPO / "target/debug/server"):
            raise RuntimeError("Recorded PID no longer belongs to the acceptance server")
        os.kill(pid, signal.SIGTERM)
        for _ in range(30):
            if subprocess.run(["kill", "-0", str(pid)], capture_output=True).returncode:
                break
            time.sleep(1)
        else:
            raise TimeoutError("Server has not stopped")
        process.unlink()
        self.record("server_stop", {"pid": pid, "stopped": True})

    def discover(self):
        query = urllib.parse.urlencode({"workspace_path": str(self.workspace)})
        result = self.api("/agents/runtime/refresh?" + query, {}, timeout=300)
        runners = {}
        for row in result["runners"]:
            if row["runner_type"] in {case[0] for case in CASES.values()}:
                runners[row["runner_type"]] = {key: row.get(key) for key in (
                    "discovered_models", "model_details", "model_source", "version", "last_error")}
        self.record("discovery", runners)

    def baseline(self):
        catalogs = {}
        commands = {
            "CODEX": ["npx", "-y", "@openai/codex@0.167.0", "app-server"],
            "CLAUDE_CODE": ["npx", "-y", "@anthropic-ai/claude-code@2.1.321",
                "--print", "--verbose", "--input-format", "stream-json", "--output-format",
                "stream-json", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
                "--no-session-persistence"],
        }
        for runner, command in commands.items():
            child = subprocess.Popen(command, cwd=self.workspace, stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, start_new_session=True)
            lines = queue.Queue()
            def read_lines(stream=child.stdout, output=lines):
                for line in stream:
                    try:
                        output.put(json.loads(line))
                    except ValueError:
                        pass
            threading.Thread(target=read_lines, daemon=True).start()
            def send(value):
                child.stdin.write(json.dumps(value) + "\n")
                child.stdin.flush()
            def receive(matches):
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    try:
                        value = lines.get(timeout=max(0.01, deadline - time.monotonic()))
                    except queue.Empty:
                        break
                    if matches(value):
                        return value
                raise TimeoutError(runner + " direct discovery timed out")
            try:
                if runner == "CODEX":
                    send({"id": 1, "method": "initialize", "params": {
                        "clientInfo": {"name": "openteams-model-acceptance", "version": "1"}}})
                    receive(lambda v: v.get("id") == 1)
                    send({"method": "initialized"})
                    models, cursor, pages = [], None, 0
                    for request_id in range(2, 102):
                        send({"id": request_id, "method": "model/list", "params": {
                            "limit": 2, "includeHidden": False, "cursor": cursor}})
                        page = receive(lambda v: v.get("id") == request_id)["result"]
                        pages += 1
                        models.extend({"id": m["model"], "reasoning_efforts": [
                            e["reasoningEffort"] for e in m.get("supportedReasoningEfforts", [])]}
                            for m in page["data"] if not m.get("hidden"))
                        cursor = page.get("nextCursor")
                        if cursor is None:
                            break
                    else:
                        raise RuntimeError("Direct model/list pagination did not end")
                    catalogs[runner] = {"models": sorted(models, key=lambda m: m["id"]), "pages": pages}
                else:
                    send({"type": "control_request", "request_id": "models", "request": {"subtype": "initialize"}})
                    response = receive(lambda v: v.get("type") == "control_response" and
                        v.get("response", {}).get("request_id") == "models")
                    models = response["response"]["response"]["models"]
                    catalogs[runner] = {"models": sorted([{"id": m["value"],
                        "reasoning_efforts": m.get("supportedEffortLevels")} for m in models], key=lambda m: m["id"])}
            finally:
                try:
                    if child.poll() is None:
                        os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait()
        # Only model identifiers leave this CLI response; it may contain credentials.
        output = subprocess.check_output(["kimi", "provider", "list", "--json"],
            cwd=self.workspace, stderr=subprocess.DEVNULL, timeout=30)
        catalogs["KIMI_CODE"] = {"models": [{"id": name} for name in sorted(json.loads(output)["models"])]}
        self.record("cli_baseline", catalogs)
        if "discovery" in self.receipt:
            matches = {runner: sorted(m["id"] for m in catalog["models"]) ==
                sorted(self.receipt["discovery"][runner]["discovered_models"])
                for runner, catalog in catalogs.items()}
            self.record("cli_catalog_matches", matches)
            assert all(matches.values()), matches

    def create(self):
        if "cases" in self.receipt:
            raise RuntimeError("Cases already created")
        cases = {}
        for name, (runner, model, effort) in CASES.items():
            project = self.api("/projects", {"name": "ModelAcceptance" + name.replace("-", ""),
                "default_workspace_path": str(self.workspace)})
            agent = self.api("/chat/agents", {"name": name, "runner_type": runner,
                "system_prompt": "This is a model configuration smoke test. Reply only with the requested JSON. Do not use tools, delegate, browse, or change files.",
                "model_name": model, "owner_project_id": project["id"]})
            config = {"runner_type": runner, "model_name": model, "thinking_effort": effort,
                      "mcp": {"mcpServers": {}}}
            member = self.api(f"/projects/{project['id']}/members", {
                "member_type": "agent", "agent_id": agent["id"], "member_name": name,
                "default_workspace_path": str(self.workspace), "is_default": True,
                "execution_config": config})
            session = self.api(f"/projects/{project['id']}/sessions", {
                "title": "Live model acceptance", "workspace_path": str(self.workspace),
                "worktree_mode": "disabled"})
            session = session.get("session", session)
            session_agents = self.api(f"/chat/sessions/{session['id']}/agents")
            selected = next(row for row in session_agents if row["agent_id"] == agent["id"])
            assert selected["execution_config"] == config, (name, selected["execution_config"])
            cases[name] = {"project_id": project["id"], "agent_id": agent["id"],
                "member_id": member["id"], "session_id": session["id"],
                "session_agent_id": selected["id"], "config": config, "turns": []}
        self.record("cases", cases)

    def turn(self):
        names = [self.args.case] if self.args.case else list(CASES)
        if self.args.resume:
            names = [name for name in names if self.receipt["cases"][name]["turns"]
                     and self.receipt["cases"][name]["turns"][-1]["reply_received"]]
        for name in names:
            case = self.receipt["cases"][name]
            sid = case["session_id"]
            before = self.api(f"/chat/sessions/{sid}/agents")[0]["agent_session_id"]
            token = "MODEL_ACCEPTANCE_" + uuid.uuid4().hex[:10]
            response = self.api(f"/chat/sessions/{sid}/messages", {
                "sender_type": "user", "content": f'@{name} Reply exactly with [{{"type":"send","to":"you","content":"{token}"}}]. Do not use tools or change files.',
                "meta": {"client_message_id": str(uuid.uuid4())}})
            deliveries = response["deliveries"]
            if not deliveries:
                raise RuntimeError(f"No delivery for {name}")
            deadline = time.monotonic() + self.args.timeout
            while time.monotonic() < deadline:
                runtime = self.api(f"/chat/sessions/{sid}/runtime?include_messages=true")
                member = next(row for row in self.api(f"/chat/sessions/{sid}/agents")
                              if row["id"] == case["session_agent_id"])
                pending = any(q["status"] in ("queued", "starting", "processing", "running", "waiting_approval", "stopping")
                              for q in runtime["queues"])
                if member["state"] not in ("running", "stopping", "waitingapproval") and not runtime["active_runs"] and not pending:
                    break
                time.sleep(2)
            else:
                self.api(f"/chat/sessions/{sid}/agents/{case['session_agent_id']}/stop", {})
                raise TimeoutError(f"{name} exceeded {self.args.timeout}s; stopped")
            messages = runtime.get("messages") or []
            reply = any(m["sender_type"] == "agent" and token in m["content"] for m in messages)
            # Read only this test session's run records, never the user's database.
            with sqlite3.connect(f"file:{self.data / 'db.sqlite'}?mode=ro", uri=True) as db:
                db.row_factory = sqlite3.Row
                row = db.execute("SELECT * FROM chat_runs WHERE session_id=? ORDER BY run_index DESC LIMIT 1",
                                 (uuid.UUID(sid).bytes,)).fetchone()
            evidence = {"reply_received": reply, "state": member["state"],
                        "previous_runtime_session_id": before,
                        "runtime_session_id": member["agent_session_id"],
                        "message_id": response["message"]["id"]}
            evidence["delivery_failures"] = [item["message"].get("failure_reason")
                for q in runtime["queues"] for item in q["items"]
                if item["message"].get("failure_reason")]
            if row:
                evidence["run_id"] = str(uuid.UUID(bytes=row["id"]))
                evidence["run_dir"] = row["run_dir"]
                meta_path = Path(row["meta_path"]) if row["meta_path"] else None
                if meta_path and meta_path.exists():
                    meta = json.loads(meta_path.read_text())
                    evidence["meta"] = {k: meta.get(k) for k in (
                        "status", "model", "model_name", "error_summary", "error_type",
                        "token_usage", "agent_session_id", "resumed_from_session_id") if k in meta}
            case["turns"].append(evidence)
            save(self.receipt_path, self.receipt)
            print(json.dumps({name: evidence}, ensure_ascii=False), flush=True)

    def verify(self):
        checks = {}
        for name, case in self.receipt["cases"].items():
            members = self.api(f"/projects/{case['project_id']}/members")
            member = next(row for row in members if row["id"] == case["member_id"])
            session = self.api(f"/chat/sessions/{case['session_id']}/agents")
            agent = next(row for row in session if row["id"] == case["session_agent_id"])
            checks[name] = {"member_config_persisted": member["execution_config"] == case["config"],
                "session_config_persisted": agent["execution_config"] == case["config"],
                "runtime_session_persisted": not case["turns"] or agent["agent_session_id"] == case["turns"][-1]["runtime_session_id"]}
        runners = self.api("/agents/runtime")["runners"]
        checks["catalog_persisted"] = all(
            next(r for r in runners if r["runner_type"] == name)["discovered_models"] == row["discovered_models"]
            for name, row in self.receipt["discovery"].items())
        self.record("persistence", checks)
        assert checks["catalog_persisted"] and all(all(v.values()) for k, v in checks.items() if isinstance(v, dict))

    def failure_cache(self):
        """Fail a real discovery process without changing its runtime configuration."""
        shim = self.root / "discovery-shim.py"
        marker = self.root / "fail-discovery"
        shim.write_text("import os, sys\nfrom pathlib import Path\n"
            + f"if Path({str(marker)!r}).exists(): sys.exit(7)\n"
            + "os.execvp('npx', ['npx', '-y', '@openai/codex@0.167.0', *sys.argv[1:]])\n")
        runner = next(r for r in self.api("/agents/runtime")["runners"] if r["runner_type"] == "CODEX")
        previous = runner["executor_options"]
        query = urllib.parse.urlencode({"workspace_path": str(self.workspace)})
        def refresh():
            result = self.api("/agents/runtime/refresh?" + query, {}, timeout=300)
            return next(r for r in result["runners"] if r["runner_type"] == "CODEX")
        try:
            self.api("/agents/runtime/CODEX", {"executor_options": {
                **previous, "base_command_override": "python3 " + shlex.quote(str(shim))}}, "PATCH")
            healthy = refresh()
            assert healthy["model_source"] == "runner" and healthy["model_details"]
            marker.touch()
            failed = refresh()
            checks = {"error_reported": bool(failed["last_error"]),
                "model_ids_preserved": failed["discovered_models"] == healthy["discovered_models"],
                "model_capabilities_preserved": failed["model_details"] == healthy["model_details"]}
            self.record("failed_refresh", checks)
            assert all(checks.values()), checks
        finally:
            marker.unlink(missing_ok=True)
            self.api("/agents/runtime/CODEX", {"executor_options": previous}, "PATCH")
            restored = refresh()
            self.record("discovery_restored", restored["discovered_models"] ==
                        self.receipt["discovery"]["CODEX"]["discovered_models"] and not restored["last_error"])

    def audit(self):
        outcomes = {}
        for name, case in self.receipt["cases"].items():
            turns = []
            for turn in case["turns"]:
                proof = {"reply_received": turn["reply_received"], "run_id": turn.get("run_id"),
                         "resume_requested": bool(turn["previous_runtime_session_id"])}
                log = Path(turn["run_dir"]) / "raw.tail.log" if turn.get("run_dir") else None
                if log and log.exists():
                    for line in log.read_text(errors="replace").splitlines():
                        try:
                            event = json.loads(line)
                        except ValueError:
                            continue
                        result = event.get("result")
                        if isinstance(result, dict) and "thread" in result and "model" in result:
                            proof.update(runtime_model=result["model"], effort=result.get("reasoningEffort"),
                                         prior_turns=len(result["thread"].get("turns", [])))
                        if event.get("type") == "system" and event.get("subtype") == "init":
                            proof["runtime_model"] = event["model"]
                        if event.get("type") == "result" and event.get("is_error"):
                            proof["api_error_status"] = event.get("api_error_status")
                            if "CodingPlan subscription" in str(result):
                                proof["blocker"] = "Current Claude provider: CodingPlan subscription invalid or expired"
                        for option in event.get("payload", {}).get("ConfigOptions", []):
                            if option.get("category") == "model":
                                proof["runtime_model"] = option["currentValue"]
                            if option.get("category") == "thought_level":
                                proof["effort"] = option["currentValue"]
                if name == "invalid-effort":
                    messages = self.api(f"/chat/sessions/{case['session_id']}/messages")
                    proof["rejected_before_execution"] = any("does not support reasoning effort ultra" in m["content"] for m in messages)
                elif proof.get("reply_received"):
                    proof["selection_confirmed"] = proof.get("runtime_model") == case["config"]["model_name"] and proof.get("effort") == case["config"]["thinking_effort"]
                turns.append(proof)
            outcomes[name] = turns
        self.record("execution_audit", outcomes)
        statuses = {}
        for name, turns in outcomes.items():
            if name == "invalid-effort":
                passed = bool(turns) and turns[-1].get("rejected_before_execution")
            else:
                passed = len(turns) >= 2 and turns[-1]["resume_requested"] and all(
                    turn.get("reply_received") and turn.get("selection_confirmed") for turn in turns)
            statuses[name] = "passed" if passed else (
                "blocked" if any(turn.get("blocker") for turn in turns) else "failed")
        overall = "failed" if "failed" in statuses.values() else (
            "blocked" if "blocked" in statuses.values() else "passed")
        persisted = self.receipt.get("persistence", {})
        prerequisites = {
            "catalogs_match": len(self.receipt.get("cli_catalog_matches", {})) == 3
                and all(self.receipt["cli_catalog_matches"].values()),
            "persistence_verified": bool(persisted) and all(
                all(value.values()) if isinstance(value, dict) else value for value in persisted.values()),
            "failed_refresh_preserves_cache": len(self.receipt.get("failed_refresh", {})) == 3
                and all(self.receipt["failed_refresh"].values()),
            "normal_discovery_restored": self.receipt.get("discovery_restored", False),
        }
        if not all(prerequisites.values()):
            overall = "failed"
        self.record("acceptance_status", {"overall": overall, "cases": statuses, "prerequisites": prerequisites})
        # A provider/account blocker is distinct from a successful acceptance.
        if overall != "passed":
            raise SystemExit(2 if overall == "blocked" else 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=["prepare", "start", "stop", "restart", "discover", "baseline", "create", "turn", "verify", "failure-cache", "audit"])
    parser.add_argument("--report-dir", default=str(REPO / ".openteams/qa/model-config-20261125"))
    parser.add_argument("--port", type=int, default=24080)
    parser.add_argument("--case", choices=list(CASES))
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--resume", action="store_true", help="Send another turn only to cases with a successful previous reply")
    args = parser.parse_args()
    acceptance = Acceptance(args)
    if args.phase == "restart":
        acceptance.stop()
        acceptance.start()
    else:
        getattr(acceptance, args.phase.replace("-", "_"))()


if __name__ == "__main__":
    main()
