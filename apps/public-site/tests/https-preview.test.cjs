"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { configCheck } = require("../../../client-portal/server/api.cjs");
const { createIntegratedStaging } = require("../../../client-portal/staging/integrated.cjs");
const origin = "https://preview.example.invalid";

test("HTTPS preview requires exact opt-in and cannot weaken production or isolation", () => {
  const base = {
    environment: "staging", origin, websiteEnabled: true, isolated: true,
    smsTransport: "test", otpPepper: "a".repeat(48), staffSecret: "b".repeat(48),
    privateDir: "/synthetic-private", stagingHttpsOrigin: origin,
  };
  assert.doesNotThrow(() => configCheck(base));
  for (const change of [
    { stagingHttpsOrigin: undefined }, { stagingHttpsOrigin: "https://other.example.invalid" },
    { websiteEnabled: false }, { isolated: false }, { smsTransport: "gateway" },
    { environment: "production" }, { environment: "test" },
  ]) assert.throws(() => configCheck({ ...base, ...change }));
  for (const invalid of ["http://preview.example.invalid", "https://*.example.invalid",
    origin + "/", origin + "/path", origin + "?query=1", origin + "#fragment",
    "https://user:pass@preview.example.invalid"])
    assert.throws(() => configCheck({ ...base, origin: invalid, stagingHttpsOrigin: invalid }));
  assert.doesNotThrow(() => configCheck({ ...base, origin: "http://127.0.0.1:4185", stagingHttpsOrigin: "" }));
});

for (const origin of ["https://preview.example.invalid", "https://139.100.237.167:8443"])
test(`persisted staging restarts at ${origin}, accepts its forms and issues Secure cookies`, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bos-https-preview-"));
  const options = { dataDir: path.join(directory, "db"), privateDir: path.join(directory, "private"), websiteEnabled: true };
  let stage;
  try {
    stage = await createIntegratedStaging({ ...options, origin: "http://127.0.0.1:4185" });
    const before = await fs.readFile(path.join(options.privateDir, "access.json"), "utf8");
    await stage.close();
    stage = null;
    stage = await createIntegratedStaging({ ...options, origin, stagingHttpsOrigin: origin });
    assert.equal(await fs.readFile(path.join(options.privateDir, "access.json"), "utf8"), before);
    const call = (route, body, requestOrigin = origin) => stage.handle(new Request(origin + route, {
      method: body ? "POST" : "GET", headers: {
        ...(requestOrigin ? { Origin: requestOrigin } : {}), "content-type": "application/json",
      }, ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    const health = await (await call("/client-api/health")).json();
    assert.equal(health.environment, "staging");
    assert.equal(health.delivery, "test");
    const payload = { phone: "+79990009971" };
    for (const badOrigin of ["https://other.example.invalid", "https://139.100.237.167",
      "https://139.100.237.167:9443", "http://127.0.0.1:4185", ""])
      assert.equal((await call("/client-api/auth/request", payload, badOrigin)).status, 403);
    const challenge = await call("/client-api/auth/request", payload);
    assert.equal(challenge.status, 200);
    const data = await challenge.json();
    assert.equal(Object.hasOwn(data, "code"), false);
    const otp = JSON.parse(await fs.readFile(path.join(options.privateDir, "otp", data.challenge_id + ".json"), "utf8"));
    const { documents } = await (await call("/client-api/documents")).json();
    const login = await call("/client-api/auth/verify", {
      challenge_id: data.challenge_id, code: otp.code,
      consents: documents.filter(d => d.required).map(({ document, version }) => ({ document, version })),
    });
    assert.equal(login.status, 200);
    assert.match(login.headers.get("set-cookie"), /; Secure;/);
    assert.match(login.headers.get("set-cookie"), /; HttpOnly;/);
    assert.match(login.headers.get("set-cookie"), /; SameSite=Strict;/);
    assert.equal((await call("/.public-site-stage/private/access.json")).status, 404);
  } finally {
    if (stage) await stage.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
