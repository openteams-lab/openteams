import assert from "node:assert/strict";

import type {
  DesktopUpdateContext,
  UpdateActionResponse,
  UpdateErrorInfo,
} from "../../../shared/types";
import {
  type VersionCheckResponse,
  UpdateApiError,
  versionApi,
  versionServicePollIntervalMs,
  versionServiceReadinessTimeoutMs,
  versionServiceRestartDelayMs,
  waitForVersionService,
} from "./api";

type Equal<Actual, Expected> =
  (<T>() => T extends Actual ? 1 : 2) extends <T>() => T extends Expected
    ? 1
    : 2
    ? true
    : false;

type Expect<T extends true> = T;

export type VersionApiCheckReturn = Expect<
  Equal<Awaited<ReturnType<typeof versionApi.check>>, VersionCheckResponse>
>;
export type VersionApiUpdateNpxReturn = Expect<
  Equal<Awaited<ReturnType<typeof versionApi.updateNpx>>, UpdateActionResponse>
>;
export type VersionApiRestartReturn = Expect<
  Equal<Awaited<ReturnType<typeof versionApi.restart>>, UpdateActionResponse>
>;

const originalFetch = globalThis.fetch;
const globalWindowHolder = globalThis as unknown as { window?: unknown };
const originalWindow = globalWindowHolder.window;

function setWindowWithTauriInvoke(
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
) {
  if (!invoke) {
    Reflect.deleteProperty(globalWindowHolder, "window");
    return;
  }

  globalWindowHolder.window = {
    __TAURI__: {
      invoke,
    },
  };
}

function installFetchStub(
  handler:
    | ((url: string, init?: RequestInit) => Promise<Response>)
    | ((url: string, init?: RequestInit) => Promise<never>),
) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(
  status: number,
  body: string,
  contentType = "text/plain",
): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": contentType },
  });
}

const sampleVersionInfo: VersionCheckResponse = {
  current_version: "0.4.7",
  latest_version: "0.4.8",
  has_update: true,
  release_url: "https://github.com/openteams-lab/openteams/releases/tag/v0.4.8",
  release_notes: null,
  published_at: "2026-07-13T00:00:00Z",
  capability: {
    platform: "linux_appimage",
    method: "tauri_updater",
    can_download: true,
    can_install: true,
    requires_restart: true,
    fallback_url:
      "https://github.com/openteams-lab/openteams/releases/download/v0.4.8/openteams-0.4.8-x86_64.AppImage",
  },
};

const progressActionPayload: UpdateActionResponse = {
  success: true,
  message: "download in progress",
  state: {
    download_status: "downloading",
    install_status: "idle",
    downloaded_bytes: 1024,
    total_bytes: 2048,
    error: null,
  },
};

