#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");
const { getPorts } = require("./setup-dev-environment");

const repoRoot = path.resolve(__dirname, "..");

async function main() {
  const ports = await getPorts();
  const frontendOrigin = `http://localhost:${ports.frontend}`;
  const env = {
    ...process.env,
    FRONTEND_PORT: String(ports.frontend),
    BACKEND_PORT: String(ports.backend),
    VK_ALLOWED_ORIGINS: process.env.VK_ALLOWED_ORIGINS || frontendOrigin,
  };
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  console.log(`Starting frontend at ${frontendOrigin}`);
  console.log(`Starting backend at http://localhost:${ports.backend}`);

  const child = spawn(
    pnpm,
    [
      "exec",
      "concurrently",
      "--kill-others",
      "--names",
      "backend,frontend",
      "pnpm run backend:dev:watch",
      "pnpm run frontend:dev",
    ],
    {
      cwd: repoRoot,
      env,
      stdio: "inherit",
    },
  );

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
  }

  child.once("error", (error) => {
    console.error(`Failed to start development servers: ${error.message}`);
    process.exitCode = 1;
  });

  child.once("exit", (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}

main().catch((error) => {
  console.error(`Failed to prepare development environment: ${error.message}`);
  process.exitCode = 1;
});
