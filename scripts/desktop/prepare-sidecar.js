const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const isRelease = args.includes('--release');
const profile = isRelease ? 'release' : 'debug';

function resolveCargo() {
  if (process.env.CARGO) return process.env.CARGO;
  if (process.platform === 'win32') {
    const home = process.env.USERPROFILE;
    if (home) {
      const candidate = path.join(home, '.cargo', 'bin', 'cargo.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return 'cargo';
}

const cargo = resolveCargo();
const root = path.join(__dirname, '..', '..');
const targetDir = path.join(root, 'target', profile);
const binName = process.platform === 'win32' ? 'server.exe' : 'server';
const binPath = path.join(targetDir, binName);
const outDir = path.join(root, 'src-tauri', 'bin');
const outPath = path.join(outDir, binName);

function inferTargetTriple() {
  const arch = process.arch;
  if (process.platform === 'win32') {
    return arch === 'arm64'
      ? 'aarch64-pc-windows-msvc'
      : 'x86_64-pc-windows-msvc';
  }
  if (process.platform === 'darwin') {
    return arch === 'arm64'
      ? 'aarch64-apple-darwin'
      : 'x86_64-apple-darwin';
  }
  if (process.platform === 'linux') {
    return arch === 'arm64'
      ? 'aarch64-unknown-linux-gnu'
      : 'x86_64-unknown-linux-gnu';
  }
  return '';
}

const targetTriple =
  process.env.TAURI_TARGET_TRIPLE ||
  process.env.TAURI_ENV_TARGET ||
  process.env.TARGET ||
  inferTargetTriple();

const cargoArgs = ['build', '--bin', 'server'];
if (isRelease) cargoArgs.splice(1, 0, '--release');

const result = spawnSync(cargo, cargoArgs, {
  cwd: root,
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(binPath)) {
  console.error(`Expected backend binary not found at ${binPath}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(binPath, outPath);
if (process.platform !== 'win32') {
  fs.chmodSync(outPath, 0o755);
}

if (targetTriple) {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const triplePath = path.join(outDir, `server-${targetTriple}${ext}`);
  fs.copyFileSync(binPath, triplePath);
  if (process.platform !== 'win32') {
    fs.chmodSync(triplePath, 0o755);
  }
  console.log(`Sidecar prepared: ${triplePath}`);
}

console.log(`Sidecar prepared: ${outPath}`);
