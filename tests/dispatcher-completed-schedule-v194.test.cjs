const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('completed dispatcher orders remain visible in horizontal schedule', () => {
  const source = fs.readFileSync(path.join(root, 'dispatcher-horizontal-schedule-v190.js'), 'utf8');
  assert.match(source, /const active=o=>!!o&&String\(o\?\.status\|\|''\)!=='Отменена'/);
  assert.doesNotMatch(source, /\['Выполнена','Отменена'\]\.includes/);
});

test('PWA loads refreshed horizontal schedule module', () => {
  const source = fs.readFileSync(path.join(root, 'pwa-register.js'), 'utf8');
  assert.match(source, /BOS_ASSET_URL/);
  assert.match(source, /dispatcher-horizontal-schedule-v190\.js/);
});
