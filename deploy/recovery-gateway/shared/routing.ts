const knownOrigins = new Set([
  'https://139.100.237.167',
  'https://obsropbslfwtanyspjbi.supabase.co',
  'https://business-os-api-gateway.netlify.app',
  'https://business-os-api-gateway-3y8h7e.v2.appdeploy.ai',
  'https://business-os-api-gateway-ukp6ew.v2.appdeploy.ai',
]);

export function productionPath(raw: string, localOrigin: string): string | null {
  const url = new URL(raw, localOrigin);
  let path = url.pathname;
  if (url.origin === 'https://api-v2.appdeploy.ai') {
    const match = path.match(/^\/app\/business-os-api-gateway-(?:3y8h7e|ukp6ew)(\/api\/proxy\/[^/]+)$/);
    if (!match) return null;
    path = match[1];
  } else if (!knownOrigins.has(url.origin) && url.origin !== localOrigin) {
    if (url.origin === 'https://script.google.com' && path.startsWith('/macros/s/')) return '/api/gas-report' + url.search;
    return null;
  }
  if (path.startsWith('/api/proxy/')) path = '/functions/v1/' + path.slice('/api/proxy/'.length);
  if (/^\/(?:functions|auth|storage|rest)\/v1\//.test(path) || path === '/api/gas-report') return path + url.search;
  return null;
}
