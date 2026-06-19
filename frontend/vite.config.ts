import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {createLogger, defineConfig, type LogErrorOptions} from 'vite';

const logger = createLogger();
const defaultError = logger.error.bind(logger);

const isIgnorableWsProxyReset = (
  message: string,
  options?: LogErrorOptions,
) => {
  const errorCode = (
    options?.error as (Error & {code?: string}) | null | undefined
  )?.code;

  return errorCode === 'ECONNRESET' && message.includes('ws proxy error:');
};

logger.error = (message, options) => {
  if (isIgnorableWsProxyReset(message, options)) return;
  defaultError(message, options);
};

export default defineConfig(() => {
  return {
    customLogger: logger,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        react: path.resolve(__dirname, 'node_modules/react'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      },
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: ['@unovis/react', '@unovis/ts'],
    },
    server: {
      host: true,
      port: parseInt(process.env.FRONTEND_PORT || '3003', 10),
      proxy: {
        '/api': {
          target: `http://localhost:${process.env.BACKEND_PORT || '3001'}`,
          changeOrigin: true,
          ws: true,
        },
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
