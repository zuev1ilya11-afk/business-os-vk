"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { randomUUID } = require("node:crypto");
const { handler } = require("../lib/intake.cjs");
const { version } = require("../lib/intake-terms.json");

test("callback validates before writing and only confirms database acceptance", async () => {
  const writes = [];
  let result = "accepted";
  const db = { async query(sql, args) {
    writes.push(args);
    if (result === "unavailable") throw Error();
    return { rows: [{ result }] };
  }};
  const publicOrigin = "https://company.example";
  const submit = handler(db, publicOrigin, false);
  const payload = { id: randomUUID(), phone:"8 (999) 555-20-99", name:" Клиент ", description:"Повесить карниз", kind:"home", consent:true, version };
  async function send(body, origin = publicOrigin) {
    const request = Readable.from([Buffer.from(JSON.stringify(body))]);
    Object.assign(request, { method:"POST", headers:{ origin, "content-type":"application/json" }, socket:{ remoteAddress:"127.0.0.1" } });
    const response = {
      status:0, body:null,
      writeHead(status) { this.status = status; },
      end(value) { this.body = JSON.parse(value); },
    };
    await submit(request, response);
    return response;
  }
  assert.equal((await send(payload, "https://other.example")).status, 403);
  for (const field of [{ consent:false }, { kind:"other" }, { version:"old" }, { phone:"bad" }])
    assert.equal((await send({...payload, ...field})).status, 400);
  assert.equal(writes.length, 0);
  const ok = await send(payload);
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body, { accepted:true });
  assert.deepEqual(writes[0], [payload.id,"Клиент","+79995552099",payload.description,"home",version]);
  for (const [outcome, status] of [["conflict",409], ["limited",429], ["unavailable",503]]) {
    result = outcome;
    const response = await send(payload);
    assert.equal(response.status, status);
    assert.equal(response.body.accepted, undefined);
  }
});
