#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const BROKER_BASE_URL = 'https://openteams-lab.com/api/github/oauth/';
const GITHUB_USER_URL = 'https://api.github.com/user';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLAIM_SECRET = /^[A-Za-z0-9_-]{43}$/;
const MIN_POLL_MS = 1_000;
const MAX_POLL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;

let activeFlow;
let acknowledged = false;
let stopping = false;

class SmokeTestError extends Error {}

function endpoint(path) {
  return new URL(path, BROKER_BASE_URL).href;
}

function requestSignal() {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function pollDelay(milliseconds, fallback = 2_000) {
  const value = Number(milliseconds);
  return Number.isFinite(value)
    ? Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, value))
    : fallback;
}

async function responseJson(response) {
  return response.json().catch(() => ({}));
}

function responseError(response, body) {
  const code = typeof body?.error === 'string'
    ? body.error
    : typeof body?.error_code === 'string'
      ? body.error_code
      : 'unknown_error';
  return new SmokeTestError(`服务端请求失败：HTTP ${response.status} (${code})`);
}

async function createFlow() {
  const response = await fetch(endpoint('flows'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      'User-Agent': 'OpenTeams-OAuth-Smoke-Test',
    },
    body: JSON.stringify({ client_version: 'smoke-test', platform: process.platform }),
    signal: requestSignal(),
  });
  const body = await responseJson(response);
  if (!response.ok) throw responseError(response, body);

  const authorizationUrl = new URL(String(body.authorization_url));
  const expiresAt = Date.parse(String(body.expires_at));
  if (
    !UUID_V4.test(String(body.flow_id))
    || !CLAIM_SECRET.test(String(body.claim_secret))
    || authorizationUrl.protocol !== 'https:'
    || authorizationUrl.hostname !== 'github.com'
    || authorizationUrl.pathname !== '/login/oauth/authorize'
    || !Number.isFinite(expiresAt)
    || expiresAt <= Date.now()
  ) {
    throw new SmokeTestError('创建 Flow 的响应不符合协议');
  }

  return {
    flowId: body.flow_id,
    claimSecret: body.claim_secret,
    authorizationUrl: authorizationUrl.href,
    expiresAt,
    deliveryId: randomUUID(),
    pollAfterMs: pollDelay(body.poll_after_ms),
  };
}

async function openBrowser(url) {
  const command = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];

  await new Promise((resolve, reject) => {
    const child = spawn(command[0], command[1], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    child.once('error', reject);
  });
}

function retryAfter(response, body, fallback) {
  const headerSeconds = Number(response.headers.get('retry-after'));
  const headerMs = Number.isFinite(headerSeconds) && headerSeconds > 0
    ? headerSeconds * 1_000
    : 0;
  const bodyMs = Number(body?.retry_after_ms);
  return pollDelay(Math.max(headerMs, Number.isFinite(bodyMs) ? bodyMs : 0), fallback);
}

