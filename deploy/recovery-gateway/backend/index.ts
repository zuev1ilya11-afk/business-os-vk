import { router, json, error } from '@appdeploy/sdk';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { UPSTREAM, forwardRequest, type ForwardInput } from '../shared/proxy';
import { expectedBuild, assetHashes } from '../shared/build';

const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
async function productionFile(path: string): Promise<Response> {
  return fetch(UPSTREAM + path, {
    redirect: 'error',
    signal: AbortSignal.timeout(18000),
    cache: 'no-store',
  });
}

export const handler = router({
  'GET /api/_healthcheck': [
    async () =>
      json({ ok: true, service: 'business-os-recovery', build: expectedBuild }),
  ],
  'GET /api/health': [
    async () => {
      const response = await forwardRequest({
        path: '/functions/v1/mini-app-api',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        bodyBase64: Buffer.from('{"action":"health"}').toString('base64'),
      });
      return {
        statusCode: response.status,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: Buffer.from(response.bodyBase64, 'base64').toString('utf8'),
      };
    },
  ],
  'GET /api/prod-index': [
    async () => {
      try {
        const response = await productionFile('/');
        const html = await response.text();
        if (!response.ok || !html.includes('content="' + expectedBuild + '"'))
          return error('PRODUCTION_BUILD_CHANGED', 503);
        return {
          ...json({ html, build: expectedBuild }),
          headers: { ...headers, 'Content-Type': 'application/json' },
        };
      } catch {
        return error('PRODUCTION_UNAVAILABLE', 502);
      }
    },
  ],
  'GET /api/prod/:asset': [
    async ({ params }) => {
      const asset = String(params.asset || '');
      const expected = assetHashes[asset];
      if (!expected) return error('ASSET_NOT_ALLOWED', 404);
      try {
        const response = await productionFile(
          '/' + asset + '?build=' + expectedBuild
        );
        const body = Buffer.from(await response.arrayBuffer());
        if (
          !response.ok ||
          createHash('sha256').update(body).digest('hex') !== expected
        )
          return error('PRODUCTION_ASSET_CHANGED', 503);
        const type = asset.endsWith('.js')
          ? 'application/javascript; charset=utf-8'
          : asset.endsWith('.css')
            ? 'text/css; charset=utf-8'
            : asset.endsWith('.svg')
              ? 'image/svg+xml'
              : 'application/json';
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': type },
          body: body.toString('utf8'),
        };
      } catch {
        return error('ASSET_UNAVAILABLE', 502);
      }
    },
  ],
  'POST /api/forward': [
    async ({ body }) => {
      const result = await forwardRequest(
        (body && typeof body === 'object' ? body : {}) as ForwardInput
      );
      return {
        ...json(result),
        headers: { ...headers, 'Content-Type': 'application/json' },
      };
    },
  ],
});
