const assert = require('node:assert/strict');
const { test } = require('node:test');
const overview = require('../public/property-overview');

test('overview renders reference fields and retains honest fallbacks for older listings', () => {
  const html = overview.render({ title: 'Test project', bhk: 2, kind: 'Apartment', area: '1200 sqft', possession: 'Ready to move', project_overview: {
    project_units: '15', area_unit: 'sq.ft.', sizes: '990–1320 sq.ft.', project_size: '1 Building – 15 units', launch_date: '2025-09', avg_price: '₹4.5 K/sq.ft.', configurations: '2, 3 BHK Apartments', rera_status: 'not_applicable'
  } });
  for (const text of ['Test project Overview', 'Project Units', '990–1320 sq.ft.', 'Sep, 2025', '₹4.5 K/sq.ft.', 'RERA Not Applicable', 'Ask For Details']) assert.ok(html.includes(text));
  const legacy = overview.render({ title: 'Old home', area: '900 sqft', bhk: 2, kind: 'Apartment', possession: 'Ready to move' });
  assert.ok(legacy.includes('Not provided'));
  assert.ok(!legacy.includes('RERA Not Applicable'));
  assert.ok(legacy.includes('2 BHK Apartment'));
  assert.ok(!legacy.includes('Know More'));
  assert.ok(!overview.render({ title: 'SSR' }, { interactive: false }).includes('data-overview-action'));
});

test('overview validates owner input and prevents unsafe RERA links', () => {
  for (const value of [null, [], {project_units:'1.2'}, {project_units:'-1'}, {project_units:'0'}, {project_units:'100000001'}, {launch_date:'2025-13'}, {rera_status:'approved'}, {rera_status:'registered'}, {rera_url:'javascript:alert(1)'}, {rera_url:'data:text/html,test'}, {rera_url:'https://user:secret@example.com'}, {sizes:'x'.repeat(161)}]) {
    assert.throws(() => overview.normalize(value), error => error.code === 'INVALID_PROJECT_OVERVIEW');
  }
  const html = overview.render({title:'<script>alert(1)</script>', project_overview:{ project_size:'<img src=x onerror=alert(1)>', rera_status:'registered', rera_id:'ID & 123', rera_url:'https://example.test/rera?id=1&project=2' }});
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(html.includes('ID &amp; 123'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('id=1&amp;project=2'));
});
