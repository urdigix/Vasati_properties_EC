const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_SEARCH_LOCALITIES, validateSearchLocalities, readSearchLocalities } = require('../server/search-localities');

test('search locations preserve order, normalize spacing, and allow an intentionally empty list', () => {
  assert.deepEqual(readSearchLocalities(), ['Electronic City Phase 1', 'Electronic City Phase 2', 'Chandhapura']);
  assert.deepEqual(validateSearchLocalities(['  Phase   1 ', 'Phase 2']), ['Phase 1', 'Phase 2']);
  assert.deepEqual(validateSearchLocalities('["Chandhapura"]'), ['Chandhapura']);
  assert.deepEqual(readSearchLocalities('[]'), []);
  assert.deepEqual(readSearchLocalities('broken JSON'), DEFAULT_SEARCH_LOCALITIES);
});

test('search locations reject malformed, duplicate, excessive, or empty names', () => {
  for (const value of [null, {}, 'not json', [''], ['   '], [42], ['a'.repeat(81)], ['Phase 1', ' phase   1 '], ['x\ny'], Array.from({ length: 101 }, (_, i) => `Place ${i}`)]) {
    assert.throws(() => validateSearchLocalities(value));
  }
});

test('admin startup binds events only to elements that exist in the page', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  for (const match of html.matchAll(/document\.getElementById\('([^']+)'\)\.addEventListener/g)) {
    assert.ok(ids.has(match[1]), `Admin startup would stop because #${match[1]} is missing`);
  }
});
