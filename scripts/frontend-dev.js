#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const frontendPort = process.env.FRONTEND_PORT || "3003";

const child = spawn(
  `pnpm --dir frontend run dev -- --host --port ${frontendPort}`,
  {
    cwd: repoRoot,
    shell: true,
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
