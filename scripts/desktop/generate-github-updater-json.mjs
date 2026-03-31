import fs from 'node:fs/promises';
import path from 'node:path';

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
  throw new Error(`Could not infer architecture from file name: ${name}`);
}

function detectPlatformKey(fileName) {
  if (fileName.endsWith('.msi.zip')) {
    return `windows-${detectArch(fileName)}`;
  }
  if (fileName.endsWith('.AppImage.tar.gz')) {
    return `linux-${detectArch(fileName)}`;
  }
  if (fileName.endsWith('.app.tar.gz')) {
    return `darwin-${detectArch(fileName)}`;
  }
  return null;
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
    const platformKey = detectPlatformKey(fileName);
    if (!platformKey) {
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

    platforms[platformKey] = {
      signature,
      url: buildReleaseAssetUrl(args.owner, args.repo, args.tag, fileName),
    };
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
