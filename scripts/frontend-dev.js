#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const child = spawn(
  pnpm,
  ["--dir", "frontend", "exec", "vite", "--strictPort"],
  {
    cwd: repoRoot,
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
