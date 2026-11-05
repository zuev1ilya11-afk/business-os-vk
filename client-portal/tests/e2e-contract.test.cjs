'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

test('client PWA stays below /client and only caches an explicit public asset allowlist', () => {
 const manifest = JSON.parse(fs.readFileSync(path.join(root, 'client-portal/public/manifest.webmanifest')));
 assert.equal(manifest.scope, '/client/');
 assert.ok(manifest.start_url.startsWith(manifest.scope));
 const sw = fs.readFileSync(path.join(root, 'client-portal/public/sw.js'), 'utf8');
 assert.match(sw, /!ASSETS\.includes\(url\.pathname\)/);
 assert.doesNotMatch(sw, /cache\.put\([^\n]*(?:client-api|orders|messages)/);
 const html = fs.readFileSync(path.join(root, 'client-portal/public/index.html'), 'utf8');
 assert.match(html, /viewport-fit=cover/);
 assert.doesNotMatch(html, /startup-loader|auth-ui-patch|business-os-custom|supabase.*key/i);
 for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(root, 'client-portal/public', path.basename(icon.src))));
});

test('staff and client entry points are separate documents', () => {
 const staff = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
 const client = fs.readFileSync(path.join(root, 'client-portal/public/index.html'), 'utf8');
 assert.notEqual(staff, client);
 assert.match(client, /\/client\/app\.js/);
 assert.doesNotMatch(client, /bos_vk_session_v2|x-bos-session/);
});
