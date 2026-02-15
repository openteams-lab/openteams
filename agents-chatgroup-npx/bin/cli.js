#!/usr/bin/env node

const { execSync, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const https = require("https");
const readline = require("readline");

const CLI_VERSION = require("../package.json").version;

// ================================
// Configuration
// ================================

const REPO_URL = "https://github.com/anthropics/agents-chatgroup.git";
const INSTALL_DIR = path.join(os.homedir(), ".agents-chatgroup");
const SOURCE_DIR = path.join(INSTALL_DIR, "source");
const CONFIG_DIR = path.join(INSTALL_DIR, "config");

// ================================
// Platform Detection
// ================================

function getPlatformInfo() {
  const platform = process.platform;
  const arch = process.arch;

  const osNames = {
    darwin: "macOS",
    linux: "Linux",
    win32: "Windows"
  };

  return {
    platform,
    arch,
    osName: osNames[platform] || platform,
    isWindows: platform === "win32",
    isMac: platform === "darwin",
    isLinux: platform === "linux"
  };
}

const platformInfo = getPlatformInfo();

// ================================
// UI Helpers
// ================================

function printBanner() {
  console.log("");
  console.log("  ╔═══════════════════════════════════════════════╗");
  console.log("  ║         🤖 Agents Chatgroup Installer         ║");
  console.log("  ╚═══════════════════════════════════════════════╝");
  console.log("");
}

function printSystemInfo() {
  console.log(`  📍 Platform: ${platformInfo.osName} ${platformInfo.arch}`);
  console.log(`  📦 Version:  v${CLI_VERSION}`);
  console.log(`  📂 Install:  ${INSTALL_DIR}`);
  console.log("");
}

function printStep(step, message) {
  console.log(`  [${step}] ${message}`);
}

function printSuccess(message) {
  console.log(`  ✅ ${message}`);
}

function printError(message) {
  console.error(`  ❌ ${message}`);
}

function printWarning(message) {
  console.log(`  ⚠️  ${message}`);
}

// ================================
// Command Execution
// ================================

function execCommand(command, options = {}) {
  const defaultOptions = {
    encoding: "utf8",
    stdio: options.silent ? "pipe" : "inherit",
    shell: true,
    ...options
  };

  try {
    return execSync(command, defaultOptions);
  } catch (error) {
    if (!options.ignoreError) {
      throw error;
    }
    return null;
  }
}

function commandExists(command) {
  try {
    const checkCmd = platformInfo.isWindows
      ? `where ${command}`
      : `command -v ${command}`;
    execSync(checkCmd, { stdio: "pipe", encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

// ================================
// Dependency Checking
// ================================

function checkDependencies() {
  printStep("1/4", "Checking dependencies...");

  const dependencies = [];

  // Check Node.js version
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  if (nodeMajor < 18) {
    printError(`Node.js 18+ required (found ${nodeVersion})`);
    process.exit(1);
  }
  dependencies.push({ name: "Node.js", version: nodeVersion, status: "✓" });

  // Check npm
  if (!commandExists("npm")) {
    printError("npm is required but not found");
    process.exit(1);
  }
  const npmVersion = execSync("npm --version", { encoding: "utf8" }).trim();
  dependencies.push({ name: "npm", version: `v${npmVersion}`, status: "✓" });

  // Check Git
  if (!commandExists("git")) {
    printError("Git is required but not found");
    printError("Please install Git: https://git-scm.com/downloads");
    process.exit(1);
  }
  const gitVersion = execSync("git --version", { encoding: "utf8" })
    .trim()
    .replace("git version ", "");
  dependencies.push({ name: "Git", version: gitVersion, status: "✓" });

  // Check Rust (optional for build)
  let rustStatus = "○ (optional)";
  if (commandExists("rustc")) {
    const rustVersion = execSync("rustc --version", { encoding: "utf8" })
      .trim()
      .replace("rustc ", "");
    rustStatus = "✓";
    dependencies.push({ name: "Rust", version: rustVersion, status: rustStatus });
  } else {
    dependencies.push({ name: "Rust", version: "not installed", status: rustStatus });
  }

  // Print dependency table
  console.log("");
  console.log("     Dependency  Version              Status");
  console.log("     ─────────────────────────────────────────");
  for (const dep of dependencies) {
    const name = dep.name.padEnd(11);
    const version = dep.version.padEnd(20);
    console.log(`     ${name}  ${version} ${dep.status}`);
  }
  console.log("");

  return dependencies;
}

// ================================
// Installation
// ================================

async function cloneOrUpdateRepo() {
  printStep("2/4", "Getting source code...");

  if (fs.existsSync(SOURCE_DIR)) {
    // Update existing repo
    console.log("       Updating existing installation...");
    try {
      execCommand(`git -C "${SOURCE_DIR}" fetch origin`, { silent: true });
      execCommand(`git -C "${SOURCE_DIR}" reset --hard origin/main`, { silent: true });
      execCommand(`git -C "${SOURCE_DIR}" pull origin main`, { silent: true });
      console.log("       Source code updated.");
    } catch (error) {
      printWarning("Update failed, re-cloning...");
      fs.rmSync(SOURCE_DIR, { recursive: true, force: true });
      execCommand(`git clone --depth 1 ${REPO_URL} "${SOURCE_DIR}"`);
    }
  } else {
    // Fresh clone
    console.log("       Cloning repository...");
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
    execCommand(`git clone --depth 1 ${REPO_URL} "${SOURCE_DIR}"`);
  }

  console.log("");
}

async function installDependencies() {
  printStep("3/4", "Installing dependencies...");

  const frontendDir = path.join(SOURCE_DIR, "frontend");

  if (fs.existsSync(frontendDir)) {
    console.log("       Installing frontend dependencies...");
    execCommand(`npm install`, { cwd: frontendDir });
  }

  // Check for other package.json in subdirectories
  const serverDir = path.join(SOURCE_DIR, "server");
  if (fs.existsSync(path.join(serverDir, "package.json"))) {
    console.log("       Installing server dependencies...");
    execCommand(`npm install`, { cwd: serverDir });
  }

  console.log("");
}

async function buildProject() {
  printStep("4/4", "Building project...");

  // Build frontend
  const frontendDir = path.join(SOURCE_DIR, "frontend");
  if (fs.existsSync(frontendDir)) {
    console.log("       Building frontend...");
    execCommand(`npm run build`, { cwd: frontendDir, ignoreError: true });
  }

  // Build Rust backend if Cargo.toml exists and Rust is installed
  const cargoToml = path.join(SOURCE_DIR, "Cargo.toml");
  if (fs.existsSync(cargoToml) && commandExists("cargo")) {
    console.log("       Building Rust backend...");
    execCommand(`cargo build --release`, { cwd: SOURCE_DIR, ignoreError: true });
  }

  console.log("");
}

// ================================
// Running the Application
// ================================

function findExecutable() {
  // Check for pre-built binary
  const binaryName = platformInfo.isWindows ? "server.exe" : "server";
  const binaryPaths = [
    path.join(SOURCE_DIR, "target", "release", binaryName),
    path.join(SOURCE_DIR, "target", "debug", binaryName),
    path.join(SOURCE_DIR, "dist", binaryName)
  ];

  for (const binPath of binaryPaths) {
    if (fs.existsSync(binPath)) {
      return { type: "binary", path: binPath };
    }
  }

  // Check for Node.js entry point
  const nodeEntryPoints = [
    path.join(SOURCE_DIR, "server", "index.js"),
    path.join(SOURCE_DIR, "server", "src", "index.js"),
    path.join(SOURCE_DIR, "dist", "index.js"),
    path.join(SOURCE_DIR, "index.js")
  ];

  for (const entryPoint of nodeEntryPoints) {
    if (fs.existsSync(entryPoint)) {
      return { type: "node", path: entryPoint };
    }
  }

  // Check package.json for start script
  const pkgPath = path.join(SOURCE_DIR, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (pkg.scripts && pkg.scripts.start) {
      return { type: "npm", cwd: SOURCE_DIR };
    }
  }

  return null;
}

async function runApplication(args = []) {
  const executable = findExecutable();

  if (!executable) {
    printError("Could not find application entry point.");
    printError("Please run the installer first: npx agents-chatgroup install");
    process.exit(1);
  }

  console.log(`  🚀 Starting agents-chatgroup...\n`);

  if (executable.type === "binary") {
    const proc = spawn(executable.path, args, {
      stdio: "inherit",
      cwd: SOURCE_DIR
    });
    proc.on("exit", (code) => process.exit(code || 0));
    proc.on("error", (err) => {
      printError(`Failed to start: ${err.message}`);
      process.exit(1);
    });
  } else if (executable.type === "node") {
    const proc = spawn("node", [executable.path, ...args], {
      stdio: "inherit",
      cwd: SOURCE_DIR
    });
    proc.on("exit", (code) => process.exit(code || 0));
  } else if (executable.type === "npm") {
    execCommand(`npm start -- ${args.join(" ")}`, { cwd: SOURCE_DIR });
  }
}

// ================================
// Commands
// ================================

function showHelp() {
  console.log(`
Usage: npx agents-chatgroup [command] [options]

Commands:
  install       Install/update agents-chatgroup from source
  start         Start the application (default if installed)
  update        Update to the latest version
  uninstall     Remove agents-chatgroup
  status        Show installation status
  --help, -h    Show this help message
  --version     Show version information

Examples:
  npx agents-chatgroup                # Install and start
  npx agents-chatgroup install        # Install only
  npx agents-chatgroup start          # Start if installed
  npx agents-chatgroup update         # Update to latest

Supported Platforms:
  - macOS (Intel & Apple Silicon)
  - Linux (x64 & ARM64)
  - Windows (x64 & ARM64)

For more information, visit: https://github.com/anthropics/agents-chatgroup
`);
}

function showStatus() {
  printBanner();

  console.log("  Installation Status\n");

  if (fs.existsSync(SOURCE_DIR)) {
    printSuccess("Installed");
    console.log(`     Location: ${SOURCE_DIR}`);

    // Get current version from git
    try {
      const gitHash = execSync(`git -C "${SOURCE_DIR}" rev-parse --short HEAD`, {
        encoding: "utf8"
      }).trim();
      console.log(`     Version:  ${gitHash}`);
    } catch {}

    // Get last update time
    try {
      const gitDate = execSync(
        `git -C "${SOURCE_DIR}" log -1 --format=%ci`,
        { encoding: "utf8" }
      ).trim();
      console.log(`     Updated:  ${gitDate}`);
    } catch {}
  } else {
    printWarning("Not installed");
    console.log("     Run: npx agents-chatgroup install");
  }

  console.log("");
}

async function uninstall() {
  printBanner();
  printStep("1/1", "Uninstalling agents-chatgroup...");

  if (fs.existsSync(INSTALL_DIR)) {
    fs.rmSync(INSTALL_DIR, { recursive: true, force: true });
    printSuccess("Uninstalled successfully");
  } else {
    printWarning("agents-chatgroup is not installed");
  }

  console.log("");
}

// ================================
// Main Entry Point
// ================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Handle help
  if (command === "--help" || command === "-h") {
    printBanner();
    showHelp();
    return;
  }

  // Handle version
  if (command === "--version" || command === "-v") {
    console.log(`agents-chatgroup CLI v${CLI_VERSION}`);
    return;
  }

  // Handle status
  if (command === "status") {
    showStatus();
    return;
  }

  // Handle uninstall
  if (command === "uninstall") {
    await uninstall();
    return;
  }

  // Handle install
  if (command === "install" || command === "update") {
    printBanner();
    printSystemInfo();

    checkDependencies();
    await cloneOrUpdateRepo();
    await installDependencies();
    await buildProject();

    printSuccess("Installation complete!");
    console.log("");
    console.log("  To start the application, run:");
    console.log("    npx agents-chatgroup start");
    console.log("");
    return;
  }

  // Handle start (explicit)
  if (command === "start") {
    if (!fs.existsSync(SOURCE_DIR)) {
      printBanner();
      printSystemInfo();
      printWarning("agents-chatgroup is not installed. Installing now...\n");
      checkDependencies();
      await cloneOrUpdateRepo();
      await installDependencies();
      await buildProject();
      printSuccess("Installation complete!\n");
    }
    await runApplication(args.slice(1));
    return;
  }

  // Default behavior: install if not installed, then start
  printBanner();
  printSystemInfo();

  if (!fs.existsSync(SOURCE_DIR)) {
    console.log("  First time setup - installing agents-chatgroup...\n");
    checkDependencies();
    await cloneOrUpdateRepo();
    await installDependencies();
    await buildProject();
    printSuccess("Installation complete!\n");
  }

  await runApplication(args);
}

main().catch((err) => {
  console.error("");
  printError(`Fatal error: ${err.message}`);
  if (process.env.AGENTS_CHATGROUP_DEBUG) {
    console.error(err.stack);
  }
  console.error("");
  process.exit(1);
});
