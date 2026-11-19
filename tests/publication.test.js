const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('publication control belongs to the visible property editor and new projects default to published', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const form = html.match(/<form\b[^>]*id="propertyForm"[^>]*>([\s\S]*?)<\/form>/)?.[1];
  assert.ok(form, 'Property editor exists');
  assert.equal([...html.matchAll(/id="formPublished"/g)].length, 1, 'Publication control must be unique');
  const control = form.match(/<input\b[^>]*id="formPublished"[^>]*>/)?.[0];
  assert.ok(control, 'Publish checkbox must be inside the project editor, not the sidebar link');
  assert.match(control, /\bchecked\b/, 'New projects publish unless the administrator chooses draft');
  const addHandler = html.match(/getElementById\('openAddModalBtn'\)\.addEventListener\('click', \(\) => \{([\s\S]*?)propModal\.showModal\(\);/)?.[1];
  assert.match(addHandler || '', /getElementById\('formPublished'\)\.checked = true/, 'Opening a new project resets publication independently of a previous draft');
});