async function pollForDelivery(flow) {
  let delay = flow.pollAfterMs;
  let transientFailures = 0;

  while (!stopping && Date.now() < flow.expiresAt) {
    await sleep(delay);
    if (stopping) break;

    let response;
    try {
      response = await fetch(endpoint(`flows/${flow.flowId}/result`), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${flow.claimSecret}`,
          'Cache-Control': 'no-store',
          'Idempotency-Key': flow.deliveryId,
          'User-Agent': 'OpenTeams-OAuth-Smoke-Test',
        },
        signal: requestSignal(),
      });
    } catch (error) {
      transientFailures += 1;
      if (transientFailures >= 3) {
        throw new SmokeTestError(`轮询连续失败：${error.name}`);
      }
      delay = 5_000;
      console.log(`线上服务暂时不可用，${delay / 1_000} 秒后重试…`);
      continue;
    }

    const body = await responseJson(response);
    if (response.status === 202 || body.status === 'pending') {
      transientFailures = 0;
      delay = retryAfter(response, body, delay);
      console.log(`等待 GitHub 授权，${delay / 1_000} 秒后继续检查…`);
      continue;
    }
    if (response.status === 429 || response.status === 425) {
      delay = retryAfter(response, body, response.status === 429 ? 5_000 : 2_000);
      console.log(`服务端要求稍后重试，等待 ${delay / 1_000} 秒…`);
      continue;
    }
    if (!response.ok) throw responseError(response, body);
    if (body.status === 'denied' || body.status === 'error') {
      throw new SmokeTestError(`OAuth 未完成：${body.error_code ?? body.status}`);
    }
    if (
      body.status !== 'delivering'
      || body.delivery_id !== flow.deliveryId
      || typeof body.access_token !== 'string'
      || body.access_token.length === 0
      || String(body.token_type).toLowerCase() !== 'bearer'
      || typeof body.account?.login !== 'string'
      || !Number.isInteger(body.account?.id)
    ) {
      throw new SmokeTestError('Token 交付响应不符合协议');
    }
    return body;
  }

  throw new SmokeTestError(stopping ? '测试已取消' : 'OAuth Flow 已过期');
}

async function verifyGitHubUser(accessToken, brokerAccount) {
  const response = await fetch(GITHUB_USER_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'OpenTeams-OAuth-Smoke-Test',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: requestSignal(),
  });
  const body = await responseJson(response);
  if (!response.ok) {
    throw new SmokeTestError(`GitHub /user 验证失败：HTTP ${response.status}`);
  }
  if (body.login !== brokerAccount.login || body.id !== brokerAccount.id) {
    throw new SmokeTestError('GitHub /user 与 Broker 返回的账号不一致');
  }
  return { login: body.login, id: body.id };
}

async function acknowledge(flow) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(endpoint(`flows/${flow.flowId}/ack`), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${flow.claimSecret}`,
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
          'User-Agent': 'OpenTeams-OAuth-Smoke-Test',
        },
        body: JSON.stringify({ delivery_id: flow.deliveryId }),
        signal: requestSignal(),
      });
      const body = await responseJson(response);
      if (response.ok && body.ok === true) return;
      lastError = responseError(response, body);
      if (response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
  }
  throw new SmokeTestError(`ACK 失败：${lastError?.message ?? 'unknown_error'}`);
}

async function cancelFlow(flow) {
  try {
    await fetch(endpoint(`flows/${flow.flowId}`), {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${flow.claimSecret}`,
        'Cache-Control': 'no-store',
        'User-Agent': 'OpenTeams-OAuth-Smoke-Test',
      },
      signal: requestSignal(),
    });
  } catch {
    // Flow 仍会由服务端 TTL 自动清理。
  }
}

process.once('SIGINT', () => {
  stopping = true;
  console.log('\n正在取消 OAuth 测试…');
});

async function main() {
  if (typeof fetch !== 'function' || typeof AbortSignal.timeout !== 'function') {
    throw new SmokeTestError('需要 Node.js 18 或更高版本');
  }

  console.log('1/5 创建线上 OAuth Flow…');
  activeFlow = await createFlow();

  console.log('2/5 打开 GitHub 授权页面…');
  try {
    await openBrowser(activeFlow.authorizationUrl);
    console.log('请在浏览器中完成授权，终端会自动等待结果。');
  } catch {
    throw new SmokeTestError('无法打开系统浏览器，请检查桌面环境后重试');
  }

  console.log('3/5 等待并领取一次性 Token…');
  const delivery = await pollForDelivery(activeFlow);
  let accessToken = delivery.access_token;
  try {
    console.log('4/5 使用 Token 直接验证 GitHub /user…');
    const user = await verifyGitHubUser(accessToken, delivery.account);
    console.log(`GitHub 身份验证成功：${user.login} (#${user.id})`);
    console.log(`授权 scopes：${Array.isArray(delivery.scopes) ? delivery.scopes.join(', ') : ''}`);

    console.log('5/5 发送 ACK 并删除线上 Token…');
    await acknowledge(activeFlow);
    acknowledged = true;
    console.log('OAuth Broker 整条链路验证成功。Token 已从进程内存释放。');
  } finally {
    accessToken = undefined;
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown_error';
  console.error(`OAuth Broker 测试失败：${message}`);
  process.exitCode = stopping ? 130 : 1;
} finally {
  if (activeFlow && !acknowledged) await cancelFlow(activeFlow);
  activeFlow = undefined;
}
