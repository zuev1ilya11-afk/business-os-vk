"""Loopback-only browser portal for the isolated recovery application.

The transport is supplied by the launcher and talks only to its network-none
container. No network client in this module can contact the captured server.
"""
import html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import subprocess
import threading
from urllib.parse import unquote, urlsplit, urlunsplit


MAX_BODY = 32 * 1024 * 1024
GUARD_PATH = '/__bos_local_guard.js'
KNOWN_ORIGINS = frozenset({
    'https://139.100.237.167', 'https://136.234.17.113',
    'https://homemaster.qd.je', 'https://obsropbslfwtanyspjbi.supabase.co',
    'https://api-v2.appdeploy.ai',
    'https://business-os-api-gateway-3y8h7e.v2.appdeploy.ai',
    'https://business-os-api-gateway-ukp6ew.v2.appdeploy.ai',
    'https://business-os-api-gateway.netlify.app',
})
STORAGE_ONLY_ORIGINS = frozenset({'http://127.0.0.1:9000', 'https://bos-local.invalid'})
BLOCKED_FUNCTIONS = frozenset({
    'push-api', 'vk-auth', 'vk-session-api', 'avito-api',
    'avito-assistant-api', 'hands-api', 'hands-report-api',
    'drive-archive-api', 'gas-bridge-health', 'integration-api',
})
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; "
       "style-src 'self' 'unsafe-inline'; connect-src 'self'; "
       "img-src 'self' data: blob:; font-src 'self' data:; "
       "media-src 'self' blob:; worker-src 'none'; frame-src 'none'; "
       "object-src 'none'; base-uri 'self'; form-action 'self'; "
       "frame-ancestors 'none'")
_FUNCTION = re.compile(r'^/(?:functions/v1|api/proxy)/([a-z0-9][a-z0-9-]*)/?$')
_APP_PREFIX = re.compile(r'^/app/business-os-api-gateway-(?:3y8h7e|ukp6ew)(?=/)')
_FORWARD = frozenset({'accept', 'accept-language', 'content-type', 'authorization',
                      'apikey', 'x-bos-session', 'x-client-info', 'range',
                      'if-none-match', 'if-modified-since'})
_HOP = frozenset({'connection', 'keep-alive', 'proxy-authenticate',
                  'proxy-authorization', 'te', 'trailer', 'transfer-encoding',
                  'upgrade', 'content-length', 'set-cookie',
                  'content-security-policy', 'content-security-policy-report-only',
                  'cache-control', 'referrer-policy', 'x-content-type-options',
                  'access-control-allow-origin', 'access-control-allow-credentials'})


def validated_origin(value):
    """Accept only bare HTTP(S) origins, with no embedded credentials."""
    if not isinstance(value, str) or not value or any(ord(c) <= 32 for c in value):
        raise ValueError('LOCAL_ORIGIN_INVALID')
    try:
        p = urlsplit(value)
        port = p.port
    except ValueError:
        raise ValueError('LOCAL_ORIGIN_INVALID') from None
    if (p.scheme not in ('http', 'https') or not p.hostname or p.username is not None
            or p.password is not None or p.path not in ('', '/') or p.query or p.fragment
            or '\\' in value or (port is not None and not 1 <= port <= 65535)):
        raise ValueError('LOCAL_ORIGIN_INVALID')
    host = p.hostname.lower()
    if ':' in host:
        host = '[' + host + ']'
    if port is not None and port != (443 if p.scheme == 'https' else 80):
        host += ':' + str(port)
    return p.scheme + '://' + host


def _api_path(path):
    decoded = _APP_PREFIX.sub('', unquote(path, errors='strict'))
    match = _FUNCTION.fullmatch(decoded)
    if match:
        return '/functions/v1/' + match[1]
    if path.startswith('/storage/v1/'):
        return path
    return None


