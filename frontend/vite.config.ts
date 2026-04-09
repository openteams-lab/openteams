// vite.config.ts
import { sentryVitePlugin } from '@sentry/vite-plugin';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import pkg from './package.json';

type ViteRuntime = {
  createLogger: () => {
    error: (msg: string, options?: unknown) => void;
    warn: (msg: string, options?: unknown) => void;
  };
};

function resolveViteRuntimeEntry() {
  const pnpmStoreDir = path.resolve(__dirname, '../node_modules/.pnpm');
  const preferredMajor = pkg.devDependencies?.vite?.match(/\d+/)?.[0] ?? null;

  const candidates = fs
    .readdirSync(pnpmStoreDir)
    .filter((entry) => entry.startsWith('vite@'))
    .map((entry) => {
      const version = entry.slice('vite@'.length).split('_')[0];
      const runtimeEntry = path.join(
        pnpmStoreDir,
        entry,
        'node_modules',
        'vite',
        'dist',
        'node',
        'index.js'
      );

      return {
        runtimeEntry,
        version,
      };
    })
    .filter((candidate) => fs.existsSync(candidate.runtimeEntry));

  const selectedCandidate =
    candidates.find(
      (candidate) =>
        preferredMajor !== null &&
        candidate.version.startsWith(`${preferredMajor}.`)
    ) ?? candidates[0];

  if (!selectedCandidate) {
    throw new Error(
      `Unable to locate Vite runtime in ${pnpmStoreDir}. ` +
        'Run `pnpm install` to restore frontend dependencies.'
    );
  }

  return selectedCandidate.runtimeEntry;
}

const { createLogger } = (await import(
  pathToFileURL(resolveViteRuntimeEntry()).href
)) as ViteRuntime;

function createFilteredLogger() {
  const logger = createLogger();
  const originalError = logger.error.bind(logger);

  let lastRestartLog = 0;
  const DEBOUNCE_MS = 2000;

  logger.error = (msg, options) => {
    const isProxyError =
      msg.includes('ws proxy socket error') ||
      msg.includes('ws proxy error:') ||
      msg.includes('http proxy error:');

    if (isProxyError) {
      const now = Date.now();
      if (now - lastRestartLog > DEBOUNCE_MS) {
        logger.warn('Proxy connection closed, auto-reconnecting...');
        lastRestartLog = now;
      }
      return;
    }
    originalError(msg, options);
  };

  return logger;
}

function executorSchemasPlugin() {
  const VIRTUAL_ID = 'virtual:executor-schemas';
  const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;

  return {
    name: 'executor-schemas-plugin',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID; // keep it virtual
      return null;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) return null;

      const schemasDir = path.resolve(__dirname, '../shared/schemas');
      const files = fs.existsSync(schemasDir)
        ? fs.readdirSync(schemasDir).filter((f) => f.endsWith('.json'))
        : [];

      const imports: string[] = [];
      const entries: string[] = [];

      files.forEach((file, i) => {
        const varName = `__schema_${i}`;
        const importPath = `shared/schemas/${file}`; // uses your alias
        const key = file.replace(/\.json$/, '').toUpperCase(); // claude_code -> CLAUDE_CODE
        imports.push(`import ${varName} from "${importPath}";`);
        entries.push(`  "${key}": ${varName}`);
      });

      // IMPORTANT: pure JS (no TS types), and quote keys.
      const code = `
${imports.join('\n')}

export const schemas = {
${entries.join(',\n')}
};

export default schemas;
`;
      return code;
    },
  };
}

export default {
  customLogger: createFilteredLogger(),
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react({
      babel: {
        plugins: [
          [
            'babel-plugin-react-compiler',
            {
              target: '18',
              sources: [path.resolve(__dirname, 'src')],
              environment: {
                enableResetCacheOnSourceFileChanges: true,
              },
            },
          ],
        ],
      },
    }),
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [
          sentryVitePlugin({
            authToken: process.env.SENTRY_AUTH_TOKEN,
            org: 'openteams-lab-ai',
            project: 'openteams',
          }),
        ]
      : []),
    executorSchemasPlugin(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      shared: path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    host: true,
    port: parseInt(process.env.FRONTEND_PORT || '3000'),
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.BACKEND_PORT || '3001'}`,
        changeOrigin: true,
        ws: true,
      },
    },
    fs: {
      allow: [path.resolve(__dirname, '.'), path.resolve(__dirname, '..')],
    },
    open: process.env.VITE_OPEN === 'true',
    allowedHosts: [
      '.trycloudflare.com', // allow all cloudflared tunnels
    ],
  },
  optimizeDeps: {
    exclude: [],
  },
  build: { sourcemap: true },
};
