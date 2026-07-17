#!/usr/bin/env node

const { spawn } = require("child_process");
const net = require("net");
const path = require("path");
const { getPorts } = require("./setup-dev-environment");

const repoRoot = path.resolve(__dirname, "..");
const backendStartupTimeoutMs = 5 * 60 * 1000;

function waitForBackend(child, port) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let retryTimer;
    let settled = false;

    const cleanup = () => {
      clearTimeout(retryTimer);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onError = (error) => {
      fail(new Error(`Failed to start backend: ${error.message}`));
    };
    const onExit = (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${code ?? 1}`;
      fail(new Error(`Backend exited before it was ready (${reason})`));
    };
    const check = () => {
      const socket = net.createConnection({ host: "localhost", port });

      socket.once("connect", () => {
        socket.destroy();
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (settled) return;
        if (Date.now() - startedAt >= backendStartupTimeoutMs) {
          fail(
            new Error(
              `Backend did not start within ${backendStartupTimeoutMs / 1000} seconds`,
            ),
          );
          return;
        }
        retryTimer = setTimeout(check, 250);
      });
    };

    child.once("error", onError);
    child.once("exit", onExit);
    check();
  });
}

function waitForExit(child, name) {
  return new Promise((resolve) => {
    child.once("error", (error) => {
      console.error(`Failed to start ${name}: ${error.message}`);
      resolve({ code: 1, signal: null });
    });
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

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

  console.log(`Starting backend at http://localhost:${ports.backend}`);

  const backend = spawn(
    pnpm,
    ["run", "backend:dev:watch"],
    {
      cwd: repoRoot,
      env,
      stdio: "inherit",
    },
  );
  const backendExit = waitForExit(backend, "backend");
  const children = [backend];

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill(signal);
        }
      }
    });
  }

  try {
    await waitForBackend(backend, ports.backend);
  } catch (error) {
    if (backend.exitCode === null && backend.signalCode === null) {
      backend.kill("SIGTERM");
    }
    throw error;
  }

  console.log(`Backend is ready at http://localhost:${ports.backend}`);
  console.log(`Starting frontend at ${frontendOrigin}`);

  const frontend = spawn(pnpm, ["run", "frontend:dev"], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  const frontendExit = waitForExit(frontend, "frontend");
  children.push(frontend);

  const result = await Promise.race([backendExit, frontendExit]);

  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }
  process.exitCode = result.signal ? 1 : (result.code ?? 1);
}

main().catch((error) => {
  console.error(`Failed to prepare development environment: ${error.message}`);
  process.exitCode = 1;
});
