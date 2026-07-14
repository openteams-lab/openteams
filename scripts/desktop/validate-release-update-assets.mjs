import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = {
    assetsDir: '',
    releaseTag: '',
    config: 'src-tauri/tauri.conf.json',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--assets-dir') {
      args.assetsDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--release-tag') {
      args.releaseTag = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--config') {
      args.config = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }

  if (!args.assetsDir || !args.releaseTag) {
    throw new Error('--assets-dir and --release-tag are required.');
  }

  return args;
}

function decodeMinisignText(value, label) {
  let decoded;
  try {
    decoded = Buffer.from(value, 'base64').toString('utf8');
  } catch (error) {
    throw new Error(`Invalid ${label} base64: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!decoded || decoded.includes('\ufffd')) {
    throw new Error(`Invalid ${label} base64 text.`);
  }
  return decoded;
}

function minisignPublicKeyObject(publicKey) {
  const text = decodeMinisignText(publicKey, 'updater public key');
  const raw = Buffer.from(text.split(/\r?\n/).find((line) => line && !line.startsWith('untrusted comment:')) || '', 'base64');
  if (raw.length !== 42 || raw.subarray(0, 2).toString() !== 'Ed') {
    throw new Error('Updater public key is not a valid Minisign key.');
  }
  return {
    key: crypto.createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        raw.subarray(10),
      ]),
      format: 'der',
      type: 'spki',
    }),
    keyId: raw.subarray(2, 10),
  };
}

function verifyMinisignSignature(data, signature, publicKey, basename) {
  const text = decodeMinisignText(signature, `signature for ${basename}`);
  const lines = text.split(/\r?\n/).filter(Boolean);
  const rawSignature = Buffer.from(lines[1] || '', 'base64');
  if (rawSignature.length !== 74 || rawSignature.subarray(0, 2).toString() !== 'Ed') {
    throw new Error(`Updater signature is not a valid Minisign signature for ${basename}.`);
  }
  if (!rawSignature.subarray(2, 10).equals(publicKey.keyId)) {
    throw new Error(`Updater signature key id does not match configured public key for ${basename}.`);
  }
  const verified = crypto.verify(
    null,
    data,
    publicKey.key,
    rawSignature.subarray(10),
  );
  if (!verified) {
    throw new Error(`Updater signature does not verify with configured public key for ${basename}.`);
  }
  const trustedComment = lines[2] || '';
  if (!trustedComment.startsWith('trusted comment: ')) {
    throw new Error(`Updater signature has no valid trusted comment for ${basename}.`);
  }
  const globalSignature = Buffer.from(lines[3] || '', 'base64');
  if (
    globalSignature.length !== 64 ||
    !crypto.verify(
      null,
      Buffer.concat([rawSignature.subarray(10), Buffer.from(trustedComment.slice(17))]),
      publicKey.key,
      globalSignature,
    )
  ) {
    throw new Error(`Updater global signature does not verify for ${basename}.`);
  }
}

function normalizeVersion(raw) {
  return String(raw).trim().replace(/^v/i, '');
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolutePath)));
      continue;
    }
    files.push(absolutePath);
  }
  return files;
}

async function buildAssetMap(assetsDir) {
  const files = await walk(assetsDir);
  const assets = new Map();

  for (const file of files) {
    const name = path.basename(file);
    if (assets.has(name)) {
      throw new Error(`Duplicate release asset name: ${name}`);
    }
    assets.set(name, file);
  }

  return assets;
}

function requireAsset(assets, name) {
  const value = assets.get(name);
  if (!value) {
    throw new Error(`Missing required release asset: ${name}`);
  }
  return value;
}

function parseAllowedManifestUrl(raw, releaseTag) {
  const url = new URL(raw);
  const segments = url.pathname.split('/').filter(Boolean);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    segments.length < 6 ||
    segments[0] !== 'openteams-lab' ||
    segments[1] !== 'openteams' ||
    segments[2] !== 'releases' ||
    segments[3] !== 'download' ||
    segments[4] !== releaseTag
  ) {
    throw new Error(`Manifest URL is not a trusted release asset: ${raw}`);
  }
  return decodeURIComponent(segments.slice(5).join('/'));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function architecturePattern(architecture) {
  return {
    aarch64: '(?:aarch64|arm64)',
    x86_64: '(?:x86_64|amd64|x64)',
    i686: '(?:i686|i386|x86)',
  }[architecture];
}

function ensureManifestEntryShape(platformKey, basename, releaseVersion) {
  const version = escapeRegExp(normalizeVersion(releaseVersion));
  if (/^darwin-(aarch64|x86_64)$/.test(platformKey)) {
    const architecture = architecturePattern(platformKey.slice('darwin-'.length));
    if (!new RegExp(`^openteams[_-]v?${version}[_-]${architecture}\\.app\\.tar\\.gz$`).test(basename)) {
      throw new Error(`Darwin updater must be a .app.tar.gz archive: ${basename}`);
    }
    return 'darwin';
  }
  if (/^linux-(aarch64|x86_64|i686)$/.test(platformKey)) {
    const architecture = architecturePattern(platformKey.slice('linux-'.length));
    if (!new RegExp(`^openteams[_-]v?${version}[_-]${architecture}\\.AppImage\\.tar\\.gz$`).test(basename)) {
      throw new Error(`Linux updater must be a .AppImage.tar.gz archive: ${basename}`);
    }
    return 'linux';
  }
  if (/^windows-(aarch64|x86_64|i686)$/.test(platformKey)) {
    const architecture = architecturePattern(platformKey.slice('windows-'.length));
    if (!new RegExp(`^openteams[_-]v?${version}[_-]${architecture}(?:[_-][A-Za-z0-9-]+)?\\.msi\\.zip$`).test(basename)) {
      throw new Error(`Windows updater must be a .msi.zip archive: ${basename}`);
    }
    return 'windows';
  }
  throw new Error(`Unsupported manifest platform key: ${platformKey}`);
}

function readPackageVersion(packagePath) {
  const packageJson = execFileSync(
    'tar',
    ['-xOf', packagePath, 'package/package.json'],
    { encoding: 'utf8' }
  );
  return normalizeVersion(JSON.parse(packageJson).version);
}

function readTarEntries(archivePath) {
  return execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
}

function readTarEntry(archivePath, entry) {
  return execFileSync('tar', ['-xOf', archivePath, entry]);
}

function expectedArchitecture(platformKey) {
  return platformKey.split('-').slice(1).join('-');
}

function machoArchitectures(buffer) {
  if (buffer.length < 8) return [];
  const magic = buffer.readUInt32BE(0);
  const mapCpuType = (value) => ({
    0x0100000c: 'aarch64',
    0x01000007: 'x86_64',
    0x00000007: 'i686',
  }[value]);
  if (magic === 0xcffaedfe) return [mapCpuType(buffer.readUInt32LE(4))].filter(Boolean);
  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    const count = buffer.readUInt32BE(4);
    const stride = magic === 0xcafebabf ? 32 : 20;
    const architectures = [];
    for (let index = 0; index < count; index += 1) {
      const offset = 8 + index * stride;
      if (offset + 4 > buffer.length) break;
      const architecture = mapCpuType(buffer.readUInt32BE(offset));
      if (architecture && !architectures.includes(architecture)) architectures.push(architecture);
    }
    return architectures;
  }
  return [];
}

function elfArchitecture(buffer) {
  if (buffer.length < 20 || buffer.subarray(0, 4).toString('hex') !== '7f454c46') return null;
  const machine = buffer.readUInt16LE(18);
  return { 0x3e: 'x86_64', 0xb7: 'aarch64', 0x03: 'i686' }[machine] || null;
}

function canonicalArchitecture(value) {
  return {
    amd64: 'x86_64',
    x64: 'x86_64',
    arm64: 'aarch64',
    i386: 'i686',
    x86: 'i686',
  }[value] || value;
}

function validateUpdaterArchive(assets, platformKey, basename) {
  const architecture = expectedArchitecture(platformKey);
  if (platformKey.startsWith('darwin-')) {
    const entries = readTarEntries(requireAsset(assets, basename));
    const executable = entries.find((entry) => /\.app\/Contents\/MacOS\/openteams$/.test(entry));
    if (!executable) throw new Error(`Darwin updater archive has no app executable: ${basename}`);
    const actual = machoArchitectures(readTarEntry(requireAsset(assets, basename), executable));
    if (!actual.includes(architecture)) throw new Error(`Darwin updater architecture mismatch for ${basename}`);
    return;
  }
  if (platformKey.startsWith('linux-')) {
    const rawName = basename.replace(/\.tar\.gz$/, '');
    const raw = requireAsset(assets, rawName);
    const entries = readTarEntries(requireAsset(assets, basename));
    if (!entries.includes(rawName)) throw new Error(`AppImage archive does not contain ${rawName}`);
    const actual = elfArchitecture(readFileSync(raw));
    if (actual !== architecture) throw new Error(`AppImage architecture mismatch for ${rawName}`);
  }
}

function validateDebAsset(debPath, name, releaseVersion) {
  const match = name.match(new RegExp(`^openteams[_-]v?${escapeRegExp(releaseVersion)}[_-](amd64|x86_64|x64|arm64|aarch64|i386|i686|x86)(?:[_-]linux)?\\.deb$`));
  if (!match) return false;
  const members = execFileSync('ar', ['t', debPath], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const controlName = members.find((member) => /^control\.tar\.(gz|xz)$/.test(member));
  if (!members.includes('debian-binary') || !controlName) return false;
  const controlArchive = execFileSync('ar', ['p', debPath, controlName]);
  const control = execFileSync('tar', ['-xOf', '-', './control'], { input: controlArchive, encoding: 'utf8' });
  const architecture = control.match(/^Architecture:\s*(\S+)/m)?.[1];
  const version = control.match(/^Version:\s*(\S+)/m)?.[1];
  return canonicalArchitecture(match[1]) === canonicalArchitecture(architecture || '') && normalizeVersion(version || '') === normalizeVersion(releaseVersion);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const assetsDir = path.resolve(args.assetsDir);
  const assets = await buildAssetMap(assetsDir);

  const manifestPath = requireAsset(assets, 'latest.json');
  const policyPath = requireAsset(assets, 'update-policy.json');
  const config = JSON.parse(await fs.readFile(path.resolve(args.config), 'utf8'));
  const publicKey = config?.tauri?.updater?.pubkey;
  if (typeof publicKey !== 'string' || !publicKey.trim()) {
    throw new Error(`Missing updater public key in ${args.config}`);
  }
  const publicKeyObject = minisignPublicKeyObject(publicKey.trim());

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const policy = JSON.parse(await fs.readFile(policyPath, 'utf8'));

  const normalizedReleaseVersion = normalizeVersion(args.releaseTag);
  if (normalizeVersion(manifest.version) !== normalizedReleaseVersion) {
    throw new Error(
      `Manifest version ${manifest.version} does not match release ${normalizedReleaseVersion}`
    );
  }
  if (
    !manifest.platforms ||
    typeof manifest.platforms !== 'object' ||
    Array.isArray(manifest.platforms) ||
    Object.keys(manifest.platforms).length === 0
  ) {
    throw new Error('latest.json must contain a non-empty platforms object');
  }
  if (typeof policy.linux_appimage_updater !== 'boolean') {
    throw new Error('update-policy.json must define boolean linux_appimage_updater');
  }

  const platformKinds = new Set();
  for (const [platformKey, entry] of Object.entries(manifest.platforms)) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Manifest entry is invalid for ${platformKey}`);
    }
    const basename = parseAllowedManifestUrl(entry.url, args.releaseTag);
    const kind = ensureManifestEntryShape(platformKey, basename, normalizedReleaseVersion);
    platformKinds.add(kind);
    requireAsset(assets, basename);
    if (kind === 'linux') {
      requireAsset(assets, basename.replace(/\.tar\.gz$/, ''));
    }

    const signatureName = `${basename}.sig`;
    const signaturePath = requireAsset(assets, signatureName);
    const manifestSignature = String(entry.signature || '').trim();
    const fileSignature = (await fs.readFile(signaturePath, 'utf8')).trim();
    if (!manifestSignature || !fileSignature) {
      throw new Error(`Updater signature is empty for ${basename}`);
    }
    if (manifestSignature !== fileSignature) {
      throw new Error(`Signature content mismatch for ${basename}`);
    }
    verifyMinisignSignature(
      await fs.readFile(requireAsset(assets, basename)),
      manifestSignature,
      publicKeyObject,
      basename,
    );
    validateUpdaterArchive(assets, platformKey, basename);
  }

  if (!platformKinds.has('darwin')) {
    throw new Error('At least one darwin-* updater entry is required.');
  }

  const debPattern = new RegExp(
    `^openteams[_-]v?${escapeRegExp(normalizedReleaseVersion)}[_-](?:amd64|x86_64|x64|arm64|aarch64|i386|i686|x86)(?:[_-]linux)?\\.deb$`,
  );
  if (![...assets.entries()].some(([name, file]) => debPattern.test(name) && validateDebAsset(file, name, normalizedReleaseVersion))) {
    throw new Error('At least one Linux .deb asset is required.');
  }

  const hasLinuxManifest = [...Object.keys(manifest.platforms)].some((key) =>
    key.startsWith('linux-')
  );
  if (policy.linux_appimage_updater && !hasLinuxManifest) {
    throw new Error('linux-* manifest entries are required when AppImage updater policy is enabled.');
  }
  if (!policy.linux_appimage_updater && hasLinuxManifest) {
    throw new Error('linux-* manifest entries are forbidden when AppImage updater policy is disabled.');
  }

  const packages = [...assets.keys()].filter((name) =>
    new RegExp(`^openteams-v?${escapeRegExp(normalizedReleaseVersion)}\\.tgz$`).test(name)
  );
  if (packages.length !== 1) {
    throw new Error('Expected exactly one validated main Web package.');
  }
  const packageVersion = readPackageVersion(requireAsset(assets, packages[0]));
  if (packageVersion !== normalizedReleaseVersion) {
    throw new Error(
      `Main Web package version ${packageVersion} does not match manifest version ${normalizedReleaseVersion}`
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