def rewrite_url(value, local_origin, allowed_origins, *, asset=False):
    """Return a local URL, or None when an external URL is not mapped."""
    if not isinstance(value, str) or any(ord(c) < 32 for c in value) or '\\' in value:
        return None
    try:
        p = urlsplit(value)
        if p.username is not None or p.password is not None:
            return None
        if not p.scheme and not p.netloc:
            mapped = _api_path(p.path)
            return urlunsplit(('', '', mapped or p.path, p.query, p.fragment))
        origin = validated_origin((p.scheme or 'http') + '://' + p.netloc)
    except ValueError:
        return None
    if origin == local_origin:
        return local_origin + urlunsplit(('', '', _api_path(p.path) or p.path or '/', p.query, p.fragment))
    if origin in STORAGE_ONLY_ORIGINS:
        if not p.path.startswith('/storage/v1/'):
            return None
        return local_origin + urlunsplit(('', '', p.path, p.query, p.fragment))
    if origin not in allowed_origins:
        return None
    mapped = _api_path(p.path)
    if mapped is None and asset:
        mapped = p.path or '/'
    if mapped is None:
        return None
    return local_origin + urlunsplit(('', '', mapped, p.query, p.fragment))


_GUARD = r'''(()=>{
'use strict';
const allowed=new Set(__ORIGINS__), blocked=new Set(__BLOCKED__), base=location.origin;
const storageOnly=new Set(__STORAGE_ORIGINS__);
const nativeFetch=window.fetch.bind(window);
const blockedMessage='Внешняя интеграция отключена в локальной проверке восстановления.';
function remap(value,asset=false){
 const u=new URL(String(value),base+'/');
 if(asset&&u.protocol==='blob:'&&u.origin===base)return {url:u.href,disabled:false};
 if(!/^https?:$/.test(u.protocol)||u.username||u.password)throw new TypeError('LOCAL_DRILL_EXTERNAL_BLOCKED');
 const same=u.origin===base;
 const storageOrigin=storageOnly.has(u.origin);
 if(storageOrigin&&!u.pathname.startsWith('/storage/v1/'))throw new TypeError('LOCAL_DRILL_EXTERNAL_BLOCKED');
 if(!same&&!storageOrigin&&!allowed.has(u.origin))throw new TypeError('LOCAL_DRILL_EXTERNAL_BLOCKED');
 let p=u.pathname.replace(/^\/app\/business-os-api-gateway-(?:3y8h7e|ukp6ew)(?=\/)/,'');
 const m=p.match(/^\/(?:functions\/v1|api\/proxy)\/([a-z0-9][a-z0-9-]*)\/?$/);
 if(m)p='/functions/v1/'+m[1];
 else if(!same&&!p.startsWith('/storage/v1/')&&!asset)throw new TypeError('LOCAL_DRILL_EXTERNAL_BLOCKED');
 u.protocol=location.protocol;u.host=location.host;u.pathname=p;
 return {url:u.href,disabled:!!(m&&blocked.has(m[1]))||p==='/api/gas-report'};
}
window.fetch=async function(input,init){
 const request=new Request(input,init),mapped=remap(request.url);
 if(mapped.disabled)return new Response(JSON.stringify({ok:false,error:blockedMessage,code:'LOCAL_DRILL_EXTERNAL_DISABLED'}),{status:501,headers:{'Content-Type':'application/json'}});
 // Passing Request as RequestInit exposes its ReadableStream body. Chromium
 // then requires a streaming-capable HTTP/2 connection, while this loopback
 // portal deliberately speaks ordinary HTTP/1. Preserve a finite byte body.
 const options={method:request.method,headers:request.headers,mode:request.mode,
  credentials:request.credentials,cache:request.cache,redirect:'error',
  referrer:request.referrer,referrerPolicy:request.referrerPolicy,
  integrity:request.integrity,keepalive:request.keepalive,signal:request.signal};
 if(request.body!==null){options.body=await request.arrayBuffer();if(options.body.byteLength>33554432)return new Response(JSON.stringify({ok:false,code:'LOCAL_DRILL_BODY_TOO_LARGE'}),{status:413,headers:{'Content-Type':'application/json'}})}
 return nativeFetch(mapped.url,options);
};
if(window.XMLHttpRequest){const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...args){const mapped=remap(url);if(mapped.disabled)throw new DOMException(blockedMessage,'SecurityError');return open.call(this,method,mapped.url,...args)}}
if(navigator.sendBeacon){const beacon=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(url,data){try{const mapped=remap(url);return !mapped.disabled&&beacon(mapped.url,data)}catch(_){return false}}}
const nativeOpen=window.open.bind(window);
window.open=function(url,target,features){try{const mapped=remap(url||base+'/',true);if(mapped.disabled)return null;return nativeOpen(mapped.url,target,features)}catch(_){return null}};
document.addEventListener('click',event=>{const a=event.target?.closest?.('a[href]');if(!a)return;try{const mapped=remap(a.href,true);if(mapped.disabled)throw Error();a.href=mapped.url}catch(_){event.preventDefault();event.stopImmediatePropagation()}},true);
// API JSON can contain captured public media URLs which are inserted directly
// into img/video attributes. CSP denies the original external load; then this
// observer retries only recognized origins through the local portal.
function fixElement(element){
 if(!element?.getAttribute)return;
 for(const name of ['src','href','poster']){
  const old=element.getAttribute(name);if(!old||!/^https?:\/\//i.test(old))continue;
  try{const mapped=remap(old,true);if(!mapped.disabled&&mapped.url!==old)element.setAttribute(name,mapped.url)}catch(_){}
 }
 const srcset=element.getAttribute('srcset');
 if(srcset){const next=srcset.replace(/(^|,\s*)(https?:\/\/[^\s,]+)/gi,(all,prefix,url)=>{try{return prefix+remap(url,true).url}catch(_){return all}});if(next!==srcset)element.setAttribute('srcset',next)}
}
function scan(node){fixElement(node);node?.querySelectorAll?.('[src],[href],[poster],[srcset]').forEach(fixElement)}
if(typeof MutationObserver==='function'&&document.documentElement){
 const observer=new MutationObserver(records=>{for(const record of records){if(record.type==='attributes')fixElement(record.target);else for(const node of record.addedNodes)scan(node)}});
 observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','href','poster','srcset']});scan(document.documentElement);
}
// Prevent the VK bootstrap from inserting remote bridge scripts. Local password
// login remains the genuine captured login flow; VK is unavailable in a drill.
if(!window.vkBridge)window.vkBridge={send:()=>Promise.reject(new Error(blockedMessage)),subscribe:()=>{},unsubscribe:()=>{}};
window.BOS_LOCAL_DRILL=true;
})();'''


