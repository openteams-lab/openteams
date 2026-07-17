#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const useShell = process.platform === "win32";

const child = spawn(
  pnpm,
  ["--dir", "frontend", "exec", "vite", "--strictPort"],
  {
    cwd: repoRoot,
    stdio: "inherit",
    shell: useShell,
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
