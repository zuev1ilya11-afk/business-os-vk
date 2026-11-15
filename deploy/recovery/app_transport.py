"""Bounded binary transport to loopback services in an isolated Docker container.

No host-side network connection is made. The caller supplies an already pinned
local Docker runner; request bytes travel over docker exec's standard input.
"""
import http.client
import io
import math
import os
import re
import subprocess
import threading
import time

from backup import Stop


MIB = 1024 * 1024
MAX_BODY = 32 * MIB
MAX_HEADERS = 65536
SERVICE_PORTS = frozenset({18080, 9000, 5000, 3000, 9999})
_TOKEN = re.compile(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+")
_METHODS = frozenset({'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'})
_FORWARD = frozenset({'accept', 'accept-language', 'content-type', 'authorization',
                      'apikey', 'x-bos-session', 'x-client-info', 'range',
                      'if-none-match', 'if-modified-since', 'cache-control',
                      'pragma', 'x-upsert', 'origin', 'referer',
                      'x-vk-launch-params', 'accept-encoding'})
_HOP = frozenset({'connection', 'keep-alive', 'proxy-authenticate',
                  'proxy-authorization', 'te', 'trailer', 'transfer-encoding',
                  'upgrade'})


def _require(condition, reason):
    if not condition:
        raise Stop(reason)


def input_call(runner, args, data, *, timeout=90, limit=64 * MIB):
    """Run pinned Docker with bounded concurrent binary stdin/stdout/stderr."""
    runner.last_error = b''
    _require(isinstance(data, bytes) and len(data) <= 64 * MIB,
             'APP_DOCKER_INPUT_LIMIT')
    _require(isinstance(timeout, (int, float)) and not isinstance(timeout, bool)
             and math.isfinite(timeout) and 0 < timeout <= 3600,
             'APP_DOCKER_ARGUMENT_INVALID')
    _require(isinstance(limit, int) and not isinstance(limit, bool)
             and 0 < limit <= 256 * MIB, 'APP_DOCKER_ARGUMENT_INVALID')
    _require(isinstance(args, (list, tuple)) and args
             and all(isinstance(a, str) and '\0' not in a for a in args),
             'APP_DOCKER_ARGUMENT_INVALID')
    stdout, stderr = bytearray(), bytearray()
    overflow, io_error = threading.Event(), threading.Event()
    try:
        process = subprocess.Popen(runner._command(args), stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   env=runner.env, bufsize=0)
    except (OSError, ValueError):
        raise Stop('APP_DOCKER_START_FAILED') from None

    def read(stream, output, maximum):
        try:
            while True:
                block = os.read(stream.fileno(), 65536)
                if not block:
                    break
                remaining = maximum - len(output)
                output.extend(block[:remaining])
                if len(block) > remaining:
                    overflow.set()
                    break
        except (OSError, ValueError):
            io_error.set()
        finally:
            stream.close()

    def write():
        try:
            view = memoryview(data)
            position = 0
            while position < len(view):
                count = os.write(process.stdin.fileno(), view[position:position + 65536])
                if count <= 0:
                    io_error.set()
                    break
                position += count
        except (OSError, ValueError):
            io_error.set()
        finally:
            process.stdin.close()

    threads = [threading.Thread(target=write, daemon=True),
               threading.Thread(target=read, args=(process.stdout, stdout, limit), daemon=True),
               threading.Thread(target=read, args=(process.stderr, stderr, MIB), daemon=True)]
    deadline = time.monotonic() + timeout
    try:
        for thread in threads:
            thread.start()
        while process.poll() is None:
            _require(not overflow.is_set(), 'APP_DOCKER_OUTPUT_LIMIT')
            _require(time.monotonic() < deadline, 'APP_DOCKER_COMMAND_TIMEOUT')
            time.sleep(min(0.025, max(0, deadline - time.monotonic())))
        for thread in threads:
            thread.join(timeout=max(0, min(5, deadline - time.monotonic())))
        _require(not any(t.is_alive() for t in threads), 'APP_DOCKER_OUTPUT_TIMEOUT')
        _require(not overflow.is_set(), 'APP_DOCKER_OUTPUT_LIMIT')
        _require(process.returncode == 0, 'APP_DOCKER_COMMAND_FAILED')
        _require(not io_error.is_set(), 'APP_DOCKER_PIPE_FAILED')
        return bytes(stdout)
    finally:
        if process.poll() is None:
            process.kill()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        for stream in (process.stdin, process.stdout, process.stderr):
            try:
                stream.close()
            except OSError:
                pass
        for thread in threads:
            if thread.ident is not None:
                thread.join(timeout=1)
        runner.last_error = bytes(stderr[:8192])


def _header_value(value):
    return (isinstance(value, str)
            and all((32 <= ord(c) <= 255 and ord(c) != 127) or c == '\t' for c in value))


def _request(method, path, headers, body, port):
    _require(isinstance(method, str) and method in _METHODS, 'APP_HTTP_REQUEST_INVALID')
    _require(isinstance(path, str) and path.startswith('/') and not path.startswith('//')
             and '\\' not in path and '#' not in path
             and all(33 <= ord(c) <= 126 for c in path)
             and len(path) <= 16384, 'APP_HTTP_REQUEST_INVALID')
    _require(isinstance(body, bytes) and len(body) <= MAX_BODY, 'APP_HTTP_BODY_LIMIT')
    _require(isinstance(headers, dict), 'APP_HTTP_REQUEST_INVALID')
    lines = [f'{method} {path} HTTP/1.1', f'Host: localhost:{port}',
             'Connection: close', f'Content-Length: {len(body)}',
             'Accept-Encoding: identity']
    seen = set()
    for key, value in headers.items():
        _require(isinstance(key, str) and _TOKEN.fullmatch(key) and _header_value(value),
                 'APP_HTTP_REQUEST_INVALID')
        name = key.lower()
        _require(name not in seen and name != 'transfer-encoding', 'APP_HTTP_REQUEST_INVALID')
        seen.add(name)
        if name in _FORWARD and name != 'accept-encoding':
            lines.append(key + ': ' + value)
    header = ('\r\n'.join(lines) + '\r\n\r\n').encode('latin-1')
    _require(len(header) <= MAX_HEADERS, 'APP_HTTP_HEADER_LIMIT')
    return header + body


class _Buffer(io.BytesIO):
    # HTTPResponse closes its stream on a complete body. Keep its position for
    # the trailing-byte check, then close it explicitly in the parser's finally.
    def close(self):
        pass


class _Socket:
    def __init__(self, stream):
        self.stream = stream

    def makefile(self, *args, **kwargs):
        return self.stream


def _validate_response_headers(raw):
    offset = 0
    for _ in range(6):
        end = raw.find(b'\r\n\r\n', offset, offset + MAX_HEADERS + 1)
        _require(end >= 0, 'APP_HTTP_RESPONSE_INVALID')
        lines = raw[offset:end].split(b'\r\n')
        match = re.fullmatch(rb'HTTP/1\.[01] ([1-5][0-9]{2})(?: [\x20-\x7e\x80-\xff]*)?', lines[0])
        _require(match is not None and len(lines) <= 101, 'APP_HTTP_RESPONSE_INVALID')
        values = {}
        for line in lines[1:]:
            _require(len(line) <= 8192 and b':' in line, 'APP_HTTP_RESPONSE_INVALID')
            name, value = line.split(b':', 1)
            key = name.decode('latin-1').lower()
            _require(_TOKEN.fullmatch(key) and _header_value(value.decode('latin-1')),
                     'APP_HTTP_RESPONSE_INVALID')
            values.setdefault(key, []).append(value.strip().decode('latin-1'))
        _require(not ('content-length' in values and 'transfer-encoding' in values),
                 'APP_HTTP_RESPONSE_INVALID')
        if 'content-length' in values:
            lengths = values['content-length']
            _require(len(lengths) == 1 and re.fullmatch(r'[0-9]{1,10}', lengths[0]),
                     'APP_HTTP_RESPONSE_INVALID')
        if 'transfer-encoding' in values:
            _require(values['transfer-encoding'] == ['chunked'], 'APP_HTTP_RESPONSE_INVALID')
        status = int(match[1])
        if status == 100:
            _require('content-length' not in values and 'transfer-encoding' not in values,
                     'APP_HTTP_RESPONSE_INVALID')
            offset = end + 4
            continue
        _require(status >= 200, 'APP_HTTP_RESPONSE_INVALID')
        return status, values, end + 4
    raise Stop('APP_HTTP_RESPONSE_INVALID')


def _validate_chunks(raw, offset):
    """HTTPResponse tolerates missing chunk CRLFs; reject those before decoding."""
    total = 0
    while True:
        end = raw.find(b'\r\n', offset, offset + 8193)
        _require(end >= 0, 'APP_HTTP_RESPONSE_INVALID')
        line = raw[offset:end]
        size = line.split(b';', 1)[0]
        _require(re.fullmatch(rb'[0-9a-fA-F]{1,16}', size)
                 and all(32 <= c <= 126 for c in line), 'APP_HTTP_RESPONSE_INVALID')
        count = int(size, 16)
        offset = end + 2
        if count == 0:
            break
        total += count
        _require(total <= MAX_BODY, 'APP_HTTP_BODY_LIMIT')
        _require(raw[offset + count:offset + count + 2] == b'\r\n',
                 'APP_HTTP_RESPONSE_INVALID')
        offset += count + 2
    trailer_start = offset
    for _ in range(101):
        end = raw.find(b'\r\n', offset, offset + 8193)
        _require(end >= 0 and end + 2 - trailer_start <= MAX_HEADERS,
                 'APP_HTTP_RESPONSE_INVALID')
        line = raw[offset:end]
        offset = end + 2
        if not line:
            _require(offset == len(raw), 'APP_HTTP_RESPONSE_INVALID')
            return
        _require(b':' in line, 'APP_HTTP_RESPONSE_INVALID')
        key, value = line.split(b':', 1)
        name = key.decode('latin-1').lower()
        _require(_TOKEN.fullmatch(name) and _header_value(value.decode('latin-1'))
                 and name not in _HOP and name != 'content-length',
                 'APP_HTTP_RESPONSE_INVALID')
    raise Stop('APP_HTTP_RESPONSE_INVALID')


def _response(raw, method):
    _require(isinstance(raw, bytes) and len(raw) <= 64 * MIB, 'APP_HTTP_RESPONSE_INVALID')
    status, values, body_offset = _validate_response_headers(raw)
    if 'transfer-encoding' in values and method != 'HEAD' and status not in (204, 304):
        _validate_chunks(raw, body_offset)
    stream = _Buffer(raw)
    response = http.client.HTTPResponse(_Socket(stream), method=method)
    try:
        response.begin()
        expected = response.length
        _require(expected is None or expected <= MAX_BODY, 'APP_HTTP_BODY_LIMIT')
        body = response.read(MAX_BODY + 1)
        _require(len(body) <= MAX_BODY, 'APP_HTTP_BODY_LIMIT')
        _require(expected is None or len(body) == expected, 'APP_HTTP_RESPONSE_INVALID')
        _require(stream.tell() == len(raw), 'APP_HTTP_RESPONSE_INVALID')
        connection = {item.strip().lower()
                      for line in values.get('connection', []) for item in line.split(',')}
        headers = {}
        for key, items in values.items():
            if key in _HOP or key in connection or key == 'content-length':
                continue
            _require(key != 'set-cookie' or len(items) == 1, 'APP_HTTP_RESPONSE_INVALID')
            headers[key] = ', '.join(items)
        headers['content-length'] = str(len(body))
        return response.status, headers, body
    except (http.client.HTTPException, ValueError, OSError, OverflowError):
        raise Stop('APP_HTTP_RESPONSE_INVALID') from None
    finally:
        response.close()
        io.BytesIO.close(stream)


def http_call(runner, anchor_cid, method, path, headers, body, *, port=18080):
    """Issue HTTP to a fixed loopback service inside the network-none anchor."""
    _require(isinstance(anchor_cid, str) and re.fullmatch(r'[0-9a-f]{64}', anchor_cid),
             'APP_HTTP_TARGET_INVALID')
    _require(isinstance(port, int) and not isinstance(port, bool) and port in SERVICE_PORTS,
             'APP_HTTP_TARGET_INVALID')
    request = _request(method, path, headers, body, port)
    raw = input_call(runner, ['exec', '-i', '--user', 'postgres', anchor_cid,
                             '/bin/busybox', 'nc', '-w', '60', '127.0.0.1', str(port)],
                     request, timeout=90, limit=64 * MIB)
    return _response(raw, method)
