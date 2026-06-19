import { strict as assert } from 'node:assert';
import { summarizeResourceState } from '@/components/ResourceState';
import { initialAsync, succeed, fail, beginLoad } from '@/lib/asyncResource';

const labels = {
  loading: 'Loading resource',
  empty: 'No resource data',
  error: 'Resource failed',
  fallback: 'Showing local fallback',
};

const loaded = beginLoad(initialAsync(['mock']));
assert.deepEqual(summarizeResourceState(loaded, labels), {
  kind: 'loading',
  title: labels.loading,
  detail: null,
});

const empty = succeed<string[]>([]);
assert.deepEqual(summarizeResourceState(empty, labels), {
  kind: 'empty',
  title: labels.empty,
  detail: null,
});

const erroredWithFallback = fail(initialAsync(['mock']), new Error('network down'));
assert.equal(summarizeResourceState(erroredWithFallback, labels), null);

assert.equal(summarizeResourceState(initialAsync(['mock']), labels), null);

const erroredEmpty = fail(initialAsync<string[]>([]), 'not found', []);
assert.deepEqual(summarizeResourceState(erroredEmpty, labels), {
  kind: 'error',
  title: labels.error,
  detail: 'not found',
});

const healthyApi = succeed(['api']);
assert.equal(summarizeResourceState(healthyApi, labels), null);

console.log('ResourceState tests passed');
