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

test('PWA loads horizontal schedule through unified BUILD_ID assets', () => {
  const source = fs.readFileSync(path.join(root, 'pwa-register.js'), 'utf8');
  assert.match(source, /['"]\.\/dispatcher-horizontal-schedule-v190\.js['"]/);
  assert.match(source, /script\.src=window\.BOS_ASSET_URL\(src\)/);
  assert.doesNotMatch(source, /dispatcher-horizontal-schedule-v190\.js\?v=/);
});
