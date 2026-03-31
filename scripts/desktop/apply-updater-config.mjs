import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_ENDPOINT =
  'https://github.com/openteams-lab/openteams/releases/latest/download/latest.json';
const DEFAULT_PUBKEY_ENV = 'TAURI_UPDATER_PUBKEY';

function parseArgs(argv) {
  const args = {
    configs: [],
    endpoint: DEFAULT_ENDPOINT,
    pubkeyEnv: DEFAULT_PUBKEY_ENV,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--config') {
      args.configs.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (value === '--endpoint') {
      args.endpoint = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--pubkey-env') {
      args.pubkeyEnv = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }

  if (args.configs.length === 0) {
    throw new Error('At least one --config path is required.');
  }

  return args;
}

async function updateConfig(configPath, endpoint, pubkey) {
  const absolutePath = path.resolve(configPath);
  const raw = await fs.readFile(absolutePath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!parsed?.tauri?.updater) {
    throw new Error(`Missing tauri.updater config in ${absolutePath}`);
  }

  parsed.tauri.updater.active = true;
  parsed.tauri.updater.dialog = false;
  parsed.tauri.updater.endpoints = [endpoint];
  parsed.tauri.updater.pubkey = pubkey;

  await fs.writeFile(absolutePath, `${JSON.stringify(parsed, null, 2)}\n`);
  console.log(`Updated updater config in ${absolutePath}`);
}

async function main() {
  const { configs, endpoint, pubkeyEnv } = parseArgs(process.argv.slice(2));
  const pubkey = process.env[pubkeyEnv]?.trim();

  if (!pubkey) {
    throw new Error(
      `Environment variable ${pubkeyEnv} is required to inject the updater public key.`
    );
  }

  for (const config of configs) {
    await updateConfig(config, endpoint, pubkey);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
