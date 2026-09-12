const SUPABASE_BASE = "https://obsropbslfwtanyspjbi.supabase.co/functions/v1";

const ALLOWED = new Set([
  "mini-app-api",
  "password-session-api",
  "vk-session-api",
  "report-file-upload",
  "report-api",
  "master-memo-api",
  "avito-api",
  "integration-api",
  "employee-meta-api",
  "profile-self-api",
  "claims-api",
]);

const ALLOWED_ORIGINS = new Set([
  "https://zuev1ilya11-afk.github.io",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://zuev1ilya11-afk.github.io";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-BOS-Session,Authorization,apikey",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(req),
    },
  });
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return json(req, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const url = new URL(req.url);
  const prefix = "/api/proxy/";
  const index = url.pathname.indexOf(prefix);
  const slug = index >= 0
    ? decodeURIComponent(url.pathname.slice(index + prefix.length)).replace(/^\/+|\/+$/g, "")
    : "";

  if (!slug || slug.includes("/") || !ALLOWED.has(slug)) {
    return json(req, 404, { ok: false, error: "SERVICE_NOT_ALLOWED" });
  }

  const upstreamHeaders = new Headers();
  for (const header of ["content-type", "x-bos-session", "authorization", "apikey"]) {
    const value = req.headers.get(header);
    if (value) upstreamHeaders.set(header, value);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const body = await req.arrayBuffer();
    const upstream = await fetch(`${SUPABASE_BASE}/${slug}`, {
      method: "POST",
      headers: upstreamHeaders,
      body,
      signal: controller.signal,
    });

    const responseHeaders = new Headers(corsHeaders(req));
    const contentType = upstream.headers.get("content-type");
    if (contentType) responseHeaders.set("Content-Type", contentType);

    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return json(req, timedOut ? 504 : 502, {
      ok: false,
      error: timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE",
    });
  } finally {
    clearTimeout(timeout);
  }
};

export const config = {
  path: "/api/proxy/*",
};
