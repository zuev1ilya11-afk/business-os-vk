#!/usr/bin/env python3
"""One durable archive job per invocation. Run with the supplied systemd timer."""
import json
import os
import sys
from urllib.request import Request, urlopen
from urllib.parse import urlsplit

def main():
    url = os.environ.get('BOS_DRIVE_WORKER_URL', '')
    key = os.environ.get('BOS_DRIVE_WORKER_KEY', '')
    parsed = urlsplit(url)
    if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password or len(key) < 32:
        raise ValueError('Worker configuration missing or invalid')
    if parsed.path != '/functions/v1/drive-archive-api' or parsed.query or parsed.fragment:
        raise ValueError('Invalid worker route')
    request = Request(url, data=b'{"action":"worker"}', method='POST', headers={
        'Content-Type': 'application/json', 'X-BOS-Drive-Worker': key,
    })
    # Redirects must not forward the worker credential to another host.
    from urllib.request import HTTPRedirectHandler, build_opener
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    with build_opener(NoRedirect).open(request, timeout=85) as response:
        result = json.loads(response.read(65536))
    if not result.get('ok'):
        raise ValueError('Worker did not confirm processing')
    print(json.dumps({k: result[k] for k in ('processed', 'archive_status') if k in result}))

if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Never put request URLs, response bodies, signed file URLs or credentials in journald.
        print('Archive worker unavailable; durable queue will retry.', file=sys.stderr)
        sys.exit(1)
