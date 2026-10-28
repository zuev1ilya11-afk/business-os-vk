import { Buffer } from 'node:buffer';

export const UPSTREAM = 'https://139.100.237.167';
export type ForwardInput = {
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  bodyBase64?: string;
};
export type Envelope = { status: number; headers: Record<string, string>; bodyBase64: string };
const requestHeaders = new Set(['content-type', 'x-bos-session', 'x-vk-launch-params', 'authorization', 'apikey', 'x-client-info', 'x-upsert', 'range']);
const responseHeaders = new Set(['content-type', 'x-bos-session', 'content-range', 'content-disposition']);
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

function failure(status: number, code: string): Envelope {
  return { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    bodyBase64: Buffer.from(JSON.stringify({ ok: false, error: code })).toString('base64') };
}

export async function forwardRequest(input: ForwardInput): Promise<Envelope> {
  const path = String(input.path || '');
  const method = String(input.method || 'GET').toUpperCase();
  if (!methods.has(method) || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return failure(400, 'INVALID_REQUEST');
  let url: URL;
  try {
    const decoded = decodeURIComponent(path.split('?')[0]);
    if (decoded.split('/').some(segment => segment === '..' || segment === '.')) return failure(400, 'INVALID_PATH');
    url = new URL(path, UPSTREAM);
  } catch { return failure(400, 'INVALID_PATH'); }
  if (url.origin !== UPSTREAM || !(/^\/functions\/v1\/[a-z0-9-]+$/.test(url.pathname) ||
      /^\/(?:auth|storage|rest)\/v1\/[A-Za-z0-9_./%-]+$/.test(url.pathname) || url.pathname === '/api/gas-report')) return failure(400, 'INVALID_PATH');
  if ((input.bodyBase64?.length || 0) > 4_800_000) return failure(413, 'RECOVERY_UPLOAD_TOO_LARGE');
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.headers || {})) {
    if (requestHeaders.has(key.toLowerCase()) && typeof value === 'string') headers[key.toLowerCase()] = value;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(url.href, {
      method, headers, redirect: 'error', signal: controller.signal,
      body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.from(input.bodyBase64 || '', 'base64'),
    });
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > 4_000_000) return failure(502, 'RECOVERY_RESPONSE_TOO_LARGE');
    const resultHeaders: Record<string, string> = { 'cache-control': 'no-store' };
    response.headers.forEach((value, key) => { if (responseHeaders.has(key)) resultHeaders[key] = value; });
    return { status: response.status, headers: resultHeaders, bodyBase64: body.toString('base64') };
  } catch (cause) {
    return failure(cause instanceof Error && cause.name === 'AbortError' ? 504 : 502, 'UPSTREAM_UNAVAILABLE');
  } finally { clearTimeout(timer); }
}
