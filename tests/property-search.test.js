const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
function searchClient(fetch) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', hidden: false, textContent: '', innerHTML: '', attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; }
    });
    return elements.get(id);
  };
  const state = { locality: '', kind: 'any', bhk: 'any', budget: 'any', sort: 'recommended', showingSavedOnly: false };
  const rendered = [];
  const context = vm.createContext({ state, AbortController, URLSearchParams, fetch,
    document: { getElementById: element, querySelectorAll: () => [] },
    renderProperties() { rendered.push(vm.runInContext('allProperties', context)); }
  });
  const start = html.indexOf('    function syncSearchControls(');
  const end = html.indexOf('    async function loadFeaturedProjects()', start);
  vm.runInContext('let propertyRequest; let allProperties = [];\n' + html.slice(start, end), context);
  return { state, rendered, element, load: () => context.loadProperties() };
}

test('search sends locality, bedrooms, maximum budget and status to the existing API', async () => {
  const requests = [];
  const client = searchClient(async (url) => {
    requests.push(new URL(url, 'http://localhost'));
    return { ok: true, json: async () => ({ success: true, data: [{ id: 'matched' }] }) };
  });
  Object.assign(client.state, { locality: 'Electronic City', kind: 'Ready', bhk: '3', budget: '150', sort: 'price' });
  await client.load();
  assert.equal(requests[0].searchParams.get('locality'), 'Electronic City');
  assert.equal(requests[0].searchParams.get('status'), 'Ready');
  assert.equal(requests[0].searchParams.get('bhk'), '3');
  assert.equal(requests[0].searchParams.get('budget'), '150');
  assert.equal(requests[0].searchParams.get('sort'), 'price');
  assert.equal(client.element('clearFilters').hidden, false);
  assert.equal(client.element('propertyGrid').attributes['aria-busy'], 'false');
  assert.equal(client.rendered[0][0].id, 'matched');
});

test('a slower previous search cannot overwrite the latest filter results or loading state', async () => {
  const pending = [];
  const client = searchClient((url, options) => new Promise(resolve => pending.push({ resolve, options })));
  const first = client.load();
  client.state.locality = 'Hebbal';
  const second = client.load();
  assert.equal(pending[0].options.signal.aborted, true);
  pending[0].resolve({ ok: true, json: async () => ({ success: true, data: [{ id: 'old' }] }) });
  await first;
  assert.equal(client.element('propertyGrid').attributes['aria-busy'], 'true');
  assert.equal(client.rendered.length, 0);
  pending[1].resolve({ ok: true, json: async () => ({ success: true, data: [{ id: 'new' }] }) });
  await second;
  assert.equal(client.rendered.length, 1);
  assert.equal(client.rendered[0][0].id, 'new');
  assert.equal(client.element('propertyGrid').attributes['aria-busy'], 'false');
});

test('HTTP and API failures finish loading and offer a retry instead of leaving a spinner', async () => {
  for (const reply of [{ ok: false, success: true, data: [] }, { ok: true, success: false }, { ok: true, success: true, data: null }]) {
    const client = searchClient(async () => ({ ok: reply.ok, json: async () => reply }));
    await client.load();
    assert.match(client.element('propertyGrid').innerHTML, /Try again/);
    assert.equal(client.element('resultsCounter').textContent, 'Properties are temporarily unavailable.');
    assert.equal(client.element('propertyGrid').attributes['aria-busy'], 'false');
    assert.equal(client.rendered.length, 0);
  }
});