async function main() {
  console.log("version API client");

  setWindowWithTauriInvoke(async () => {
    throw new Error("versionApi.check must not invoke Tauri commands");
  });
  let requestedUrl = "";
  installFetchStub(async (url) => {
    requestedUrl = url;
    return jsonResponse(200, {
      success: true,
      data: sampleVersionInfo,
    });
  });
  const browserContextResult = await versionApi.check();
  assert.equal(browserContextResult.capability.platform, "linux_appimage");
  assert.match(requestedUrl, /\/api\/version\/check$/);

  setWindowWithTauriInvoke();
  installFetchStub(async (url) => {
    requestedUrl = url;
    return jsonResponse(200, {
      success: true,
      data: sampleVersionInfo,
    });
  });
  await versionApi.check({
    platform: "macos",
    architecture: "aarch64",
  });
  assert.match(
    requestedUrl,
    /\/api\/version\/check\?platform=macos&architecture=aarch64$/,
  );

  installFetchStub(async () =>
    jsonResponse(200, {
      success: true,
      data: {
        ...sampleVersionInfo,
        capability: { ...sampleVersionInfo.capability, method: "future_method" },
      },
    }),
  );
  await assert.rejects(
    () => versionApi.check(),
    (error: unknown) => {
      assert(error instanceof UpdateApiError);
      assert.equal(
        (error as UpdateApiError<UpdateErrorInfo>).errorData?.code,
        "release_check_failed",
      );
      return true;
    },
  );

  setWindowWithTauriInvoke(async () => {
    throw new Error("tauri invoke failed");
  });
  await assert.rejects(
    () => versionApi.check(),
    (error: unknown) => {
      assert(error instanceof UpdateApiError);
      const updateError = error as UpdateApiError<UpdateErrorInfo>;
      assert.equal(updateError.errorData?.code, "release_check_failed");
      assert.equal(updateError.errorData?.stage, "check");
      return true;
    },
  );

  setWindowWithTauriInvoke();
  installFetchStub(async () => {
    throw new Error("network unavailable");
  });
  await assert.rejects(
    () => versionApi.check(),
    (error: unknown) => {
      assert(error instanceof UpdateApiError);
      const updateError = error as UpdateApiError<UpdateErrorInfo>;
      assert.equal(updateError.errorData?.code, "release_check_failed");
      assert.equal(updateError.errorData?.stage, "check");
      return true;
    },
  );

  installFetchStub(async () => {
    throw new DOMException("The request timed out", "TimeoutError");
  });
  await assert.rejects(
    () => versionApi.check(),
    (error: unknown) => {
      assert(error instanceof UpdateApiError);
      const updateError = error as UpdateApiError<UpdateErrorInfo>;
      assert.equal(updateError.errorData?.code, "release_check_failed");
      assert.equal(updateError.errorData?.stage, "check");
      assert.match(updateError.errorData?.message ?? "", /timed out/i);
      return true;
    },
  );

  assert.equal(versionApi.waitForService, waitForVersionService);
  let serviceNow = 0;
  const serviceDelays: number[] = [];
  let serviceRequests = 0;
  await waitForVersionService({
    now: () => serviceNow,
    sleep: async (delay) => {
      serviceDelays.push(delay);
      serviceNow += delay;
    },
    request: async () => {
      serviceRequests += 1;
      if (serviceRequests === 1) throw new Error("replacement service is still down");
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    },
  });
  assert.deepEqual(serviceDelays, [versionServiceRestartDelayMs, versionServicePollIntervalMs]);
  assert.equal(serviceRequests, 2, 'service readiness polls after the old process disappears');

  let timeoutNow = 0;
  const timeoutDelays: number[] = [];
  await assert.rejects(
    () => waitForVersionService({
      now: () => timeoutNow,
      timeoutMs: 1_000,
      sleep: async (delay) => {
        timeoutDelays.push(delay);
        timeoutNow += delay;
      },
      request: async () => {
        throw new Error("service never became ready");
      },
    }),
    (error: unknown) => {
      assert(error instanceof UpdateApiError);
      const updateError = error as UpdateApiError<UpdateActionResponse>;
      assert.equal(updateError.status, 503);
      assert.equal(updateError.errorData?.state.error?.code, "restart_service_unavailable");
      return true;
    },
  );
  assert.equal(timeoutDelays[0], versionServiceRestartDelayMs);
  assert.equal(versionServiceReadinessTimeoutMs, 15_000);

  installFetchStub(async () => textResponse(502, "<html>bad gateway</html>", "text/html"));
  await assert.rejects(
    () => versionApi.check(),
    (error: unknown) => {
      assert(error instanceof UpdateApiError);
      const updateError = error as UpdateApiError<UpdateErrorInfo>;
      assert.equal(updateError.status, 502);
      assert.equal(updateError.errorData?.code, "release_check_failed");
      return true;
    },
  );

  installFetchStub(async () => textResponse(200, "not json"));
  await assert.rejects(
    () => versionApi.check(),
    (error: unknown) => {
      assert(error instanceof UpdateApiError);
      const updateError = error as UpdateApiError<UpdateErrorInfo>;
      assert.equal(updateError.errorData?.code, "release_check_failed");
      return true;
    },
  );

  installFetchStub(async () =>
    jsonResponse(200, {
      success: true,
      data: { current_version: "0.4.7" },
    }),
  );
  await assert.rejects(
    () => versionApi.check(),
    (error: unknown) => {
      assert(error instanceof UpdateApiError);
      const updateError = error as UpdateApiError<UpdateErrorInfo>;
      assert.equal(updateError.errorData?.code, "release_check_failed");
      return true;
    },
  );

  installFetchStub(async () =>
    jsonResponse(200, {
      success: true,
      data: progressActionPayload,
    }),
  );
  const updateResult = await versionApi.updateNpx();
  assert.equal(updateResult.state.download_status, "downloading");
  assert.equal(updateResult.state.install_status, "idle");
  assert.equal(updateResult.state.downloaded_bytes, 1024);
  assert.equal(updateResult.state.total_bytes, 2048);

  installFetchStub(async () => textResponse(502, "gateway timeout"));
  await assert.rejects(
    () => versionApi.updateNpx(),
    (error: unknown) => {
      assert(error instanceof UpdateApiError);
      const updateError = error as UpdateApiError<UpdateActionResponse>;
      assert.equal(updateError.status, 502);
      assert.equal(updateError.errorData?.state.error?.code, "update_transport_failed");
      assert.equal(updateError.errorData?.state.error?.stage, "download");
      assert.equal(updateError.errorData?.state.download_status, "failed");
      return true;
    },
  );

  installFetchStub(async () =>
    jsonResponse(502, {
      success: false,
      error_data: {
        success: false,
        message: "Failed to restart service",
        state: {
          download_status: "downloaded",
          install_status: "failed",
          downloaded_bytes: null,
          total_bytes: null,
          error: {
            stage: "restart",
            code: "restart_spawn_failed",
            message: "Failed to restart service",
            retryable: true,
          },
        },
      },
    }),
  );
  await assert.rejects(
    () => versionApi.restart(),
    (error: unknown) => {
      assert(error instanceof UpdateApiError);
      const updateError = error as UpdateApiError<UpdateActionResponse>;
      assert.equal(updateError.errorData?.state.error?.code, "restart_spawn_failed");
      assert.equal(updateError.errorData?.state.install_status, "failed");
      return true;
    },
  );

  installFetchStub(async () =>
    jsonResponse(200, {
      success: true,
      data: {
        success: true,
        message: "broken payload",
        state: {
          download_status: "downloaded",
        },
      },
    }),
  );
  await assert.rejects(
    () => versionApi.restart(),
    (error: unknown) => {
      assert(error instanceof UpdateApiError);
      const updateError = error as UpdateApiError<UpdateActionResponse>;
      assert.equal(updateError.errorData?.state.error?.code, "update_transport_failed");
      assert.equal(updateError.errorData?.state.error?.stage, "restart");
      return true;
    },
  );

  console.log("All version API contract assertions passed.");
}

try {
  await main();
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindow) {
    globalWindowHolder.window = originalWindow;
  } else {
    Reflect.deleteProperty(globalWindowHolder, "window");
  }
}
