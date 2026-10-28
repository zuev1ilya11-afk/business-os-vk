import { api } from '@appdeploy/client';
import { productionPath } from '../shared/routing';
import './styles.css';

type Envelope = { status: number; headers: Record<string, string>; bodyBase64: string };
const globals = window as unknown as Record<string, unknown>;
const appId = String(globals.__APPDEPLOY_APP_ID || '');
const assetBase = new URL('https://api-v2.appdeploy.ai/app/' + appId + '/api/prod/');
const nativeFetch = window.fetch.bind(window);

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(binary);
}
function responseFrom(envelope: Envelope): Response {
  if (!envelope || !Number.isInteger(envelope.status)) throw new Error('Некорректный ответ резервного входа');
  const bytes = Uint8Array.from(atob(envelope.bodyBase64 || ''), char => char.charCodeAt(0));
  return new Response([204, 205, 304].includes(envelope.status) ? null : bytes, { status: envelope.status, headers: envelope.headers });
}

function installTransport(): void {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = productionPath(raw, location.origin);
    if (!path) return nativeFetch(input, init);
    const request = input instanceof Request ? new Request(input, init) : new Request(new URL(raw, location.origin), init);
    if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => { headers[key] = value; });
    const bytes = request.method === 'GET' || request.method === 'HEAD' ? new Uint8Array() : new Uint8Array(await request.arrayBuffer());
    const result = await api.post('/api/forward', { path, method: request.method, headers, bodyBase64: encode(bytes) });
    if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return responseFrom(result.data as Envelope);
  };
}

function assetUrl(raw: string): string {
  const parsed = new URL(raw, 'https://139.100.237.167/');
  if (parsed.origin !== 'https://139.100.237.167') return raw;
  const name = parsed.pathname.replace(/^\/+/, '');
  if (!name || name.includes('/')) return raw;
  return new URL(encodeURIComponent(name) + parsed.search, assetBase).href;
}

function showFailure(): void {
  document.body.innerHTML = '<main class="recovery"><h1>Не удалось открыть резервный вход</h1><p>Соединение с рабочим сервером недоступно. Повторите проверку.</p><button id="retry">Повторить</button><p><a href="?diagnostics=1">Проверить соединение</a></p></main>';
  document.getElementById('retry')?.addEventListener('click', () => location.reload());
}

async function boot(): Promise<void> {
  try {
    const health = await api.get('/api/health');
    if (!(health.data as { ok?: boolean }).ok) throw new Error('UPSTREAM_UNAVAILABLE');
    const envelope = (await api.get('/api/prod-index')).data as { html: string };
    const source = new DOMParser().parseFromString(envelope.html, 'text/html');
    const scripts = Array.from(source.querySelectorAll('script'));
    source.querySelectorAll('script').forEach(node => node.remove());
    const base = document.createElement('base');
    base.href = assetBase.href;
    document.head.prepend(base);
    document.title = source.title + ' — резервный вход';
    for (const node of source.head.querySelectorAll('style, link[rel="stylesheet"]')) {
      const copy = node.cloneNode(true) as HTMLElement;
      if (copy instanceof HTMLLinkElement) copy.href = assetUrl(node.getAttribute('href') || '');
      document.head.appendChild(copy);
    }
    document.body.innerHTML = source.body.innerHTML;
    installTransport();
    for (const sourceScript of scripts) {
      const src = sourceScript.getAttribute('src');
      if (src?.includes('pwa-register.js')) continue;
      const script = document.createElement('script');
      script.async = false;
      if (src) {
        script.src = assetUrl(src);
        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('ASSET_UNAVAILABLE'));
          document.body.appendChild(script);
        });
      } else {
        script.textContent = sourceScript.textContent;
        document.body.appendChild(script);
      }
    }
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  } catch { showFailure(); }
}

async function diagnostics(): Promise<void> {
  document.body.innerHTML = '<main class="recovery"><h1>Проверка резервного входа</h1><button id="check">Проверить соединение</button><pre id="result" aria-live="polite"></pre><p><a href="/">Открыть Business OS</a></p></main>';
  document.getElementById('check')?.addEventListener('click', async () => {
    const output = document.getElementById('result')!;
    const button = document.getElementById('check') as HTMLButtonElement;
    button.disabled = true;
    output.textContent = 'Проверяем…';
    try {
      const lines: string[] = [];
      for (let i = 1; i <= 3; i++) {
        const data = (await api.get('/api/health')).data as { ok?: boolean; version?: string };
        if (!data.ok) throw new Error('Сервер не подтвердил доступность');
        lines.push('API ' + i + '/3: OK');
      }
      const auth = responseFrom((await api.post('/api/forward', { path: '/auth/v1/health', method: 'GET' })).data as Envelope);
      lines.push('Авторизация: HTTP ' + auth.status);
      output.textContent = lines.join('\n');
    } catch { output.textContent = 'Не удалось связаться с рабочим сервером. Повторите проверку.'; }
    finally { button.disabled = false; }
  });
}

if (new URLSearchParams(location.search).has('diagnostics')) void diagnostics();
else void boot();
