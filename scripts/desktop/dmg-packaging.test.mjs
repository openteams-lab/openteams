import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';

import { findDmgFiles, parseArgs, styleDmg } from './style-dmg.mjs';

const root = process.cwd();
const expectedDmgConfig = {
  background: 'dmg/background.png',
  windowSize: { width: 660, height: 400 },
  appPosition: { x: 180, y: 212 },
  applicationFolderPosition: { x: 480, y: 212 },
};

test('release and development configs share the styled DMG layout', () => {
  for (const configName of ['tauri.conf.json', 'tauri.dev.conf.json']) {
    const config = JSON.parse(
      readFileSync(join(root, 'src-tauri', configName), 'utf8')
    );
    assert.deepEqual(config.tauri.bundle.dmg, expectedDmgConfig);
  }
});

test('DMG background matches the configured Finder window size', () => {
  const background = PNG.sync.read(
    readFileSync(join(root, 'src-tauri', 'dmg', 'background.png'))
  );

  assert.equal(background.width, expectedDmgConfig.windowSize.width);
  assert.equal(background.height, expectedDmgConfig.windowSize.height);
});

test('desktop and signed release builds preserve the styled DMG template', () => {
  const packageJson = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8')
  );
  assert.match(
    packageJson.scripts['desktop:build'],
    /style-dmg\.mjs --all/
  );

  for (const workflowName of ['desktop-build.yml', 'pre-release.yml']) {
    const workflow = readFileSync(
      join(root, '.github', 'workflows', workflowName),
      'utf8'
    );
    assert.match(workflow, /style-dmg\.mjs \\\n\s+--dmg "\$template_dmg" \\\n\s+--app 'signed\/openteams\.app'/);
    assert.doesNotMatch(
      workflow,
      /hdiutil create -volname 'openteams' -srcfolder 'signed\/openteams\.app'/
    );
  }
});

test('DMG styling arguments support in-place and signed-app modes', () => {
  assert.deepEqual(parseArgs(['--all']), {
    all: true,
    dmg: null,
    app: null,
    output: null,
  });

  const parsed = parseArgs([
    '--dmg',
    'template.dmg',
    '--app',
    'signed/openteams.app',
    '--output',
    'signed.dmg',
  ]);
  assert.equal(parsed.all, false);
  assert.equal(parsed.dmg, join(root, 'template.dmg'));
  assert.equal(parsed.app, join(root, 'signed', 'openteams.app'));
  assert.equal(parsed.output, join(root, 'signed.dmg'));
});

test('DMG discovery ignores the derived signed image', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'openteams-dmg-test-'));
  try {
    writeFileSync(join(fixture, 'openteams_0.5.0_aarch64.dmg'), 'template');
    writeFileSync(join(fixture, 'openteams-signed.dmg'), 'derived');

    assert.deepEqual(findDmgFiles(fixture), [
      join(fixture, 'openteams_0.5.0_aarch64.dmg'),
    ]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test(
  'styled DMG keeps its volume icon and background invisible',
  { skip: process.platform !== 'darwin' },
  () => {
    const fixture = mkdtempSync(join(tmpdir(), 'openteams-dmg-mount-test-'));
    const source = join(fixture, 'source');
    const replacementApp = join(fixture, 'replacement', 'Test.app');
    const mount = join(fixture, 'mount');
    const dmg = join(fixture, 'fixture.dmg');
    const signedDmg = join(fixture, 'signed.dmg');
    let mounted = false;

    try {
      mkdirSync(join(source, '.background'), { recursive: true });
      mkdirSync(join(source, 'Test.app'), { recursive: true });
      mkdirSync(replacementApp, { recursive: true });
      mkdirSync(mount);
      writeFileSync(join(source, 'Test.app', 'build.txt'), 'unsigned');
      writeFileSync(join(replacementApp, 'build.txt'), 'signed');
      copyFileSync(
        join(root, 'src-tauri', 'icons', 'icon.icns'),
        join(source, '.VolumeIcon.icns')
      );
      copyFileSync(
        join(root, 'src-tauri', 'dmg', 'background.png'),
        join(source, '.background', 'background.png')
      );

      execFileSync('/usr/bin/hdiutil', [
        'create',
        '-volname',
        'openteams DMG Test',
        '-srcfolder',
        source,
        '-format',
        'UDZO',
        dmg,
      ]);
      styleDmg({ dmg, app: replacementApp, output: signedDmg });
      execFileSync('/usr/bin/hdiutil', [
        'attach',
        '-noverify',
        '-noautoopen',
        '-mountpoint',
        mount,
        signedDmg,
      ]);
      mounted = true;

      const volumeIconAttributes = execFileSync(
        '/usr/bin/GetFileInfo',
        ['-a', join(mount, '.VolumeIcon.icns')],
        { encoding: 'utf8' }
      ).trim();
      const backgroundAttributes = execFileSync(
        '/usr/bin/GetFileInfo',
        ['-a', join(mount, '.background')],
        { encoding: 'utf8' }
      ).trim();

      assert.match(volumeIconAttributes, /V/);
      assert.match(backgroundAttributes, /V/);
      assert.equal(
        readFileSync(join(mount, 'Test.app', 'build.txt'), 'utf8'),
        'signed'
      );
    } finally {
      if (mounted) {
        execFileSync('/usr/bin/hdiutil', ['detach', mount, '-force']);
      }
      rmSync(fixture, { recursive: true, force: true });
    }
  }
);
