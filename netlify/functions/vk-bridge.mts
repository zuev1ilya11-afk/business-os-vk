const VK_BRIDGE_URL = 'https://unpkg.com/@vkontakte/vk-bridge@2.15.12/dist/browser.min.js';

export default async (req: Request) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('METHOD_NOT_ALLOWED', { status: 405 });
  }
  try {
    const upstream = await fetch(VK_BRIDGE_URL, { redirect: 'follow' });
    if (!upstream.ok) return new Response('', { status: 502 });
    return new Response(req.method === 'HEAD' ? null : await upstream.text(), {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('VK Bridge proxy failed', error);
    return new Response('', { status: 502 });
  }
};

export const config = { path: '/vendor/vk-bridge.js' };
