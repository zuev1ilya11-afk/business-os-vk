const fs = require('fs');
const assert = require('assert');

const index = fs.readFileSync('index.html', 'utf8');
const patch = fs.readFileSync('master-price-memo-v131.js', 'utf8');

assert(index.includes('master-price-memo-v131.js'));
assert(patch.includes("kind!=='price'"));
assert(patch.includes('bosPriceRow'));
assert(patch.includes('bosPriceImportant'));
assert(patch.includes('Выберите вид работы'));
