#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const env = {
  ...process.env,
  DISABLE_WORKTREE_CLEANUP: process.env.DISABLE_WORKTREE_CLEANUP || "1",
  RUST_LOG: process.env.RUST_LOG || "debug",
};

const child = spawn(
  "cargo",
  ["watch", "-w", "crates", "-x", "run --bin server"],
  {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  },
);

child.once("error", (error) => {
  console.error(`Failed to start backend watcher: ${error.message}`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exitCode = code ?? 1;
});
