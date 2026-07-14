import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const scriptPath = path.join(
  root,
  'scripts',
  'desktop',
  'generate-github-updater-json.mjs'
);

const MACH_O_64_LITTLE_ENDIAN_MAGIC = [0xcf, 0xfa, 0xed, 0xfe];
const CPU_TYPE_ARM64 = [0x0c, 0x00, 0x00, 0x01];

async function createMacUpdaterBundle(workspaceDir) {
  const appDir = path.join(
    workspaceDir,
    'openteams.app',
    'Contents',
    'MacOS'
  );
  await fs.mkdir(appDir, { recursive: true });

  const executableHeader = Buffer.from([
    ...MACH_O_64_LITTLE_ENDIAN_MAGIC,
    ...CPU_TYPE_ARM64,
  ]);
  await fs.writeFile(path.join(appDir, 'openteams'), executableHeader);

  const archivePath = path.join(workspaceDir, 'openteams.app.tar.gz');
  execFileSync(
    'tar',
    ['-czf', archivePath, '-C', workspaceDir, 'openteams.app'],
    { cwd: workspaceDir }
  );
  await fs.writeFile(`${archivePath}.sig`, 'fake-signature\n');

  return archivePath;
}

async function createLinuxAppImageBundle(workspaceDir, name = 'openteams-0.3.10-x86_64') {
  const rawPath = path.join(workspaceDir, `${name}.AppImage`);
  await fs.writeFile(rawPath, 'appimage-binary');

  const archivePath = path.join(workspaceDir, `${name}.AppImage.tar.gz`);
  execFileSync(
    'tar',
    ['-czf', archivePath, '-C', workspaceDir, path.basename(rawPath)],
    { cwd: workspaceDir }
  );
  await fs.writeFile(`${archivePath}.sig`, 'linux-signature\n');

  return { rawPath, archivePath };
}

test('updater manifest infers macOS architecture from app bundle contents', async () => {
  const workspaceDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'openteams-updater-test-')
  );

  try {
    await createMacUpdaterBundle(workspaceDir);
    const outputPath = path.join(workspaceDir, 'latest.json');

    execFileSync(
      'node',
      [
        scriptPath,
        '--input-dir',
        workspaceDir,
        '--output',
        outputPath,
        '--owner',
        'openteams-lab',
        '--repo',
        'openteams',
        '--tag',
        'v0.3.10-build-test',
        '--version',
        'v0.3.10-build-test',
      ],
      { cwd: root, stdio: 'pipe' }
    );

    const manifest = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    assert.deepEqual(manifest.platforms, {
      'darwin-aarch64': {
        signature: 'fake-signature',
        url: 'https://github.com/openteams-lab/openteams/releases/download/v0.3.10-build-test/openteams.app.tar.gz',
      },
    });
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('updater manifest emits linux appimage entries when a signed archive exists', async () => {
  const workspaceDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'openteams-updater-linux-test-')
  );

  try {
    await createLinuxAppImageBundle(workspaceDir);
    const outputPath = path.join(workspaceDir, 'latest.json');

    execFileSync(
      'node',
      [
        scriptPath,
        '--input-dir',
        workspaceDir,
        '--output',
        outputPath,
        '--owner',
        'openteams-lab',
        '--repo',
        'openteams',
        '--tag',
        'v0.3.10-build-test',
        '--version',
        'v0.3.10-build-test',
        '--require-linux-appimage',
      ],
      { cwd: root, stdio: 'pipe' }
    );

    const manifest = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    assert.deepEqual(manifest.platforms['linux-x86_64'], {
      signature: 'linux-signature',
      url: 'https://github.com/openteams-lab/openteams/releases/download/v0.3.10-build-test/openteams-0.3.10-x86_64.AppImage.tar.gz',
    });
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('updater manifest rejects duplicate platform keys', async () => {
  const workspaceDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'openteams-updater-duplicate-test-')
  );

  try {
    await createLinuxAppImageBundle(workspaceDir, 'openteams-0.3.10-x86_64');
    await createLinuxAppImageBundle(workspaceDir, 'openteams-0.3.10-amd64');
    const outputPath = path.join(workspaceDir, 'latest.json');

    assert.throws(
      () =>
        execFileSync(
          'node',
          [
            scriptPath,
            '--input-dir',
            workspaceDir,
            '--output',
            outputPath,
            '--owner',
            'openteams-lab',
            '--repo',
            'openteams',
            '--tag',
            'v0.3.10-build-test',
            '--version',
            'v0.3.10-build-test',
            '--require-linux-appimage',
          ],
          { cwd: root, stdio: 'pipe' }
        ),
      /Duplicate updater platform entry/
    );
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('updater manifest rejects empty signature files', async () => {
  const workspaceDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'openteams-updater-empty-signature-test-')
  );

  try {
    const { archivePath } = await createLinuxAppImageBundle(workspaceDir);
    await fs.writeFile(`${archivePath}.sig`, '\n');
    const outputPath = path.join(workspaceDir, 'latest.json');

    assert.throws(
      () =>
        execFileSync(
          'node',
          [
            scriptPath,
            '--input-dir',
            workspaceDir,
            '--output',
            outputPath,
            '--owner',
            'openteams-lab',
            '--repo',
            'openteams',
            '--tag',
            'v0.3.10-build-test',
            '--version',
            'v0.3.10-build-test',
            '--require-linux-appimage',
          ],
          { cwd: root, stdio: 'pipe' }
        ),
      /Updater signature is empty/
    );
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});
