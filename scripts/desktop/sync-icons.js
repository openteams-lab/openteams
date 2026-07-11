const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const sourceSvg = path.join(
  root,
  'frontend',
  'public',
  'logos',
  'openteams-logo.svg'
);
const iconsDir = path.join(root, 'src-tauri', 'icons');
const syncedSvg = path.join(iconsDir, 'logo_black.svg');
const iconSquarePng = path.join(iconsDir, 'icon-square.png');
const tauriCli = path.join(
  root,
  'node_modules',
  '@tauri-apps',
  'cli',
  'tauri.js'
);

function commandExists(command) {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(lookup, [command], { stdio: 'ignore' });
  return result.status === 0;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  });

  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n');
    throw new Error(
      `${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`
    );
  }

  return result;
}

function renderWithQuickLook(inputSvg, outputPng) {
  if (process.platform !== 'darwin' || !commandExists('qlmanage')) {
    return false;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openteams-icon-'));
  run('qlmanage', ['-t', '-s', '1024', '-o', tempDir, inputSvg]);

  const rendered = path.join(tempDir, `${path.basename(inputSvg)}.png`);
  if (!fs.existsSync(rendered)) {
    throw new Error(`qlmanage did not produce ${rendered}`);
  }

  fs.copyFileSync(rendered, outputPng);
  fs.rmSync(tempDir, { recursive: true, force: true });
  return true;
}

function renderWithSips(inputSvg, outputPng) {
  if (process.platform !== 'darwin' || !commandExists('sips')) {
    return false;
  }

  run('sips', [
    '-z',
    '1024',
    '1024',
    '-s',
    'format',
    'png',
    inputSvg,
    '--out',
    outputPng,
  ]);
  return true;
}

function renderWithRsvg(inputSvg, outputPng) {
  if (!commandExists('rsvg-convert')) {
    return false;
  }

  run('rsvg-convert', ['-w', '1024', '-h', '1024', '-o', outputPng, inputSvg]);
  return true;
}

function renderWithImageMagick(inputSvg, outputPng) {
  if (commandExists('magick')) {
    run('magick', [
      '-background',
      'none',
      inputSvg,
      '-resize',
      '1024x1024',
      outputPng,
    ]);
    return true;
  }

  if (commandExists('convert')) {
    run('convert', [
      '-background',
      'none',
      inputSvg,
      '-resize',
      '1024x1024',
      outputPng,
    ]);
    return true;
  }

  return false;
}

function renderSourcePng(inputSvg, outputPng) {
  if (renderWithSips(inputSvg, outputPng)) return;
  if (renderWithQuickLook(inputSvg, outputPng)) return;
  if (renderWithRsvg(inputSvg, outputPng)) return;
  if (renderWithImageMagick(inputSvg, outputPng)) return;

  if (fs.existsSync(iconSquarePng)) {
    console.warn(
      'No SVG renderer found; using existing src-tauri/icons/icon-square.png.'
    );
    fs.copyFileSync(iconSquarePng, outputPng);
    return;
  }

  throw new Error(
    'No SVG renderer found. Install rsvg-convert or ImageMagick, or run this script on macOS.'
  );
}

function createDesktopSourceSvg(outputSvg) {
  const source = fs.readFileSync(sourceSvg);
  const encodedSource = source.toString('base64');

  fs.writeFileSync(
    outputSvg,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#FFFFFF"/>
  <image width="1024" height="1024" href="data:image/svg+xml;base64,${encodedSource}"/>
</svg>
`
  );
}

function syncIcons() {
  if (!fs.existsSync(sourceSvg)) {
    throw new Error(`Missing desktop icon source: ${sourceSvg}`);
  }
  if (!fs.existsSync(tauriCli)) {
    throw new Error(`Missing Tauri CLI: ${tauriCli}. Run pnpm install first.`);
  }

  fs.mkdirSync(iconsDir, { recursive: true });
  fs.copyFileSync(sourceSvg, syncedSvg);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openteams-icon-'));
  const desktopSvg = path.join(tempDir, 'openteams-desktop-logo.svg');
  const sourcePng = path.join(tempDir, 'openteams-logo.png');
  const generatedDir = path.join(tempDir, 'generated');

  try {
    fs.mkdirSync(generatedDir, { recursive: true });
    createDesktopSourceSvg(desktopSvg);
    renderSourcePng(desktopSvg, sourcePng);
    run(process.execPath, [tauriCli, 'icon', sourcePng, '-o', generatedDir], {
      stdio: 'inherit',
    });
    for (const fileName of ['icon.icns', 'icon.ico', 'icon.png']) {
      fs.copyFileSync(
        path.join(generatedDir, fileName),
        path.join(iconsDir, fileName)
      );
    }
    fs.copyFileSync(sourcePng, iconSquarePng);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(
    'Desktop icons synced from frontend/public/logos/openteams-logo.svg'
  );
}

try {
  syncIcons();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
