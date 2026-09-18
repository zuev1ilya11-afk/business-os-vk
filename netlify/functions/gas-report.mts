const GAS_URL = 'https://script.google.com/macros/s/AKfycbx6l6V_jjZdbWQGljODcR4Uf4wvMc8hA24Dulzdmi-Ek76QH1mQS0tm3Q_ErI1sWEumzQ/exec';
const ALLOWED_ORIGINS = new Set([
  'https://zuev1ilya11-afk.github.io',
  'https://business-os-public-xo8i66.v2.appdeploy.ai',
]);

function cors(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://zuev1ilya11-afk.github.io',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-BOS-Session,X-VK-Launch-Params,Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export default async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(req) },
    });
  }
  try {
    const source = new URL(req.url);
    const target = new URL(GAS_URL);
    source.searchParams.forEach((value, key) => target.searchParams.append(key, value));
    const headers = new Headers();
    const contentType = req.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === 'POST' ? await req.arrayBuffer() : undefined,
      redirect: 'follow',
    });
    const responseHeaders = new Headers(cors(req));
    responseHeaders.set('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    console.error('GAS report proxy failed', error);
    return new Response(JSON.stringify({ ok: false, error: 'UPSTREAM_UNAVAILABLE' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(req) },
    });
  }
};

export const config = { path: '/api/gas-report' };
