const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('pngjs');

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
const desktopLogoScale = 1.05;
const windowsCornerRadius = 256;

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

function renderWindowsSourcePng(outputPng) {
  if (process.platform !== 'win32' || !commandExists('magick')) {
    return false;
  }

  const logo = extractSourceLogoImage();
  const dataUrlMatch = logo.href.match(/^data:image\/png;base64,(.+)$/s);
  if (!dataUrlMatch) {
    throw new Error('Desktop icon image layer must contain an embedded PNG.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openteams-icon-layer-'));
  const logoPng = path.join(tempDir, 'logo-layer.png');
  const sourceToDesktopScale = 1024 / 512;
  const width = Math.round(
    logo.width * sourceToDesktopScale * desktopLogoScale
  );
  const height = Math.round(
    logo.height * sourceToDesktopScale * desktopLogoScale
  );
  const originalCenterX =
    (logo.x + logo.width / 2) * sourceToDesktopScale;
  const originalCenterY =
    (logo.y + logo.height / 2) * sourceToDesktopScale;
  const x = Math.round(originalCenterX - width / 2);
  const y = Math.round(originalCenterY - height / 2);

  try {
    fs.writeFileSync(logoPng, Buffer.from(dataUrlMatch[1], 'base64'));
    run('magick', [
      '-size',
      '1024x1024',
      'xc:none',
      '-fill',
      'white',
      '-stroke',
      'none',
      '-draw',
      `roundrectangle 0,0 1023,1023 ${windowsCornerRadius},${windowsCornerRadius}`,
      '(',
      logoPng,
      '-resize',
      `${width}x${height}!`,
      ')',
      '-geometry',
      `+${x}+${y}`,
      '-composite',
      outputPng,
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  return true;
}

function alphaAtPixel(outputPng, x, y) {
  const result = run('magick', [
    outputPng,
    '-crop',
    `1x1+${x}+${y}`,
    '+repage',
    '-alpha',
    'extract',
    '-format',
    '%[fx:mean]',
    'info:',
  ]);
  return Number.parseFloat(result.stdout.trim());
}

function validateWindowsRoundedCorners(outputPng) {
  if (process.platform !== 'win32' || !commandExists('magick')) return;

  const cornerAlpha = alphaAtPixel(outputPng, 0, 0);
  const centerAlpha = alphaAtPixel(outputPng, 512, 512);
  if (cornerAlpha > 0.01 || centerAlpha < 0.99) {
    throw new Error(
      `Generated Windows icon has an invalid rounded mask (corner alpha=${cornerAlpha}, center alpha=${centerAlpha}).`
    );
  }
}

function renderSourcePng(inputSvg, outputPng) {
  if (renderWindowsSourcePng(outputPng)) return;
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

function validateSourcePng(outputPng) {
  const size = fs.statSync(outputPng).size;
  if (size < 4096) {
    throw new Error(
      `Generated desktop icon is unexpectedly small (${size} bytes); refusing to package a blank icon.`
    );
  }

  if (!commandExists('magick')) return;

  const result = run('magick', [
    outputPng,
    '-colorspace',
    'Gray',
    '-format',
    '%[fx:mean]',
    'info:',
  ]);
  const mean = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(mean) || mean > 0.995) {
    throw new Error(
      `Generated desktop icon is blank or nearly white (mean=${result.stdout.trim()}).`
    );
  }

  validateWindowsRoundedCorners(outputPng);
}

function normalizeLinuxPngToRgba(outputPng) {
  // librsvg may encode fully opaque images as RGB, while Tauri requires RGBA.
  const decoded = PNG.sync.read(fs.readFileSync(outputPng));
  const rgba = PNG.sync.write(decoded, {
    colorType: 6,
    inputColorType: 6,
    inputHasAlpha: true,
  });
  fs.writeFileSync(outputPng, rgba);
}

function readSvgNumberAttribute(markup, name) {
  const match = markup.match(new RegExp(`\\s${name}="([^"]+)"`));
  if (!match) {
    throw new Error(`Missing ${name} attribute in desktop icon source image.`);
  }

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${name} attribute in desktop icon source image.`);
  }

  return value;
}

function extractSourceLogoImage() {
  const source = fs.readFileSync(sourceSvg, 'utf8');
  const imageMatch = source.match(/<image\b[^>]*>/);
  if (!imageMatch) {
    throw new Error(`Missing logo image layer in ${sourceSvg}`);
  }

  const imageMarkup = imageMatch[0];
  const hrefMatch = imageMarkup.match(/\shref="([^"]+)"/);
  if (!hrefMatch) {
    throw new Error(`Missing href on logo image layer in ${sourceSvg}`);
  }

  return {
    href: hrefMatch[1],
    x: readSvgNumberAttribute(imageMarkup, 'x'),
    y: readSvgNumberAttribute(imageMarkup, 'y'),
    width: readSvgNumberAttribute(imageMarkup, 'width'),
    height: readSvgNumberAttribute(imageMarkup, 'height'),
  };
}

function createDesktopSourceSvg(outputSvg) {
  const logo = extractSourceLogoImage();
  const sourceToDesktopScale = 1024 / 512;
  const width = logo.width * sourceToDesktopScale * desktopLogoScale;
  const height = logo.height * sourceToDesktopScale * desktopLogoScale;
  const originalCenterX = (logo.x + logo.width / 2) * sourceToDesktopScale;
  const originalCenterY = (logo.y + logo.height / 2) * sourceToDesktopScale;
  const x = originalCenterX - width / 2;
  const y = originalCenterY - height / 2;

  fs.writeFileSync(
    outputSvg,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#FFFFFF"/>
  <image x="${x}" y="${y}" width="${width}" height="${height}" href="${logo.href}"/>
</svg>
`
  );
}

function generatedIconFilesForPlatform() {
  if (process.platform === 'win32') return ['icon.ico', 'icon.png'];
  if (process.platform === 'darwin') return ['icon.icns', 'icon.png'];
  return ['icon.png'];
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
    validateSourcePng(sourcePng);
    if (process.platform === 'linux') {
      normalizeLinuxPngToRgba(sourcePng);
    }
    run(process.execPath, [tauriCli, 'icon', sourcePng, '-o', generatedDir], {
      stdio: 'inherit',
    });
    for (const fileName of generatedIconFilesForPlatform()) {
      fs.copyFileSync(
        path.join(generatedDir, fileName),
        path.join(iconsDir, fileName)
      );
    }
    if (process.platform === 'linux' || process.platform === 'win32') {
      fs.copyFileSync(sourcePng, iconSquarePng);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(
    'Desktop icons synced from frontend/public/logos/openteams-logo.svg'
  );
}

if (require.main === module) {
  try {
    syncIcons();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { normalizeLinuxPngToRgba };
