#!/usr/bin/env node

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");

const {
  ensureBinary,
  BINARY_TAG,
  CACHE_DIR,
  LOCAL_DEV_MODE,
  LOCAL_DIST_DIR,
  resolveRemoteSource,
} = require("./download");

const CLI_VERSION = require("../package.json").version;

const APP_NAME = "openteams-cli";
const INSTALL_DIR = path.join(os.homedir(), ".openteams");
const BIN_DIR = path.join(INSTALL_DIR, "bin");

function printInfo(message) {
  console.log(`  ${message}`);
}

function printStep(step, message) {
  console.log(`  [${step}] ${message}`);
}

function printSuccess(message) {
  console.log(`  OK  ${message}`);
}

function printError(message) {
  console.error(`  ERROR  ${message}`);
}

function getEffectiveArch() {
  const platform = process.platform;
  const nodeArch = process.arch;

  if (platform === "darwin") {
    if (nodeArch === "arm64") return "arm64";

    try {
      const translated = execSync("sysctl -in sysctl.proc_translated", {
        encoding: "utf8",
      }).trim();
      if (translated === "1") return "arm64";
    } catch (_err) {}

    return "x64";
  }

  if (/arm/i.test(nodeArch)) {
    return "arm64";
  }

  if (platform === "win32") {
    const architecture = process.env.PROCESSOR_ARCHITECTURE || "";
    const wow64 = process.env.PROCESSOR_ARCHITEW6432 || "";
    if (/arm/i.test(architecture) || /arm/i.test(wow64)) {
      return "arm64";
    }
  }

  return "x64";
}

function getPlatformTarget() {
  const platform = process.platform;
  const arch = getEffectiveArch();

  if (platform === "linux" && arch === "x64") {
    return { platformDir: "linux-x64", note: null };
  }

  if (platform === "linux" && arch === "arm64") {
    return { platformDir: "linux-arm64", note: null };
  }

  if (platform === "darwin" && arch === "x64") {
    return { platformDir: "macos-x64", note: null };
  }

  if (platform === "darwin" && arch === "arm64") {
    return { platformDir: "macos-arm64", note: null };
  }

  if (platform === "win32" && arch === "x64") {
    return { platformDir: "windows-x64", note: null };
  }

  if (platform === "win32" && arch === "arm64") {
    return {
      platformDir: "windows-x64",
      note:
        "Windows ARM64 binary is not published yet. Falling back to windows-x64 binary.",
    };
  }

  printError(`Unsupported platform: ${platform}-${arch}`);
  printError("Supported targets: linux-x64, linux-arm64, macos-x64, macos-arm64, windows-x64");
  process.exit(1);
}

function getBinaryName() {
  return process.platform === "win32" ? `${APP_NAME}.exe` : APP_NAME;
}

function getInstalledBinaryPath() {
  return path.join(BIN_DIR, getBinaryName());
}

function showProgress(downloaded, total) {
  const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
  const downloadedMb = (downloaded / (1024 * 1024)).toFixed(1);
  const totalMb = total > 0 ? (total / (1024 * 1024)).toFixed(1) : "?";
  process.stderr.write(
    `\r   Downloading: ${downloadedMb}MB / ${totalMb}MB (${percent}%)`,
  );
}

function extractBinary(zipPath) {
  fs.mkdirSync(BIN_DIR, { recursive: true });

  const expectedBinaryName = getBinaryName();
  const expectedPath = path.join(BIN_DIR, expectedBinaryName);

  try {
    if (fs.existsSync(expectedPath)) {
      fs.unlinkSync(expectedPath);
    }
  } catch (_err) {}

  const zip = new AdmZip(zipPath);
  zip.extractAllTo(BIN_DIR, true);

  let binaryPath = expectedPath;
  if (!fs.existsSync(binaryPath)) {
    const candidates = fs
      .readdirSync(BIN_DIR)
      .filter((name) =>
        [expectedBinaryName, `${expectedBinaryName}.exe`].includes(name),
      );

    if (candidates.length > 0) {
      binaryPath = path.join(BIN_DIR, candidates[0]);
    }
  }

  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      `Extracted binary not found in ${BIN_DIR}. The archive may be invalid.`,
    );
  }

  if (process.platform !== "win32") {
    try {
      fs.chmodSync(binaryPath, 0o755);
    } catch (_err) {}
  }

  return binaryPath;
}

async function installBinary(options = {}) {
  const { force = false } = options;
  const target = getPlatformTarget();

  if (target.note) {
    console.log(`  WARN  ${target.note}`);
  }

  printStep("1/2", "Preparing binary package...");
  fs.mkdirSync(INSTALL_DIR, { recursive: true });

  if (force) {
    try {
      fs.rmSync(path.join(CACHE_DIR, BINARY_TAG, target.platformDir, `${APP_NAME}.zip`), { force: true });
      fs.rmSync(getInstalledBinaryPath(), { force: true });
    } catch (_err) {}
  }

  printStep("2/2", "Downloading prebuilt binary...");
  let zipPath;
  try {
    zipPath = await ensureBinary(target.platformDir, showProgress);
    if (!LOCAL_DEV_MODE) {
      process.stderr.write("\n");
    }
  } catch (err) {
    process.stderr.write("\n");
    throw new Error(`Download failed: ${err.message}`);
  }

  const binaryPath = extractBinary(zipPath);

  printSuccess(`Installed ${APP_NAME} to ${binaryPath}`);
  return binaryPath;
}

function isInstalled() {
  return fs.existsSync(getInstalledBinaryPath());
}

async function ensureInstalled() {
  if (isInstalled()) {
    return getInstalledBinaryPath();
  }

  printInfo("No local installation found. Installing now...");
  return installBinary();
}

function launchBinary(binaryPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", (err) => reject(err));
    child.on("exit", (code) => resolve(code || 0));

    process.on("SIGINT", () => {
      child.kill("SIGINT");
    });
    process.on("SIGTERM", () => {
      child.kill("SIGTERM");
    });
  });
}

function showHelp() {
  console.log(`
Usage: npx openteams-cli [command] [args]

Commands:
  install       Download and install prebuilt binary only
  update        Force re-download and reinstall
  --help, -h    Show help
  --version     Show CLI version

Default behavior:
  npx openteams-cli
  -> install (if needed) + run CLI

Pass-through args:
  npx openteams-cli -- --help
`);
}

function checkNodeVersion() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (Number.isNaN(major) || major < 18) {
    printError(`Node.js 18+ is required, found v${process.versions.node}`);
    process.exit(1);
  }
}

async function main() {
  checkNodeVersion();

  const rawArgs = process.argv.slice(2);
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
  const command = args[0];

  if (command === "--help" || command === "-h") {
    showHelp();
    return;
  }

  if (command === "--version" || command === "-v") {
    console.log(`${APP_NAME} v${CLI_VERSION}`);
    return;
  }

  if (command === "install") {
    await installBinary();
    console.log("");
    printInfo("Run `npx openteams-cli` to start.");
    return;
  }

  if (command === "update") {
    await installBinary({ force: true });
    console.log("");
    printInfo("Update completed.");
    return;
  }

  let runArgs = args;
  if (command === "start") {
    runArgs = args.slice(1);
  }

  console.log("");
  const binaryPath = await ensureInstalled();
  console.log("");

  const exitCode = await launchBinary(binaryPath, runArgs);
  process.exit(exitCode);
}

main().catch((err) => {
  printError(err.message || String(err));
  if (process.env.OPENTEAMS_DEBUG === "1") {
    console.error(err.stack || err);
  }
  process.exit(1);
});