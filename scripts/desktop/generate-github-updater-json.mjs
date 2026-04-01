import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const MH_MAGIC = 0xfeedface;
const MH_CIGAM = 0xcefaedfe;
const MH_MAGIC_64 = 0xfeedfacf;
const MH_CIGAM_64 = 0xcffaedfe;
const FAT_MAGIC = 0xcafebabe;
const FAT_CIGAM = 0xbebafeca;
const FAT_MAGIC_64 = 0xcafebabf;
const FAT_CIGAM_64 = 0xbfbafeca;
const CPU_TYPE_X86 = 0x00000007;
const CPU_TYPE_X86_64 = 0x01000007;
const CPU_TYPE_ARM64 = 0x0100000c;

function maybeDetectArch(name) {
  const normalized = name.toLowerCase();
  if (
    normalized.includes('aarch64') ||
    normalized.includes('arm64') ||
    normalized.includes('_arm64') ||
    normalized.includes('-arm64')
  ) {
    return 'aarch64';
  }
  if (
    normalized.includes('x86_64') ||
    normalized.includes('x64') ||
    normalized.includes('amd64')
  ) {
    return 'x86_64';
  }
  if (normalized.includes('i686') || normalized.includes('x86')) {
    return 'i686';
  }
  return null;
}

function parseArgs(argv) {
  const args = {
    inputDir: '',
    output: '',
    owner: 'openteams-lab',
    repo: 'openteams',
    tag: '',
    version: '',
    pubDate: '',
    notesFile: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--input-dir') {
      args.inputDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--output') {
      args.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--owner') {
      args.owner = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--repo') {
      args.repo = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--tag') {
      args.tag = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--version') {
      args.version = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--pub-date') {
      args.pubDate = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--notes-file') {
      args.notesFile = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }

  if (!args.inputDir || !args.output || !args.tag) {
    throw new Error(
      '--input-dir, --output and --tag are required to generate latest.json.'
    );
  }

  if (!args.version) {
    args.version = args.tag;
  }

  return args;
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

function detectArch(name) {
  const arch = maybeDetectArch(name);
  if (arch) {
    return arch;
  }
  throw new Error(`Could not infer architecture from file name: ${name}`);
}

function mapCpuTypeToArch(cpuType) {
  switch (cpuType >>> 0) {
    case CPU_TYPE_ARM64:
      return 'aarch64';
    case CPU_TYPE_X86_64:
      return 'x86_64';
    case CPU_TYPE_X86:
      return 'i686';
    default:
      return null;
  }
}

function parseMachOArchitectures(header) {
  if (header.length < 8) {
    return [];
  }

  const magic = header.readUInt32BE(0);

  if (magic === MH_MAGIC || magic === MH_MAGIC_64) {
    const arch = mapCpuTypeToArch(header.readUInt32BE(4));
    return arch ? [arch] : [];
  }

  if (magic === MH_CIGAM || magic === MH_CIGAM_64) {
    const arch = mapCpuTypeToArch(header.readUInt32LE(4));
    return arch ? [arch] : [];
  }

  const isFat =
    magic === FAT_MAGIC ||
    magic === FAT_CIGAM ||
    magic === FAT_MAGIC_64 ||
    magic === FAT_CIGAM_64;
  if (!isFat) {
    return [];
  }

  const readUInt32 =
    magic === FAT_CIGAM || magic === FAT_CIGAM_64
      ? (offset) => header.readUInt32LE(offset)
      : (offset) => header.readUInt32BE(offset);
  const archStride =
    magic === FAT_MAGIC_64 || magic === FAT_CIGAM_64 ? 32 : 20;
  const archCount = readUInt32(4);
  const architectures = [];

  for (let index = 0; index < archCount; index += 1) {
    const offset = 8 + index * archStride;
    if (offset + 4 > header.length) {
      break;
    }

    const arch = mapCpuTypeToArch(readUInt32(offset));
    if (arch && !architectures.includes(arch)) {
      architectures.push(arch);
    }
  }

  return architectures;
}

async function readMachOHeaderFromAppArchive(absolutePath, fileName) {
  let archiveEntries;
  try {
    const result = await execFile(
      'tar',
      ['-tzf', absolutePath],
      {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    archiveEntries = result.stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch (error) {
    throw new Error(
      `Failed to inspect ${fileName} contents: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const executableEntry = archiveEntries.find((entry) =>
    /\.app\/Contents\/MacOS\/[^/]+$/.test(entry)
  );
  if (!executableEntry) {
    throw new Error(
      `Could not find a macOS executable inside ${fileName}.`
    );
  }

  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'openteams-updater-')
  );

  try {
    await execFile(
      'tar',
      ['-xzf', absolutePath, '-C', tempDir, executableEntry],
      {
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const extractedPath = path.join(tempDir, ...executableEntry.split('/'));
    const handle = await fs.open(extractedPath, 'r');
    try {
      const header = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      return header.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch (error) {
    throw new Error(
      `Failed to extract macOS executable from ${fileName}: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function detectDarwinArchitectures(absolutePath, fileName) {
  const archFromName = maybeDetectArch(fileName);
  if (archFromName) {
    return [archFromName];
  }

  const header = await readMachOHeaderFromAppArchive(absolutePath, fileName);
  const architectures = parseMachOArchitectures(header);
  if (architectures.length > 0) {
    return architectures;
  }

  throw new Error(
    `Could not infer architecture from macOS updater bundle: ${fileName}`
  );
}

async function detectPlatformKeys(absolutePath, fileName) {
  if (fileName.endsWith('.msi.zip')) {
    return [`windows-${detectArch(fileName)}`];
  }
  if (fileName.endsWith('.AppImage.tar.gz')) {
    return [`linux-${detectArch(fileName)}`];
  }
  if (fileName.endsWith('.app.tar.gz')) {
    const architectures = await detectDarwinArchitectures(
      absolutePath,
      fileName
    );
    return architectures.map((arch) => `darwin-${arch}`);
  }
  return [];
}

function buildReleaseAssetUrl(owner, repo, tag, fileName) {
  return `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(
    tag
  )}/${encodeURIComponent(fileName)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputDir = path.resolve(args.inputDir);
  const outputPath = path.resolve(args.output);
  const files = await walk(inputDir);
  const platforms = {};

  for (const absolutePath of files) {
    const fileName = path.basename(absolutePath);
    const platformKeys = await detectPlatformKeys(absolutePath, fileName);
    if (platformKeys.length === 0) {
      continue;
    }

    const signaturePath = `${absolutePath}.sig`;
    let signature = '';
    try {
      signature = (await fs.readFile(signaturePath, 'utf8')).trim();
    } catch (error) {
      throw new Error(
        `Missing updater signature for ${fileName}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    for (const platformKey of platformKeys) {
      platforms[platformKey] = {
        signature,
        url: buildReleaseAssetUrl(args.owner, args.repo, args.tag, fileName),
      };
    }
  }

  if (Object.keys(platforms).length === 0) {
    throw new Error(`No updater bundles found under ${inputDir}`);
  }

  const payload = {
    version: args.version,
    platforms,
  };

  if (args.pubDate) {
    payload.pub_date = args.pubDate;
  }

  if (args.notesFile) {
    const notes = (await fs.readFile(path.resolve(args.notesFile), 'utf8')).trim();
    if (notes) {
      payload.notes = notes;
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Generated GitHub updater manifest at ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
