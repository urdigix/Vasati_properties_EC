const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];

test('publish control belongs to the property form and uploaded video paths are accepted', () => {
  const form = html.match(/<form id="propertyForm">([\s\S]*?)<\/form>/)[1];
  assert.match(form, /id="formPublished"/);
  assert.match(form, /type="text" id="formVideoUrl"/);
});

function loadAdmin(logoutStatus) {
  const listeners = new Map();
  const elements = new Map([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(([, id]) => [id, {
    value: '', textContent: '', dataset: {}, style: {},
    reset() {}, showModal() { this.open = true; }, close() { this.open = false; },
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener(event, handler) { listeners.set(`${id}:${event}`, handler); },
    querySelectorAll() { return []; }
  }]));
  const calls = [];
  const navigations = [];
  const context = {
    document: {
      getElementById(id) { return elements.get(id) || null; },
      querySelectorAll() { return []; },
      addEventListener() {}
    },
    fetch(url, options) {
      calls.push({ url, options });
      if (url === '/api/admin/session') return new Promise(() => {});
      return Promise.resolve({ ok: logoutStatus === 200, status: logoutStatus });
    },
    location: { replace(url) { navigations.push(url); } },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    console, URLSearchParams, AbortController
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'admin.html' });
  return { listeners, elements, calls, navigations, context };
}

test('add and edit property actions open their dialogs against actual markup', () => {
  const page = loadAdmin(200);
  page.listeners.get('openAddModalBtn:click')();
  assert.equal(page.elements.get('propertyModal').open, true);
  page.elements.get('propertyModal').close();
  vm.runInNewContext(`properties = [{ id: 'edit-test', title: 'Existing home', location: 'Bengaluru', price: 50, priceLabel: '₹50 L', bhk: 2, area: '1000 sqft', images: [], published: true }]; editProperty('edit-test');`, page.context);
  assert.equal(page.elements.get('propertyModal').open, true);
  assert.equal(page.elements.get('formTitle').value, 'Existing home');
  assert.equal(page.elements.get('formPublished').checked, true);
});

test('admin script initializes against the actual markup and sign-out posts before redirecting', async () => {
  const page = loadAdmin(200);
  assert.ok(page.calls.some(call => call.url === '/api/admin/session'), 'startup reaches session initialization');
  await page.listeners.get('logoutBtn:click')();
  assert.equal(page.calls.at(-1).url, '/api/admin/auth/logout');
  assert.equal(page.calls.at(-1).options.method, 'POST');
  assert.deepEqual(page.navigations, ['/admin/login']);
});

test('failed sign-out stays on the page and allows retry', async () => {
  const page = loadAdmin(503);
  await page.listeners.get('logoutBtn:click')();
  assert.deepEqual(page.navigations, []);
  assert.equal(page.elements.get('logoutBtn').disabled, false);
  assert.match(page.elements.get('toast').textContent, /Could not sign out/);
});
