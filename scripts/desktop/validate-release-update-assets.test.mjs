import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const scriptPath = path.join(
  root,
  'scripts',
  'desktop',
  'validate-release-update-assets.mjs'
);

async function writeFile(targetPath, content) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content);
}

async function createMainPackageTarball(targetPath, version = '0.4.8') {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openteams-web-pkg-'));
  const packageRoot = path.join(workspaceDir, 'package');
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.writeFile(
    path.join(packageRoot, 'package.json'),
    JSON.stringify(
      {
        name: '@openteams-lab/openteams-web',
        version,
      },
      null,
      2
    )
  );

  execFileSync('tar', ['-czf', targetPath, '-C', workspaceDir, 'package'], {
    cwd: root,
  });
  await fs.rm(workspaceDir, { recursive: true, force: true });
}

function createFixtureSigner() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  const keyId = crypto.randomBytes(8);
  const publicText = `untrusted comment: minisign public key ${keyId.toString('hex').toUpperCase()}\n${Buffer.concat([Buffer.from('Ed'), keyId, publicDer.subarray(-32)]).toString('base64')}\n`;
  return {
    publicKey: Buffer.from(publicText).toString('base64'),
    sign(data) {
      const signature = crypto.sign(null, data, privateKey);
      const trusted = 'trusted comment: timestamp:1700000000\tfile:test';
      const global = crypto.sign(null, Buffer.concat([signature, Buffer.from(trusted.slice(17))]), privateKey);
      const text = `untrusted comment: signature from minisign secret key\n${Buffer.concat([Buffer.from('Ed'), keyId, signature]).toString('base64')}\n${trusted}\n${global.toString('base64')}\n`;
      return Buffer.from(text).toString('base64');
    },
  };
}

async function createMacArchive(targetPath) {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openteams-mac-fixture-'));
  const executableDir = path.join(workspaceDir, 'openteams.app', 'Contents', 'MacOS');
  await fs.mkdir(executableDir, { recursive: true });
  await fs.writeFile(path.join(executableDir, 'openteams'), Buffer.from([
    0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00, 0x00, 0x01,
  ]));
  execFileSync('tar', ['-czf', targetPath, '-C', workspaceDir, 'openteams.app']);
  await fs.rm(workspaceDir, { recursive: true, force: true });
}

async function createLinuxAppImage(targetPath, rawPath) {
  const header = Buffer.alloc(20);
  header.set([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01], 0);
  header.writeUInt16LE(0x3e, 18);
  await fs.writeFile(rawPath, header);
  execFileSync('tar', ['-czf', targetPath, '-C', path.dirname(rawPath), path.basename(rawPath)]);
}

async function createDeb(targetPath, version = '0.4.8') {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openteams-deb-fixture-'));
  const controlDir = path.join(workspaceDir, 'control');
  const dataDir = path.join(workspaceDir, 'data');
  await fs.mkdir(controlDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(workspaceDir, 'debian-binary'), '2.0\n');
  await fs.writeFile(path.join(controlDir, 'control'), `Package: openteams\nVersion: ${version}\nArchitecture: amd64\nDescription: fixture\n`);
  execFileSync('tar', ['-czf', path.join(workspaceDir, 'control.tar.gz'), '-C', controlDir, 'control']);
  execFileSync('tar', ['-czf', path.join(workspaceDir, 'data.tar.gz'), '-C', dataDir, '.']);
  const members = ['debian-binary', 'control.tar.gz', 'data.tar.gz'].map((name) => {
    const data = readFileSync(path.join(workspaceDir, name));
    const header = name.padEnd(16, ' ') +
      `${Math.floor(Date.now() / 1000)}`.padEnd(12, ' ') +
      '0'.padEnd(6, ' ') + '0'.padEnd(6, ' ') +
      '100644'.padEnd(8, ' ') + `${data.length}`.padEnd(10, ' ') + '`\n';
    return Buffer.concat([Buffer.from(header), data, data.length % 2 ? Buffer.from('\n') : Buffer.alloc(0)]);
  });
  await fs.writeFile(targetPath, Buffer.concat([Buffer.from('!<arch>\n'), ...members]));
  await fs.rm(workspaceDir, { recursive: true, force: true });
}

