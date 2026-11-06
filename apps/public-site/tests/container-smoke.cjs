"use strict";
// Read-only against the explicitly bound synthetic Compose service.
const assert = require("node:assert/strict");
async function main() {
  const base = "http://127.0.0.1:4185";
  for (const route of [
    "/healthz",
    "/",
    "/services",
    "/client-api/website/catalog",
    "/client/",
  ]) {
    const response = await fetch(base + route, {
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200, route);
    if (route === "/healthz")
      assert.equal((await response.json()).environment, "staging");
    else if (route === "/services")
      assert.match(await response.text(), /Замена смесителя/);
  }
  assert.equal(
    (await fetch(base + "/.public-site-stage/private/access.json")).status,
    404,
  );
  console.log(
    "Synthetic container health, SSR, API, cabinet and private-path denial passed.",
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
