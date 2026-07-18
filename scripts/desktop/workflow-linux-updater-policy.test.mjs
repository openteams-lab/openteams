import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

async function readWorkflow(name) {
  return fs.readFile(path.join(root, '.github', 'workflows', name), 'utf8');
}

function assertConditionalLinuxBuilds(source, workflowName) {
  assert.match(
    source,
    /name: Build desktop bundle \(Linux with AppImage updater\)[\s\S]*if: matrix\.platform == 'linux' && env\.ENABLE_LINUX_APPIMAGE_UPDATER == 'true'[\s\S]*pnpm tauri build --bundles deb,appimage,updater/,
    `${workflowName} must only build AppImage updater artifacts when the policy is enabled`
  );
  assert.match(
    source,
    /name: Build desktop bundle \(Linux deb only\)[\s\S]*if: matrix\.platform == 'linux' && env\.ENABLE_LINUX_APPIMAGE_UPDATER != 'true'[\s\S]*pnpm tauri build --bundles deb/,
    `${workflowName} must still build the deb package when the AppImage updater policy is disabled`
  );
}

function assertUnsignedMacDistribution(source, workflowName) {
  assert.match(
    source,
    /ENABLE_MACOS_DMG: "true"/,
    `${workflowName} must build a macOS DMG`
  );
  assert.match(
    source,
    /UNSIGNED-MACOS-README\.txt/,
    `${workflowName} must include unsigned macOS launch instructions`
  );
  assert.match(
    source,
    /SHA256SUMS-macos\.txt/,
    `${workflowName} must include checksums for macOS artifacts`
  );
  assert.match(
    source,
    /\$\{dmg%\.dmg\}-unsigned\.dmg/,
    `${workflowName} must label unsigned DMG filenames`
  );
}

test('desktop-build workflow gates Linux AppImage updater bundles behind policy', async () => {
  const source = await readWorkflow('desktop-build.yml');
  assertConditionalLinuxBuilds(source, 'desktop-build.yml');
});

test('desktop-build defaults to a clearly labelled unsigned macOS DMG', async () => {
  const source = await readWorkflow('desktop-build.yml');
  assert.match(
    source,
    /macos_sign_and_notarize:[\s\S]*default: false/,
    'desktop-build.yml must work without paid Apple signing credentials by default'
  );
  assert.match(source, /name=desktop-macos-unsigned/);
  assertUnsignedMacDistribution(source, 'desktop-build.yml');
});

test('pre-release workflow gates Linux AppImage updater bundles behind policy', async () => {
  const source = await readWorkflow('pre-release.yml');
  assertConditionalLinuxBuilds(source, 'pre-release.yml');
});

test('pre-release falls back to a documented unsigned macOS DMG', async () => {
  const source = await readWorkflow('pre-release.yml');
  assert.match(source, /artifact_name=desktop-installer-macos-unsigned/);
  assert.match(source, /## macOS unsigned build/);
  assertUnsignedMacDistribution(source, 'pre-release.yml');
});

test('pre-release workflow validates release assets before creating the GitHub release', async () => {
  const source = await readWorkflow('pre-release.yml');
  const validateIndex = source.indexOf('name: Validate release update assets before GitHub release');
  const aliasIndex = source.indexOf('name: Stage stable desktop download aliases');
  const createIndex = source.indexOf('name: Create GitHub Release');

  assert.notEqual(validateIndex, -1, 'pre-release.yml must validate release assets before publishing');
  assert.notEqual(aliasIndex, -1, 'pre-release.yml must stage stable desktop download aliases');
  assert.notEqual(createIndex, -1, 'pre-release.yml must still create the GitHub release');
  assert.ok(validateIndex < aliasIndex, 'versionless aliases must be staged after versioned asset validation');
  assert.ok(aliasIndex < createIndex, 'desktop aliases must be staged before Create GitHub Release');
  assert.match(
    source,
    /node scripts\/desktop\/validate-release-update-assets\.mjs[\s\S]*--assets-dir release-assets[\s\S]*--release-tag "\$\{\{ needs\.bump-version\.outputs\.new_tag \}\}"/,
    'pre-release.yml must run the full release validator against release-assets before publishing'
  );
  for (const alias of [
    'openteams-windows-x64.msi',
    'openteams-linux-amd64.deb',
    'openteams-macos.dmg',
  ]) {
    assert.match(source, new RegExp(alias.replace('.', '\\.')));
  }
});