async function createValidReleaseDir({ linuxAppImageUpdater = false, includeDmg = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openteams-release-assets-'));
  const tag = 'v0.4.8';
  const macArchive = 'openteams-0.4.8-x86_64.app.tar.gz';
  const linuxArchive = 'openteams-0.4.8-x86_64.AppImage.tar.gz';
  const debName = 'openteams_0.4.8_amd64-linux.deb';
  const webTarball = 'openteams-0.4.8.tgz';
  const signer = createFixtureSigner();

  await createMacArchive(path.join(dir, macArchive));
  await writeFile(path.join(dir, `${macArchive}.sig`), `${signer.sign(await fs.readFile(path.join(dir, macArchive)))}\n`);
  await createDeb(path.join(dir, debName));
  await createMainPackageTarball(path.join(dir, webTarball));
  const macSignature = (await fs.readFile(path.join(dir, `${macArchive}.sig`), 'utf8')).trim();

  const manifest = {
    version: tag,
    platforms: {
      'darwin-x86_64': {
        signature: macSignature,
        url: `https://github.com/openteams-lab/openteams/releases/download/${tag}/${macArchive}`,
      },
    },
  };

  if (linuxAppImageUpdater) {
    const rawPath = path.join(dir, 'openteams-0.4.8-x86_64.AppImage');
    await createLinuxAppImage(path.join(dir, linuxArchive), rawPath);
    await writeFile(path.join(dir, `${linuxArchive}.sig`), `${signer.sign(await fs.readFile(path.join(dir, linuxArchive)))}\n`);
    const linuxSignature = (await fs.readFile(path.join(dir, `${linuxArchive}.sig`), 'utf8')).trim();
    manifest.platforms['linux-x86_64'] = {
      signature: linuxSignature,
      url: `https://github.com/openteams-lab/openteams/releases/download/${tag}/${linuxArchive}`,
    };
  }

  if (includeDmg) {
    await writeFile(path.join(dir, 'openteams-0.4.8-x86_64.dmg'), 'dmg installer');
  }

  await writeFile(path.join(dir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    path.join(dir, 'tauri.conf.json'),
    `${JSON.stringify({ tauri: { updater: { pubkey: signer.publicKey } } }, null, 2)}\n`,
  );
  await writeFile(
    path.join(dir, 'update-policy.json'),
    `${JSON.stringify({ linux_appimage_updater: linuxAppImageUpdater }, null, 2)}\n`
  );

  return dir;
}

function runValidator(assetsDir, configPath = path.join(assetsDir, 'tauri.conf.json')) {
  return spawnSync(
    process.execPath,
    [scriptPath, '--assets-dir', assetsDir, '--release-tag', 'v0.4.8', '--config', configPath],
    {
      cwd: root,
      encoding: 'utf8',
    }
  );
}

test('production and development updater configs share endpoint and public key', async () => {
  const production = JSON.parse(await fs.readFile(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const development = JSON.parse(await fs.readFile(path.join(root, 'src-tauri', 'tauri.dev.conf.json'), 'utf8'));
  assert.deepEqual(production.tauri.updater.endpoints, development.tauri.updater.endpoints);
  assert.equal(production.tauri.updater.pubkey, development.tauri.updater.pubkey);
  assert.match(production.tauri.updater.pubkey, /^[A-Za-z0-9+/=]+$/);
});

test('validator accepts a valid release directory without dmg', async () => {
  const dir = await createValidReleaseDir();
  try {
    const result = runValidator(dir);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('validator also accepts an optional dmg', async () => {
  const dir = await createValidReleaseDir({ includeDmg: true });
  try {
    const result = runValidator(dir);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('validator requires a linux manifest entry when policy is enabled', async () => {
  const dir = await createValidReleaseDir();
  try {
    await writeFile(
      path.join(dir, 'update-policy.json'),
      `${JSON.stringify({ linux_appimage_updater: true }, null, 2)}\n`
    );
    const result = runValidator(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /linux-\*/i);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('validator rejects linux manifest entries when policy is disabled', async () => {
  const dir = await createValidReleaseDir({ linuxAppImageUpdater: true });
  try {
    await writeFile(
      path.join(dir, 'update-policy.json'),
      `${JSON.stringify({ linux_appimage_updater: false }, null, 2)}\n`
    );
    const result = runValidator(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /linux-\*/i);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('validator rejects missing required release assets', async () => {
  const cases = ['latest.json', 'update-policy.json', 'openteams-0.4.8-x86_64.app.tar.gz', 'openteams_0.4.8_amd64-linux.deb', 'openteams-0.4.8.tgz'];

  for (const missing of cases) {
    const dir = await createValidReleaseDir();
    try {
      await fs.rm(path.join(dir, missing), { force: true });
      const result = runValidator(dir);
      assert.notEqual(result.status, 0, `${missing} should be required`);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

test('validator rejects manifest and signature mismatches', async () => {
  const dir = await createValidReleaseDir({ linuxAppImageUpdater: true });
  try {
    const manifestPath = path.join(dir, 'latest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.platforms['linux-x86_64'].signature = 'different-signature';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = runValidator(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /Signature content mismatch/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('validator rejects a validly shaped signature made by a different public key', async () => {
  const dir = await createValidReleaseDir();
  try {
    const fixtureConfig = JSON.parse(await fs.readFile(path.join(dir, 'tauri.conf.json'), 'utf8'));
    const publicKeyText = Buffer.from(fixtureConfig.tauri.updater.pubkey, 'base64').toString('utf8').split('\n');
    publicKeyText[1] = `${publicKeyText[1].slice(0, -2)}AA`;
    const differentPublicKey = Buffer.from(publicKeyText.join('\n'), 'utf8').toString('base64');
    await writeFile(
      path.join(dir, 'tauri.conf.json'),
      `${JSON.stringify({ tauri: { updater: { pubkey: differentPublicKey } } }, null, 2)}\n`,
    );
    const result = runValidator(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /public key|Minisign/i);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('validator rejects a manifest version that does not match the release tag', async () => {
  const dir = await createValidReleaseDir({ linuxAppImageUpdater: true });
  try {
    const manifestPath = path.join(dir, 'latest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.version = 'v0.4.9';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = runValidator(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /Manifest version/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('validator rejects updater archives with an old version or wrong architecture in the filename', async () => {
  const dir = await createValidReleaseDir();
  try {
    const manifestPath = path.join(dir, 'latest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.platforms['darwin-x86_64'].url = manifest.platforms['darwin-x86_64'].url.replace(
      'openteams-0.4.8-x86_64',
      'openteams-0.4.7-x86_64',
    );
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = runValidator(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /archive|filename|\.app\.tar\.gz/i);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('validator rejects a Darwin updater whose filename architecture disagrees with the manifest key', async () => {
  const dir = await createValidReleaseDir();
  try {
    const manifestPath = path.join(dir, 'latest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.platforms['darwin-aarch64'] = manifest.platforms['darwin-x86_64'];
    delete manifest.platforms['darwin-x86_64'];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = runValidator(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /Darwin updater|archive/i);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('validator rejects a deb asset whose version or architecture does not match the release', async () => {
  const dir = await createValidReleaseDir();
  try {
    await fs.rename(
      path.join(dir, 'openteams_0.4.8_amd64-linux.deb'),
      path.join(dir, 'openteams_0.4.7_arm64.deb'),
    );
    const result = runValidator(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /\.deb asset/i);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('validator rejects a main tgz whose filename version does not match the release', async () => {
  const dir = await createValidReleaseDir();
  try {
    await fs.rename(
      path.join(dir, 'openteams-0.4.8.tgz'),
      path.join(dir, 'openteams-0.4.7.tgz'),
    );
    const result = runValidator(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /main Web package/i);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
