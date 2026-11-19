const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Script } = require('node:vm');
const { installSeo, notFound, propertyPath } = require('../server/seo');

const property = {
  id: 'home-1', title: '3 BHK in Whitefield', location: 'Whitefield, Bengaluru',
  description: 'A home near the metro.', price_label: '₹95 L', bhk: 3, area: '1,240 sqft',
  kind: 'Apartment', possession: 'Ready to move', image: '/images/home.webp'
};
const database = {
  getSiteSettings: () => ({ seo_title: 'Bengaluru homes | Vasati', seo_description: 'Find your Bengaluru home.' }),
  getAllProperties: () => [property],
  getPropertyById: id => id === property.id ? property : null
};

async function serve(t, env, db = database) {
  const app = express();
  installSeo(app, db, env);
  app.get('/admin/login', (_req, res) => res.send('Sign in'));
  app.use(notFound);
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return (url, options) => fetch(`http://127.0.0.1:${server.address().port}${url}`, options);
}

test('production pages contain crawlable content, unique metadata and safe canonical URLs', async t => {
  const request = await serve(t, { SITE_URL: 'https://vasati.example', SEO_INDEXABLE: 'true' });
  const home = await request('/', { headers: { Host: 'attacker.example' } });
  const html = await home.text();
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('x-robots-tag'), null);
  assert.match(html, /<title>Bengaluru homes \| Vasati<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/vasati.example\/"/);
  assert.ok(html.includes(`href="${propertyPath(property)}"`));
  assert.ok(!html.includes('attacker.example'));
  const detail = await request(propertyPath(property));
  const content = await detail.text();
  assert.equal(detail.status, 200);
  assert.match(content, /<h1>3 BHK in Whitefield<\/h1>/);
  assert.ok(content.includes(property.description));
  assert.match(content, /<title>3 BHK in Whitefield \| Whitefield, Bengaluru \| Vasati Properties<\/title>/);
  assert.match(content, /property="og:image" content="https:\/\/vasati.example\/images\/home.webp"/);
  const schema = JSON.parse(content.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.ok(schema['@graph'].some(item => item['@type'] === 'BreadcrumbList'));
  assert.match(content, /id="homeSurface" style="display:none"/);
});

test('sitemap includes only published canonical pages; missing and draft pages return 404', async t => {
  const request = await serve(t, { APP_BASE_URL: 'https://vasati.example', SEO_INDEXABLE: 'true' });
  const response = await request('/sitemap.xml');
  assert.match(response.headers.get('content-type'), /application\/xml/);
  const xml = await response.text();
  assert.ok(xml.includes(`https://vasati.example${propertyPath(property)}`));
  assert.ok(!xml.includes('draft'));
  for (const url of ['/properties/draft', '/properties/missing/title', '/does-not-exist', '/missing.css']) {
    const response = await request(url);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
  }
  for (const url of ['/properties/home-1', '/properties/home-1/old-title']) {
    const response = await request(url, { redirect: 'manual' });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), propertyPath(property));
  }
  const alias = await request('/index.html', { redirect: 'manual' });
  assert.equal(alias.status, 301);
  assert.equal(alias.headers.get('location'), '/');
  const robots = await (await request('/robots.txt')).text();
  assert.match(robots, /Sitemap: https:\/\/vasati.example\/sitemap.xml/);
  assert.match((await request('/admin/login')).headers.get('x-robots-tag'), /noindex/);
});

test('staging, defaults, and localhost stay noindex with crawlable directives and empty sitemaps', async t => {
  for (const env of [{}, { SITE_URL: 'https://staging.example', SEO_INDEXABLE: 'false' }, { SITE_URL: 'http://localhost:3000', SEO_INDEXABLE: 'true' }]) {
    const request = await serve(t, env);
    const response = await request('/');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.match(await response.text(), /name="robots" content="noindex, nofollow"/);
    assert.ok(!(await (await request('/sitemap.xml')).text()).includes('<loc>'));
    assert.match(await (await request('/robots.txt')).text(), /Allow: \//);
  }
});

test('CMS text cannot escape HTML attributes or JSON-LD scripts', async t => {
  const unsafe = { ...property, title: '</script><script>alert("x")</script> & $&', description: '"><img src=x onerror=alert(1)>' };
  const request = await serve(t, { SITE_URL: 'https://vasati.example', SEO_INDEXABLE: 'true' }, {
    ...database, getPropertyById: () => unsafe, getAllProperties: () => [unsafe]
  });
  const html = await (await request(propertyPath(unsafe))).text();
  assert.ok(!html.includes('<script>alert("x")</script>'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(schema['@graph'].find(item => item['@type'] === 'BreadcrumbList').itemListElement[1].name, unsafe.title);
});

test('canonical configuration rejects unsafe URL schemes and paths', () => {
  for (const SITE_URL of ['javascript:alert(1)', 'https://example.com/subdir', 'https://user:pass@example.com', 'https://example.com/?x=1']) {
    assert.throws(() => installSeo(express(), database, { SITE_URL }));
  }
});

test('inline public and admin JavaScript remains syntactically valid', () => {
  for (const filename of ['index.html', 'admin.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', filename), 'utf8');
    for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new Script(match[1]);
  }
});
