import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8')
);
const tauriConfig = JSON.parse(
  readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8')
);
const tauriDevConfig = JSON.parse(
  readFileSync(join(root, 'src-tauri', 'tauri.dev.conf.json'), 'utf8')
);

test('desktop:dev prepares the sidecar before launching tauri dev', () => {
  const desktopDev = packageJson.scripts['desktop:dev'];

  assert.match(
    desktopDev,
    /prepare-sidecar\.js --debug/,
    'desktop:dev should prepare the debug sidecar before invoking tauri dev'
  );
});

test('desktop:dev skips cli sidecar build and uses the dev-specific tauri config', () => {
  const desktopDev = packageJson.scripts['desktop:dev'];

  assert.match(
    desktopDev,
    /prepare-sidecar\.js --debug --skip-cli/,
    'desktop:dev should skip openteams-cli sidecar preparation in debug mode'
  );
  assert.match(
    desktopDev,
    /tauri dev --config src-tauri\/tauri\.dev\.conf\.json/,
    'desktop:dev should launch tauri dev with the debug-only config override'
  );
});

test('beforeDevCommand does not prepare the sidecar during tauri dev startup', () => {
  const beforeDevCommand = tauriConfig.build.beforeDevCommand ?? '';

  assert.ok(
    !beforeDevCommand.includes('prepare-sidecar.js'),
    'beforeDevCommand should not build sidecars because tauri dev does not wait for it to finish before Rust build starts'
  );
});

test('tauri dev override keeps bundle identifier while narrowing external bins', () => {
  const expected = structuredClone(tauriConfig);
  expected.tauri.bundle.externalBin = ['bin/server'];

  assert.deepEqual(
    tauriDevConfig,
    expected,
    'tauri.dev.conf.json must be a complete standalone config because Tauri validates the override file independently before build'
  );
});
