import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAsset } from '../shared/assets.ts';

const base = new URL('https://api-v2.appdeploy.ai/app/recovery/api/prod/');
const build = { id: 'current-build', assetBundles: {
  'role-chrome-v83.js': 'eager.bundle.js',
  'finance-page.js': 'finance.bundle.js',
  'dispatcher-ui-redesign-v183.js': 'dispatcher.bundle.js',
} };

test('role and finance scripts resolve to deployed bundles across the proxy origin', () => {
  for (const [source, bundle] of Object.entries(build.assetBundles)) {
    assert.equal(resolveAsset('./' + source + '?v=old', base, build), base.href + bundle + '?build=current-build');
  }
});

test('production loader and assets remain present with their build version', () => {
  assert.equal(resolveAsset('pwa-register.js?build=current-build', base, build), base.href + 'pwa-register.js?build=current-build');
  assert.equal(resolveAsset('./brand-logo.svg', base, build), base.href + 'brand-logo.svg?build=current-build');
  assert.equal(resolveAsset('https://example.org/script.js', base, build), 'https://example.org/script.js');
});
