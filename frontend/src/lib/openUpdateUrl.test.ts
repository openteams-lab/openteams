import assert from 'node:assert/strict';

type ShellOpen = (path: string, withApp?: string) => Promise<void>;

type TauriShellWindow = {
  open?: (url?: string | URL, target?: string, features?: string) => Window | null;
  __TAURI__?: {
    shell?: {
      open?: ShellOpen;
    };
  };
};

const globalWindowHolder = globalThis as {
  window?: TauriShellWindow;
};
const originalWindow = globalWindowHolder.window;

const importOpenUpdateUrl = async () =>
  import(`./openUpdateUrl.ts?test=${Date.now()}`);

async function main() {
  console.log('open update url');

  Reflect.deleteProperty(globalWindowHolder, 'window');
  const noWindowModule = await importOpenUpdateUrl();
  await assert.rejects(
    () =>
      noWindowModule.openUpdateUrl(
        'https://github.com/openteams-lab/openteams/releases/download/v0.4.8/openteams_0.4.8_amd64-linux.deb',
      ),
    (error: unknown) => {
      assert(error instanceof noWindowModule.ManualDownloadError);
      assert.equal(
        (error as InstanceType<typeof noWindowModule.ManualDownloadError>).errorData.code,
        'manual_installer_unavailable',
      );
      return true;
    },
  );

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
  const { openUpdateUrl, ManualDownloadError } = await importOpenUpdateUrl();

  const trustedUrl =
    'https://github.com/openteams-lab/openteams/releases/download/v0.4.8/openteams_0.4.8_amd64-linux.deb';
  await openUpdateUrl(trustedUrl);
  assert.equal(openedUrl, trustedUrl);

  await assert.rejects(
    () => openUpdateUrl('https://example.com/openteams_0.4.8_amd64-linux.deb'),
    (error: unknown) => {
      assert(error instanceof ManualDownloadError);
      assert.equal(
        (error as InstanceType<typeof ManualDownloadError>).errorData.code,
        'manual_installer_untrusted_url',
      );
      return true;
    },
  );

  let fallbackWindowOpenUrl = '';
  globalWindowHolder.window = {
    open: (url?: string | URL) => {
      fallbackWindowOpenUrl = String(url);
      return null;
    },
  };
  const browserModule = await importOpenUpdateUrl();
  await assert.rejects(
    () => browserModule.openUpdateUrl(trustedUrl),
    (error: unknown) => {
      assert(error instanceof browserModule.ManualDownloadError);
      assert.equal(
        (error as InstanceType<typeof browserModule.ManualDownloadError>).errorData.code,
        'manual_installer_unavailable',
      );
      return true;
    },
  );
  assert.equal(fallbackWindowOpenUrl, trustedUrl);

  globalWindowHolder.window = {
    open: (url?: string | URL) => {
      fallbackWindowOpenUrl = String(url);
      return {} as Window;
    },
  };
  const successfulBrowserModule = await importOpenUpdateUrl();
  await successfulBrowserModule.openUpdateUrl(trustedUrl);
  assert.equal(fallbackWindowOpenUrl, trustedUrl);

  globalWindowHolder.window = originalWindow;
  console.log('All openUpdateUrl assertions passed.');
}

await main();