def guard_script(allowed_origins):
    return (_GUARD.replace('__ORIGINS__', json.dumps(sorted(allowed_origins)))
            .replace('__STORAGE_ORIGINS__', json.dumps(sorted(STORAGE_ONLY_ORIGINS)))
            .replace('__BLOCKED__', json.dumps(sorted(BLOCKED_FUNCTIONS)))).encode('utf-8')


def rewrite_html(data, local_origin, allowed_origins):
    def attribute(match):
        before, quote, raw = match.group(1), match.group(2), match.group(3)
        mapped = rewrite_url(html.unescape(raw), local_origin, allowed_origins, asset=True)
        return match.group(0) if mapped is None else before + quote + html.escape(mapped, quote=True) + quote
    class Rewriter(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=False)
            self.parts = []
        def start(self):
            self.parts.append(re.sub(r'(\b(?:src|href)\s*=\s*)([\'"])(.*?)\2',
                                    attribute, self.get_starttag_text(), flags=re.I | re.S))
        def handle_starttag(self, tag, attrs): self.start()
        def handle_startendtag(self, tag, attrs): self.start()
        def handle_endtag(self, tag): self.parts.append('</' + tag + '>')
        def handle_data(self, data): self.parts.append(data)
        def handle_entityref(self, name): self.parts.append('&' + name + ';')
        def handle_charref(self, name): self.parts.append('&#' + name + ';')
        def handle_comment(self, data): self.parts.append('<!--' + data + '-->')
        def handle_decl(self, data): self.parts.append('<!' + data + '>')
        def handle_pi(self, data): self.parts.append('<?' + data + '>')
        def unknown_decl(self, data): self.parts.append('<![' + data + ']>')
    parser = Rewriter()
    parser.feed(data.decode('utf-8'))
    parser.close()
    value = ''.join(parser.parts)
    tag = '<script src="' + GUARD_PATH + '"></script>'
    head = re.search(r'<head\b[^>]*>', value, flags=re.I)
    if head:
        value = value[:head.end()] + tag + value[head.end():]
    else:
        value = tag + value
    return value.encode('utf-8')


