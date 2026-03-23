#!/usr/bin/env bun
/**
 * Build script for openteams-cli cross-platform binaries.
 *
 * Reuses the package-local openteams-cli build pipeline so Solid plugins,
 * worker entrypoints, and compile-time defines stay in sync.
 *
 * Usage:
 *   bun run scripts/build-openteams-cli.ts                     # build for current platform
 *   bun run scripts/build-openteams-cli.ts --target linux-x64  # cross-compile one target
 *   bun run scripts/build-openteams-cli.ts --all               # all platforms
 *
 * Output: binaries/ directory
 */

import { execFileSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(import.meta.dir, "..");
const CLI_DIR = join(ROOT, "openteams-cli");
const CLI_PACKAGE_DIR = join(CLI_DIR, "packages", "openteams-cli");
const CLI_PACKAGE_JSON_PATH = join(CLI_PACKAGE_DIR, "package.json");
const OUT_DIR = join(ROOT, "binaries");
const BUN_EXECUTABLE = process.execPath;
const CLI_PACKAGE_VERSION = JSON.parse(
  readFileSync(CLI_PACKAGE_JSON_PATH, "utf8")
).version as string;

interface Target {
  name: string;
  packageTarget: string;
  distName: string;
  outputName: string;
  binaryName: string;
  aliases?: string[];
}

const TARGETS: Target[] = [
  {
    name: "linux-x64",
    packageTarget: "linux-x64",
    distName: "openteams-cli-linux-x64",
    outputName: "openteams-cli-linux-x64",
    binaryName: "openteams-cli",
  },
  {
    name: "linux-arm64",
    packageTarget: "linux-arm64",
    distName: "openteams-cli-linux-arm64",
    outputName: "openteams-cli-linux-arm64",
    binaryName: "openteams-cli",
  },
  {
    name: "darwin-x64",
    packageTarget: "darwin-x64",
    distName: "openteams-cli-darwin-x64",
    outputName: "openteams-cli-darwin-x64",
    binaryName: "openteams-cli",
    aliases: ["macos-x64"],
  },
  {
    name: "darwin-arm64",
    packageTarget: "darwin-arm64",
    distName: "openteams-cli-darwin-arm64",
    outputName: "openteams-cli-darwin-arm64",
    binaryName: "openteams-cli",
    aliases: ["macos-arm64"],
  },
  {
    name: "windows-x64",
    packageTarget: "windows-x64",
    distName: "openteams-cli-windows-x64",
    outputName: "openteams-cli-windows-x64.exe",
    binaryName: "openteams-cli.exe",
  },
];

function getCurrentTarget(): Target {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "linux" && arch === "x64") return TARGETS[0];
  if (platform === "linux" && arch === "arm64") return TARGETS[1];
  if (platform === "darwin" && arch === "x64") return TARGETS[2];
  if (platform === "darwin" && arch === "arm64") return TARGETS[3];
  if (platform === "win32" && arch === "x64") return TARGETS[4];

  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

function isNativeTarget(target?: Target): boolean {
  if (!target) return true;
  return target.name === getCurrentTarget().name;
}

function resolveTarget(name: string): Target | undefined {
  return TARGETS.find(
    (target) => target.name === name || target.aliases?.includes(name)
  );
}

function getRequestedTargetArg(args: string[]): string | undefined {
  const targetIndex = args.indexOf("--target");
  if (targetIndex >= 0) {
    return args[targetIndex + 1];
  }

  const inlineArg = args.find((arg) => arg.startsWith("--target="));
  return inlineArg?.slice("--target=".length);
}

function runPackageBuild(args: string[]): void {
  const buildEnv = {
    ...process.env,
    NODE_ENV: "production",
    OPENTEAMS_VERSION: process.env.OPENTEAMS_VERSION || CLI_PACKAGE_VERSION,
    OPENTEAMS_CHANNEL:
      process.env.OPENTEAMS_CHANNEL ||
      (CLI_PACKAGE_VERSION.startsWith("0.0.0-") ? "preview" : "latest"),
  };

  execFileSync(BUN_EXECUTABLE, args, {
    cwd: CLI_DIR,
    stdio: "inherit",
    env: buildEnv,
  });
}

function runCliBuild(target?: Target): void {
  const buildArgs = [
    "run",
    "--cwd",
    "packages/openteams-cli",
    "script/build.ts",
  ];

  if (isNativeTarget(target)) {
    buildArgs.push("--skip-install");
  }

  if (target) {
    buildArgs.push("--target", target.packageTarget);
  } else {
    buildArgs.push("--single");
  }

  runPackageBuild(buildArgs);
}

function runAllCliBuilds(): void {
  runPackageBuild([
    "run",
    "--cwd",
    "packages/openteams-cli",
    "script/build.ts",
  ]);
}

function getBuiltBinaryPath(target: Target): string {
  return join(CLI_PACKAGE_DIR, "dist", target.distName, "bin", target.binaryName);
}

function copyBuiltBinary(target: Target, writeDefaultAlias: boolean): void {
  const sourcePath = getBuiltBinaryPath(target);
  const outputPath = join(OUT_DIR, target.outputName);
  if (!existsSync(sourcePath)) {
    throw new Error(`Built binary not found: ${sourcePath}`);
  }

  copyFileSync(sourcePath, outputPath);
  console.log(`[build] Built ${target.name} -> ${outputPath}`);

  if (writeDefaultAlias) {
    const defaultAliasPath = join(OUT_DIR, target.binaryName);
    copyFileSync(sourcePath, defaultAliasPath);
    console.log(`[build] Updated default alias -> ${defaultAliasPath}`);
  }
}

function installDeps(): void {
  if (!existsSync(join(CLI_DIR, "node_modules"))) {
    console.log("[build] Installing dependencies...");
    execFileSync(BUN_EXECUTABLE, ["install"], {
      cwd: CLI_DIR,
      stdio: "inherit",
    });
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const requestedTargetArg = getRequestedTargetArg(args);

  if (!existsSync(CLI_DIR)) {
    console.error(
      `Error: openteams-cli directory not found at ${CLI_DIR}.\nRun TASK-B1 first to prepare CLI source.`
    );
    process.exit(1);
  }

  if (requestedTargetArg === undefined && args.includes("--target")) {
    console.error(
      `Missing value for --target.\nAvailable: ${TARGETS.flatMap((target) => [target.name, ...(target.aliases ?? [])]).join(", ")}`
    );
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  installDeps();

  if (args.includes("--all")) {
    console.log("[build] Building all platforms...");
    runAllCliBuilds();
    for (const target of TARGETS) copyBuiltBinary(target, false);
  } else if (requestedTargetArg) {
    const target = resolveTarget(requestedTargetArg);
    if (!target) {
      console.error(
        `Unknown target: ${requestedTargetArg}\nAvailable: ${TARGETS.flatMap((item) => [item.name, ...(item.aliases ?? [])]).join(", ")}`
      );
      process.exit(1);
    }

    console.log(`\n[build] Building ${target.name}`);
    runCliBuild(target);
    copyBuiltBinary(target, true);
  } else {
    const target = getCurrentTarget();
    console.log(`\n[build] Building ${target.name}`);
    runCliBuild();
    copyBuiltBinary(target, true);
  }

  console.log(`\n[build] Done. Binaries at: ${OUT_DIR}`);
}

main();
