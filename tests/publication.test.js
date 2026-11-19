const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runInNewContext } = require('node:vm');

test('admin project editor always publishes saves without an optional draft switch', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const form = html.match(/<form\b[^>]*id="propertyForm"[^>]*>([\s\S]*?)<\/form>/)?.[1];
  assert.ok(form, 'Property editor exists');
  assert.ok(!html.includes('formPublished'), 'An old optional publication checkbox must not control visibility');
  assert.match(html, /published: true/, 'Admin saves explicitly request publication');
  assert.match(form, /automatically published/i, 'Editor explains that saving makes the project live');
});

test('homepage refreshes projects quietly while visible without interrupting searches or detail pages', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const source = html.match(/function refreshPublicProjects\(\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(source, 'Homepage refresh handler exists');
  let busy = 'false';
  const calls = [];
  const context = {document:{hidden:false,getElementById:()=>({getAttribute:()=>busy})},location:{pathname:'/'},loadProperties:options=>calls.push(['properties',options.quiet]),loadFeaturedProjects:()=>calls.push(['featured'])};
  runInNewContext(source + '; refreshPublicProjects();', context);
  assert.deepEqual(calls, [['properties',true],['featured']]);
  calls.length=0;
  for(const mode of ['hidden','detail','busy']) {
    context.document.hidden=mode==='hidden';
    context.location.pathname=mode==='detail'?'/properties/example/home':'/';
    busy=mode==='busy'?'true':'false';
    runInNewContext('refreshPublicProjects()',context);
    assert.equal(calls.length,0,mode+' must not request another catalogue');
  }
});