class LocalPortal:
    """Bind immediately; start serve_forever in a launcher-owned thread."""
    def __init__(self, transport, allowed_origins=(), profile_dir=None):
        self.transport = transport
        self.allowed_origins = KNOWN_ORIGINS | frozenset(validated_origin(x) for x in allowed_origins)
        self.profile_dir = Path(profile_dir) if profile_dir is not None else None
        self._serving = threading.Event()
        self.browser = None
        portal = self

        class Handler(BaseHTTPRequestHandler):
            server_version = 'BOS-Local-Drill'
            sys_version = ''
            timeout = 30

            def log_message(self, *args):
                pass  # Request paths and bodies may contain private customer data.

            def result(self, status, body=b'', headers=None):
                self.send_response(status)
                for key, value in (headers or {}).items():
                    if (key.lower() not in _HOP and re.fullmatch(r'[A-Za-z0-9-]+', key)
                            and isinstance(value, str) and '\r' not in value and '\n' not in value):
                        self.send_header(key, value)
                self.send_header('Content-Security-Policy', CSP)
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Referrer-Policy', 'no-referrer')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Connection', 'close')
                self.end_headers()
                if self.command != 'HEAD':
                    self.wfile.write(body)
                self.close_connection = True

            def error(self, status, code):
                self.result(status, json.dumps({'ok': False, 'code': code}).encode(),
                            {'Content-Type': 'application/json; charset=utf-8'})

            def do_CONNECT(self):
                self.error(403, 'LOCAL_DRILL_EXTERNAL_BLOCKED')

            def request(self):
                hosts = self.headers.get_all('Host') or []
                if hosts != [portal.host]:
                    self.error(403, 'LOCAL_DRILL_HOST_REJECTED'); return
                if self.headers.get('Sec-Fetch-Site', '').lower() == 'cross-site':
                    self.error(403, 'LOCAL_DRILL_CROSS_SITE_REJECTED'); return
                origins = self.headers.get_all('Origin') or []
                if len(origins) > 1 or (origins and origins[0] != portal.origin):
                    self.error(403, 'LOCAL_DRILL_ORIGIN_REJECTED'); return
                referer = self.headers.get('Referer')
                if referer:
                    try:
                        parsed = urlsplit(referer)
                        if validated_origin(parsed.scheme + '://' + parsed.netloc) != portal.origin:
                            raise ValueError()
                    except ValueError:
                        self.error(403, 'LOCAL_DRILL_ORIGIN_REJECTED'); return
                path = self.path
                try:
                    parsed = urlsplit(path)
                    if parsed.scheme or parsed.netloc:
                        if (validated_origin(parsed.scheme + '://' + parsed.netloc) != portal.origin
                                or parsed.username is not None or parsed.password is not None):
                            raise ValueError()
                        path = urlunsplit(('', '', parsed.path or '/', parsed.query, ''))
                    if not path.startswith('/') or path.startswith('//') or '\\' in path or parsed.fragment:
                        raise ValueError()
                    decoded = unquote(parsed.path, errors='strict')
                    if ('\\' in decoded or any(ord(c) < 32 or ord(c) == 127 for c in decoded)
                            or any(part in ('.', '..') for part in decoded.split('/'))):
                        raise ValueError()
                except ValueError:
                    self.error(403, 'LOCAL_DRILL_EXTERNAL_BLOCKED'); return
                lengths = self.headers.get_all('Content-Length') or []
                if self.headers.get('Transfer-Encoding') is not None or len(lengths) > 1:
                    self.error(400, 'LOCAL_DRILL_BODY_INVALID'); return
                try:
                    if lengths and not re.fullmatch(r'[0-9]+', lengths[0]):
                        raise ValueError()
                    length = int(lengths[0]) if lengths else 0
                except ValueError:
                    self.error(400, 'LOCAL_DRILL_BODY_INVALID'); return
                if length > MAX_BODY:
                    self.error(413, 'LOCAL_DRILL_BODY_TOO_LARGE'); return
                body = self.rfile.read(length) if length else b''
                if len(body) != length:
                    self.error(400, 'LOCAL_DRILL_BODY_INVALID'); return
                parsed = urlsplit(path)
                mapped = _api_path(parsed.path)
                if mapped:
                    path = urlunsplit(('', '', mapped, parsed.query, ''))
                match = _FUNCTION.fullmatch(mapped or parsed.path)
                if ((match and match[1] in BLOCKED_FUNCTIONS)
                        or parsed.path == '/api/gas-report'):
                    payload = {'ok': False, 'code': 'LOCAL_DRILL_EXTERNAL_DISABLED',
                               'error': 'Внешняя интеграция отключена в локальной проверке восстановления.'}
                    self.result(501, json.dumps(payload, ensure_ascii=False).encode(),
                                {'Content-Type': 'application/json; charset=utf-8'}); return
                if parsed.path == GUARD_PATH:
                    if self.command not in ('GET', 'HEAD'):
                        self.error(405, 'LOCAL_DRILL_METHOD_REJECTED'); return
                    self.result(200, guard_script(portal.allowed_origins),
                                {'Content-Type': 'text/javascript; charset=utf-8'}); return
                forwarded = {key: value for key, value in self.headers.items() if key.lower() in _FORWARD}
                forwarded['Accept-Encoding'] = 'identity'
                try:
                    status, headers, output = portal.transport(self.command, path, forwarded, body)
                    if not isinstance(status, int) or not 100 <= status <= 599 or not isinstance(output, bytes):
                        raise ValueError()
                    headers = dict(headers)
                    lowered = {key.lower(): value for key, value in headers.items()}
                    encoding = lowered.get('content-encoding', 'identity')
                    is_html = 'text/html' in lowered.get('content-type', '').lower()
                    if is_html and encoding not in ('', 'identity'):
                        raise ValueError()
                    if 'location' in lowered:
                        location = rewrite_url(lowered['location'], portal.origin, portal.allowed_origins, asset=True)
                        if location is None:
                            self.error(403, 'LOCAL_DRILL_REDIRECT_BLOCKED'); return
                        headers = {key: value for key, value in headers.items() if key.lower() != 'location'}
                        headers['Location'] = location
                    if is_html and self.command != 'HEAD':
                        output = rewrite_html(output, portal.origin, portal.allowed_origins)
                    self.result(status, output, headers)
                except (BrokenPipeError, ConnectionResetError):
                    return
                except Exception:
                    self.error(502, 'LOCAL_DRILL_UPSTREAM_UNAVAILABLE')

            do_GET = request
            do_HEAD = request
            do_POST = request
            do_PUT = request
            do_PATCH = request
            do_DELETE = request
            do_OPTIONS = request

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.host = '127.0.0.1:' + str(self.server.server_address[1])
        self.origin = 'http://' + self.host

    def serve_forever(self):
        self._serving.set()
        try:
            self.server.serve_forever(poll_interval=0.2)
        finally:
            self._serving.clear()

    def shutdown(self):
        if self._serving.is_set():
            self.server.shutdown()
        self.server.server_close()

    def open_browser(self):
        """Start an isolated Edge profile with a mandatory deny-external proxy.

        Return False when Edge is absent. Never use the default browser because
        it would not inherit this process's network guard.
        """
        if os.name != 'nt' or self.profile_dir is None:
            return False
        candidates = []
        for variable in ('PROGRAMFILES(X86)', 'PROGRAMFILES', 'LOCALAPPDATA'):
            base = os.environ.get(variable)
            if base:
                candidates.append(Path(base) / 'Microsoft/Edge/Application/msedge.exe')
        executable = next((path for path in candidates if path.is_file()), None)
        if executable is None:
            return False
        # Never attach to an existing profile/process that could ignore the new
        # proxy arguments or carry an old service worker and production session.
        if self.profile_dir.exists() and any(self.profile_dir.iterdir()):
            return False
        try:
            self.profile_dir.mkdir(parents=True, exist_ok=True)
            downloads = self.profile_dir.parent / 'Downloads'
            downloads.mkdir(parents=True, exist_ok=True)
            default_profile = self.profile_dir / 'Default'
            default_profile.mkdir()
            # Fresh profiles do not inherit the normal browser's download
            # directory. Keep exports beside this package on the user's E drive.
            preferences = {'download': {'default_directory': str(downloads.resolve()),
                                        'directory_upgrade': True, 'prompt_for_download': False},
                           'savefile': {'default_directory': str(downloads.resolve())}}
            with (default_profile / 'Preferences').open('x', encoding='utf-8') as stream:
                json.dump(preferences, stream, ensure_ascii=False)
        except OSError:
            return False
        args = [str(executable), '--user-data-dir=' + str(self.profile_dir.resolve()),
                '--proxy-server=' + self.origin, '--proxy-bypass-list=<-loopback>',
                '--disable-quic', '--disable-background-networking', '--disable-sync',
                '--disable-extensions', '--no-first-run', '--no-default-browser-check',
                '--disable-component-update', '--disable-domain-reliability',
                '--disable-features=MediaRouter,OptimizationHints,AutofillServerCommunication',
                '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
                '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
                '--new-window', self.origin + '/']
        try:
            self.browser = subprocess.Popen(args, stdin=subprocess.DEVNULL,
                                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            return False
        return True
