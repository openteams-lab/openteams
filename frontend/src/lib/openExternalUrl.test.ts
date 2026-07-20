import assert from 'node:assert/strict';
import { openExternalUrlInDesktop } from './openExternalUrl';

type TestWindow = {
  __TAURI__?: {
    shell?: {
      open?: (path: string, withApp?: string) => Promise<void>;
    };
  };
};

const globalWindowHolder = globalThis as { window?: TestWindow };
const originalWindow = globalWindowHolder.window;

async function main() {
  console.log('open external url');

  Reflect.deleteProperty(globalWindowHolder, 'window');
  assert.equal(openExternalUrlInDesktop('https://example.com/docs'), false);

  let openedUrl = '';
  globalWindowHolder.window = {
    __TAURI__: {
      shell: {
        open: async (path) => {
          openedUrl = path;
        },
      },
    },
  };

  assert.equal(openExternalUrlInDesktop('https://example.com/docs'), true);
  assert.equal(openedUrl, 'https://example.com/docs');
  assert.equal(openExternalUrlInDesktop('http://example.com'), true);
  assert.equal(openedUrl, 'http://example.com/');

  assert.equal(openExternalUrlInDesktop('javascript:alert(1)'), false);
  assert.equal(openExternalUrlInDesktop('file:///tmp/example.txt'), false);
  assert.equal(openExternalUrlInDesktop('/relative/path'), false);

  globalWindowHolder.window = originalWindow;
  console.log('All openExternalUrl assertions passed.');
}

await main();
