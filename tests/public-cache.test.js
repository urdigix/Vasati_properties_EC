const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const compression = require('compression');
const { publicCache } = require('../server/public-cache');

test('cached gzip and identity representations return the same content without double compression', async t => {
  const app = express();
  app.use(compression());
  app.use(publicCache());
  let reads = 0;
  const payload = {text:'Builder homes '.repeat(300)};
  app.get('/api/properties', (_req, res) => { reads++; res.json(payload); });
  const listener = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); }));
  for (const encoding of ['gzip','identity','gzip']) {
    const response = await fetch(`http://127.0.0.1:${listener.address().port}/api/properties`, {headers:{'Accept-Encoding':encoding}});
    assert.equal(response.headers.get('content-encoding'), encoding === 'gzip' ? 'gzip' : null);
    assert.match(response.headers.get('vary'), /Accept-Encoding/i);
    assert.deepEqual(await response.json(), payload);
  }
  assert.equal(reads, 1);
});

test('public cache bounds memory, expires, preserves query variants and invalidates catalogue edits', async t => {
  let clock = 0, reads = 0, value = 'old';
  const app = express();
  app.use(publicCache({ ttlMs: 100, maxEntries: 2, maxBytes: 4096, now: () => clock }));
  app.get('/api/properties', (req, res) => { reads++; res.set('X-Robots-Tag', 'noindex, nofollow').json({ value, sort: req.query.sort }); });
  app.put('/api/properties/one', (_req, res) => { value = 'new'; res.json({success:true}); });
  app.post('/mcp', (_req, res) => { value = 'mcp'; res.json({success:true}); });
  app.get('/api/properties/missing', (_req, res) => { reads++; res.sendStatus(404); });
  const listener = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); }));
  const request = (url = '/api/properties', options) => fetch(`http://127.0.0.1:${listener.address().port}${url}`, options);
  assert.equal((await request()).headers.get('x-public-cache'), 'MISS');
  const cached = await request();
  assert.equal(cached.headers.get('x-public-cache'), 'HIT');
  assert.equal(cached.headers.get('x-robots-tag'), 'noindex, nofollow');
  const etag = cached.headers.get('etag');
  assert.equal((await request('/api/properties', {headers:{'If-None-Match':etag, 'Cache-Control':'max-age=0'}})).status, 304);
  assert.equal(reads, 1);
  const head = await request('/api/properties', {method:'HEAD'});
  assert.equal(head.headers.get('x-public-cache'), 'HIT');
  assert.equal(await head.text(), '');
  await request('/api/properties?sort=price-asc');
  assert.equal((await (await request('/api/properties?sort=price-asc')).json()).sort, 'price-asc');
  await request('/api/properties?sort=price-desc');
  assert.equal((await request()).headers.get('x-public-cache'), 'MISS');
  clock = 101;
  assert.equal((await request()).headers.get('x-public-cache'), 'MISS');
  await request('/api/properties/one', {method:'PUT'});
  assert.equal((await (await request()).json()).value, 'new');
  await request('/mcp', {method:'POST'});
  assert.equal((await (await request()).json()).value, 'mcp');
  await request('/api/properties/missing');
  const before = reads;
  assert.equal((await request('/api/properties/missing')).status, 404);
  assert.equal(reads, before + 1);
});

test('private responses, cookies and oversized catalogue responses never enter the shared cache', async t => {
  const app = express();
  app.use(compression());
  app.use(publicCache({maxBytes:128}));
  let reads = 0;
  app.get('/api/admin/session', (_req, res) => res.json({reads:++reads}));
  app.get('/api/public-config', (_req, res) => res.cookie('session','unique').json({reads:++reads}));
  app.get('/api/settings', (_req, res) => res.cookie('session','unique').json({reads:++reads}));
  app.get('/api/featured-projects', (_req, res) => res.set('Cache-Control','private, no-store').json({reads:++reads}));
  app.get('/api/properties', (_req, res) => res.json({reads:++reads, text:'x'.repeat(5000)}));
  const listener = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); }));
  for (const route of ['/api/admin/session','/api/public-config','/api/settings','/api/featured-projects','/api/properties']) {
    const request = () => fetch(`http://127.0.0.1:${listener.address().port}${route}`);
    const first = await (await request()).json();
    const second = await request();
    assert.notEqual(second.headers.get('x-public-cache'), 'HIT');
    assert.equal((await second.json()).reads, first.reads + 1);
  }
});
