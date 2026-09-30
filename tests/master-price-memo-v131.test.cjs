const fs = require('fs');
const assert = require('assert');

const index = fs.readFileSync('index.html', 'utf8');
const patch = fs.readFileSync('master-price-memo-v131.js', 'utf8');

assert(JSON.parse(fs.readFileSync('scripts/startup-assets.json','utf8')).shell.includes('master-price-memo-v131.js'));
assert(index.includes('startup-shell.bundle.js'));
assert(fs.readFileSync('startup-shell.bundle.js','utf8').includes(patch));
assert(patch.includes("kind!=='price'"));
assert(patch.includes('bosPriceRow'));
assert(patch.includes('bosPriceImportant'));
assert(patch.includes('Выберите вид работы'));
