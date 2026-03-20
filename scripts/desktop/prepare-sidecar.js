const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const isRelease = args.includes('--release');
const profile = isRelease ? 'release' : 'debug';
const skipCli = args.includes('--skip-cli');

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

function resolveBun() {
  if (process.env.BUN) return process.env.BUN;
  if (process.platform === 'win32') {
    const home = process.env.USERPROFILE;
    if (home) {
      const candidate = path.join(home, '.bun', 'bin', 'bun.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return 'bun';
}

const cargo = resolveCargo();
const bun = resolveBun();
const root = path.join(__dirname, '..', '..');
const targetDir = path.join(root, 'target', profile);
const binName = process.platform === 'win32' ? 'server.exe' : 'server';
const binPath = path.join(targetDir, binName);
const outDir = path.join(root, 'src-tauri', 'bin');
const outPath = path.join(outDir, binName);
const cliBinName = process.platform === 'win32' ? 'openteams-cli.exe' : 'openteams-cli';

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

const cliTargetsByTriple = {
  'x86_64-unknown-linux-gnu': {
    buildTarget: 'linux-x64',
    outputName: 'openteams-cli-linux-x64',
  },
  'aarch64-unknown-linux-gnu': {
    buildTarget: 'linux-arm64',
    outputName: 'openteams-cli-linux-arm64',
  },
  'x86_64-unknown-linux-musl': {
    buildTarget: 'linux-x64',
    outputName: 'openteams-cli-linux-x64',
  },
  'aarch64-unknown-linux-musl': {
    buildTarget: 'linux-arm64',
    outputName: 'openteams-cli-linux-arm64',
  },
  'x86_64-pc-windows-msvc': {
    buildTarget: 'windows-x64',
    outputName: 'openteams-cli-windows-x64.exe',
  },
  'x86_64-apple-darwin': {
    buildTarget: 'darwin-x64',
    outputName: 'openteams-cli-darwin-x64',
  },
  'aarch64-apple-darwin': {
    buildTarget: 'darwin-arm64',
    outputName: 'openteams-cli-darwin-arm64',
  },
};

function inferCliTarget() {
  if (process.platform === 'win32' && process.arch === 'x64') {
    return cliTargetsByTriple['x86_64-pc-windows-msvc'];
  }
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return cliTargetsByTriple['aarch64-apple-darwin'];
  }
  if (process.platform === 'darwin' && process.arch === 'x64') {
    return cliTargetsByTriple['x86_64-apple-darwin'];
  }
  if (process.platform === 'linux' && process.arch === 'arm64') {
    return cliTargetsByTriple['aarch64-unknown-linux-gnu'];
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return cliTargetsByTriple['x86_64-unknown-linux-gnu'];
  }
  return null;
}

function resolveCliTarget() {
  if (targetTriple && cliTargetsByTriple[targetTriple]) {
    return cliTargetsByTriple[targetTriple];
  }
  return inferCliTarget();
}

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

// Build and copy CLI binary
if (!skipCli) {
  const cliOutPath = path.join(outDir, cliBinName);
  const cliSourceDir = path.join(root, 'openteams-cli');
  const cliTarget = resolveCliTarget();
  
  if (fs.existsSync(cliSourceDir)) {
    if (!cliTarget) {
      console.warn(
        `[cli] Warning: unsupported CLI target ${
          targetTriple || `${process.platform}-${process.arch}`
        }, continuing without CLI`
      );
    } else {
      console.log(`\n[cli] Building openteams-cli for ${cliTarget.buildTarget}...`);

      const cliBuildArgs = [
        path.join(root, 'scripts', 'build-openteams-cli.ts'),
        '--target',
        cliTarget.buildTarget,
      ];
      const cliBuildResult = spawnSync(bun, cliBuildArgs, {
        cwd: root,
        stdio: 'inherit',
      });
      
      if (cliBuildResult.status !== 0) {
        console.warn('[cli] Warning: CLI build failed, continuing without CLI');
      } else {
        const cliBuildDir = path.join(root, 'binaries');
        const cliBuildPath = path.join(cliBuildDir, cliTarget.outputName);
        
        if (fs.existsSync(cliBuildPath)) {
          fs.copyFileSync(cliBuildPath, cliOutPath);
          if (process.platform !== 'win32') {
            fs.chmodSync(cliOutPath, 0o755);
          }
          console.log(`[cli] CLI prepared: ${cliOutPath}`);
          
          if (targetTriple) {
            const ext = process.platform === 'win32' ? '.exe' : '';
            const cliTriplePath = path.join(outDir, `openteams-cli-${targetTriple}${ext}`);
            fs.copyFileSync(cliBuildPath, cliTriplePath);
            if (process.platform !== 'win32') {
              fs.chmodSync(cliTriplePath, 0o755);
            }
            console.log(`[cli] CLI prepared: ${cliTriplePath}`);
          }
        } else {
          console.warn(`[cli] Warning: CLI binary not found at ${cliBuildPath}`);
        }
      }
    }
  } else {
    console.log('[cli] Skipping CLI build (openteams-cli directory not found)');
  }
}
