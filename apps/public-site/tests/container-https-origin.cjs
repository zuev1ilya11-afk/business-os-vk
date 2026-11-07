"use strict";
// Disposable CI container only: real server restart, origin guard and private OTP.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const base = "http://127.0.0.1:4185";
const origin = "https://preview.example.invalid";
const compose = ["compose", "-f", "apps/public-site/compose.staging.yml"];

async function main() {
  const request = (route, body, extra = {}) => fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: { Origin: origin, "content-type": "application/json", ...extra },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000),
  });
  const health = await (await request("/client-api/health")).json();
  assert.equal(health.environment, "staging");
  assert.equal(health.delivery, "test");
  for (const route of ["/", "/services", "/client/"])
    assert.equal((await request(route)).status, 200);
  const payload = { phone: "+79990009972" };
  assert.equal((await request("/client-api/auth/request", payload, { Origin: "https://wrong.example.invalid" })).status, 403);
  const challengeResponse = await request("/client-api/auth/request", payload);
  assert.equal(challengeResponse.status, 200);
  const challenge = await challengeResponse.json();
  assert.match(challenge.challenge_id, /^[a-f0-9-]{36}$/);
  assert.equal(Object.hasOwn(challenge, "code"), false);
  const container = execFileSync("docker", [...compose, "ps", "-q", "public-site-staging"], { encoding: "utf8" }).trim();
  assert.match(container, /^[a-f0-9]{12,64}$/);
  // Read synthetic OTP into memory only; never emit it or session data in logs.
  const reader = "const fs=require('node:fs');process.stdout.write(fs.readFileSync('/app/.public-site-stage/private/otp/'+process.argv[1]+'.json'))";
  const otp = JSON.parse(execFileSync("docker", ["exec", container, "node", "-e", reader, challenge.challenge_id], { encoding: "utf8" }));
  const { documents } = await (await request("/client-api/documents")).json();
  const login = await request("/client-api/auth/verify", {
    challenge_id: challenge.challenge_id, code: otp.code,
    consents: documents.filter(d => d.required).map(({ document, version }) => ({ document, version })),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert.ok(cookie.includes("; Secure;") && cookie.includes("; HttpOnly;") && cookie.includes("; SameSite=Strict;"));
  const session = await (await request("/client-api/session", undefined, { Cookie: cookie.split(";")[0] })).json();
  assert.equal(session.authenticated, true);
  const catalog = await (await request("/client-api/website/catalog")).json();
  assert.ok(catalog.services.length > 0);
  const quote = await request("/client-api/website/quote", { items: [{ service_id: catalog.services[0].id, quantity: 1 }] });
  assert.equal(quote.status, 200);
  assert.equal((await request("/.public-site-stage/private/access.json")).status, 404);
  console.log("HTTPS_ORIGIN_CONTAINER_OK: restart, pages, form origin, test login, Secure cookie and private-path denial");
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
