import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const defaultDmgDir = join(
  root,
  'src-tauri',
  'target',
  'release',
  'bundle',
  'dmg'
);

function usage() {
  return [
    'Usage:',
    '  node scripts/desktop/style-dmg.mjs --all',
    '  node scripts/desktop/style-dmg.mjs --dmg <template.dmg> [--app <signed.app>] [--output <styled.dmg>]',
  ].join('\n');
}

export function parseArgs(argv) {
  const options = { all: false, dmg: null, app: null, output: null };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--all') {
      options.all = true;
      continue;
    }
    if (['--dmg', '--app', '--output'].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}\n${usage()}`);
      }
      options[argument.slice(2)] = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}\n${usage()}`);
  }

  if (options.all === Boolean(options.dmg)) {
    throw new Error(`Choose exactly one of --all or --dmg\n${usage()}`);
  }
  if (options.all && (options.app || options.output)) {
    throw new Error(`--app and --output require --dmg\n${usage()}`);
  }
  if (options.output && !options.app) {
    throw new Error(`--output requires --app\n${usage()}`);
  }

  return options;
}

export function findDmgFiles(directory = defaultDmgDir) {
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter(
      (fileName) =>
        fileName.endsWith('.dmg') && fileName !== 'openteams-signed.dmg'
    )
    .sort()
    .map((fileName) => join(directory, fileName));
}

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

function findMountedApp(mountPath) {
  const appNames = readdirSync(mountPath).filter((name) => name.endsWith('.app'));
  if (appNames.length !== 1) {
    throw new Error(
      `Expected one .app in ${mountPath}, found ${appNames.length}`
    );
  }
  return join(mountPath, appNames[0]);
}

export function styleDmg({ dmg, app = null, output = null }) {
  if (!existsSync(dmg)) throw new Error(`DMG not found: ${dmg}`);
  if (app && !existsSync(app)) throw new Error(`App bundle not found: ${app}`);

  const outputPath = output ?? dmg;
  const workDir = mkdtempSync(join(tmpdir(), 'openteams-dmg-'));
  const writableDmg = join(workDir, 'writable.dmg');
  const compressedDmg = join(workDir, 'styled.dmg');
  const mountPath = join(workDir, 'mount');
  const adjacentOutput = `${outputPath}.styled-${process.pid}`;
  let mounted = false;

  mkdirSync(mountPath);

  try {
    run('/usr/bin/hdiutil', [
      'convert',
      dmg,
      '-format',
      'UDRW',
      '-o',
      writableDmg,
    ]);
    run('/usr/bin/hdiutil', [
      'attach',
      '-readwrite',
      '-noverify',
      '-noautoopen',
      '-mountpoint',
      mountPath,
      writableDmg,
    ]);
    mounted = true;

    if (app) {
      const mountedApp = findMountedApp(mountPath);
      const mountedAppName = basename(mountedApp);
      rmSync(mountedApp, { recursive: true, force: true });
      run('/usr/bin/ditto', [app, join(mountPath, mountedAppName)]);
    }

    const volumeIcon = join(mountPath, '.VolumeIcon.icns');
    if (!existsSync(volumeIcon)) {
      throw new Error(`Volume icon not found in DMG: ${volumeIcon}`);
    }
    run('/usr/bin/SetFile', ['-a', 'V', volumeIcon]);

    const backgroundDirectory = join(mountPath, '.background');
    if (existsSync(backgroundDirectory)) {
      run('/usr/bin/SetFile', ['-a', 'V', backgroundDirectory]);
    }

    rmSync(join(mountPath, '.fseventsd'), { recursive: true, force: true });
    run('/bin/sync', []);
    run('/usr/bin/hdiutil', ['detach', mountPath]);
    mounted = false;

    run('/usr/bin/hdiutil', [
      'convert',
      writableDmg,
      '-format',
      'UDZO',
      '-imagekey',
      'zlib-level=9',
      '-o',
      compressedDmg,
    ]);

    mkdirSync(dirname(outputPath), { recursive: true });
    copyFileSync(compressedDmg, adjacentOutput);
    renameSync(adjacentOutput, outputPath);
    console.log(`Styled DMG written to ${outputPath}`);
  } finally {
    if (mounted) {
      try {
        run('/usr/bin/hdiutil', ['detach', mountPath, '-force']);
      } catch {
        console.error(`Failed to detach temporary DMG mount: ${mountPath}`);
      }
    }
    rmSync(adjacentOutput, { force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (process.platform !== 'darwin') {
    console.log('Skipping DMG styling because this is not macOS.');
    return;
  }

  if (options.all) {
    const dmgFiles = findDmgFiles();
    if (dmgFiles.length === 0) {
      throw new Error(`No DMG files found under ${defaultDmgDir}`);
    }
    for (const dmg of dmgFiles) styleDmg({ dmg });
    return;
  }

  styleDmg(options);
}

const isEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
