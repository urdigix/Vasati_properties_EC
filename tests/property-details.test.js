const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeDetails } = require('../server/property-details');
const ui = require('../public/property-details');

test('project fields and floor plans survive save, partial update, reopen, and explicit clearing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vasati-details-'));
  process.env.DATA_DIR = dir;
  const database = require('../db/database');
  try {
    database.initializeDatabase();
    // Simulate migration of an existing deployment without the new columns.
    database.db.exec('ALTER TABLE properties DROP COLUMN project_details; ALTER TABLE properties DROP COLUMN floor_plans;');
    database.initializeDatabase();
    const p = { title: 'Test home', location: 'Besant Nagar', price: 125, bhk: 3, area: '1800 sq.ft', published: true,
      project_details: { builder_name: 'Builder', rera_id: 'TN123', map_address: 'Main Road, Chennai' },
      floor_plans: [{ label: '3 BHK', area: '1800 sq.ft', price: '₹1.25 Cr', image: '/api/media/plan' }] };
    const id = database.createProperty(p);
    let saved = database.getPropertyById(id);
    assert.equal(saved.project_details.builder_name, 'Builder');
    assert.deepEqual(saved.floor_plans, p.floor_plans);
    database.updateProperty(id, { title: 'Updated home' });
    database.initializeDatabase();
    saved = database.getPropertyById(id);
    assert.equal(saved.title, 'Updated home');
    assert.deepEqual(saved.floor_plans, p.floor_plans);
    assert.equal(saved.project_details.map_address, 'Main Road, Chennai');
    assert.throws(() => database.updateProperty(id, { title: 'Must not save', floor_plans: [{label:'Bad',image:'javascript:alert(1)'}] }), /HTTP/);
    assert.equal(database.getPropertyById(id).title, 'Updated home');
    database.updateProperty(id, { floor_plans: [], project_details: {} });
    assert.deepEqual(database.getPropertyById(id).floor_plans, []);
    assert.equal(database.getPropertyById(id).project_details.builder_name, '');
  } finally { database.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('floor plan validation rejects unsafe URLs, oversized input, and malformed configurations', () => {
  for (const floor_plans of [null, {}, [{ area:'1800' }], [{ label:'x',image:'//evil.test/x' }], [{label:'x',image:'data:image/svg+xml,evil'}], Array.from({ length:13 }, () => ({label:'x'}))]) {
    assert.throws(() => normalizeDetails({ floor_plans }), error => error.status === 400);
  }
  assert.throws(() => normalizeDetails({ project_details: { builder_name: 'x'.repeat(501) } }), /500/);
  assert.equal(normalizeDetails({floor_plans:[{label:'2 BHK',image:'https://example.com/plan.jpg'}]}).floor_plans.length,1);
});

test('property page escapes listing content and uses only real gallery assets and saved facts', () => {
  const html = ui.render({ title: '<img src=x onerror=alert(1)>', location: 'Main "Road"', images: ['/api/media/cover','javascript:alert(1)'], price:125, area:'1,800 sq.ft', bhk:3,
    project_details: {builder_name:'<script>bad</script>'}, floor_plans:[{label:'3 BHK',image:'javascript:alert(1)'}] });
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<script>bad'));
  assert.ok(!html.includes('src="javascript:'));
  assert.ok(html.includes('View all 1 photos'));
  assert.ok(html.includes('₹6,944/sq.ft'));
  assert.ok(!html.includes('Temperature Controlled Pool'));
  assert.ok(!html.includes('5 Minutes Walk'));
  assert.ok(!html.includes('Unsplash'));
  assert.ok(html.includes('id="propertyEnquiryForm"'));
  assert.ok(html.includes('id="scheduleVisitForm"'));
});

test('missing or non-square-foot areas do not produce a fabricated price per square foot', () => {
  for (const area of ['', '120 sq.m', 'On request']) assert.ok(!ui.render({title:'Home', price:125,area}).includes('/sq.ft'));
  const html = ui.render({title:'Home',images:[],floor_plans:[]});
  assert.ok(html.includes('Property photos will be added soon.'));
  assert.ok(html.includes('Detailed floor plans are available on request.'));
  assert.ok(!html.includes('Download brochure'));
  assert.deepEqual(ui.photos({images:['/one','/one','//evil/x','https://example.com/two'],image:'/one'}), ['/one','https://example.com/two']);
});

test('all frontend scripts parse, including the existing site-visit handler', () => {
  const vm = require('node:vm');
  for (const filename of ['index.html','admin.html']) {
    const html = fs.readFileSync(path.join(__dirname,'..','public',filename),'utf8');
    for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1], {filename});
  }
});

test('enquiry form prevents duplicate sends, retains input after failure, and resets only after success', async () => {
  const vm = require('node:vm');
  const listeners = {}, status = {}, button = {}, fields = {name:' Visitor ',phone:'9876543210',email:'',message:'Please send plans'};
  let resets = 0, requestCount = 0, complete, tracked = 0;
  const form = { reportValidity: () => true, querySelector: () => button, addEventListener: (event, handler) => { listeners[event] = handler; }, reset: () => { resets++; } };
  const noop = { addEventListener() {} };
  const dialog = { querySelector: () => noop, addEventListener() {} };
  const container = { querySelector: selector => selector === 'dialog' ? dialog : selector === '#propertyEnquiryForm' ? form : status, querySelectorAll: () => [] };
  const context = { window: {}, FormData: class { get(key) { return fields[key]; } }, localStorage: { getItem: () => null }, fetch: async () => { requestCount++; return new Promise(resolve => { complete = resolve; }); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','public','property-details.js'),'utf8'), context);
  context.window.PropertyDetails.bind(container, {id:'home',title:'Home'}, {track: () => tracked++});
  const first = listeners.submit({preventDefault(){}});
  assert.equal(button.disabled, true);
  await listeners.submit({preventDefault(){}});
  assert.equal(requestCount,1);
  complete({ok:false,json:async () => ({message:'Try again later'})}); await first;
  assert.equal(status.textContent,'Try again later'); assert.equal(resets,0); assert.equal(button.disabled,false);
  const second = listeners.submit({preventDefault(){}});
  complete({ok:true,json:async () => ({success:true})}); await second;
  assert.equal(resets,1); assert.equal(tracked,1); assert.equal(button.disabled,false);
});
