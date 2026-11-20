const assert = require('node:assert/strict');
const { test } = require('node:test');
const plans = require('../public/floor-plans');
const plan = { configuration: '2 BHK Apartment', area: '1332 sq.ft.', price: '₹1.5 Cr', image_url: '/images/plan.png', rooms: [{ name: 'Bedroom 1', dimensions: '14′ 11″ × 11′ 0″' }] };

test('2D plans render configuration and area choices, prices and room dimensions', () => {
  const html = plans.render({ title: 'Example property', floor_plans: [plan, {...plan,area:'1347 sq.ft.',price:'₹1.55 Cr'}, {...plan,configuration:'3 BHK Apartment'}] });
  for (const text of ['Floor Plans and Pricing', '2 BHK Apartment', '3 BHK Apartment', '1332 sq.ft.', '1347 sq.ft.', '₹1.5 Cr', 'Bedroom 1', '14′ 11″ × 11′ 0″', '2D Floor Plan', 'Zoom in', 'Reset zoom']) assert.ok(html.includes(text));
  assert.ok(!html.includes('3D'));
  const empty = plans.render({title:'Older listing'});
  assert.ok(empty.includes('have not been added'));
  assert.ok(!empty.includes('fp-stage'));
  assert.deepEqual(plans.read('[]'), []);
});

test('floor-plan data rejects unsafe URLs, incomplete records, duplicates and excessive entries', () => {
  for (const input of [null, {}, [null], [{...plan,configuration:''}], [{...plan,image_url:'javascript:alert(1)'}], [{...plan,image_url:'//evil.example/plan.png'}], [{...plan,image_url:'https://user:secret@example.test/plan.png'}], [{...plan,rooms:[{name:'Bedroom',dimensions:''}]}], [plan,{...plan}], Array(31).fill(plan), [{...plan,rooms:Array(31).fill(plan.rooms[0])}]] ) {
    assert.throws(() => plans.normalize(input), error => error.code === 'INVALID_FLOOR_PLANS');
  }
  assert.deepEqual(plans.normalize([plan]), [plan]);
  assert.equal(plans.normalize([{...plan,image_url:'/uploads/properties/123_plan.webp'}])[0].image_url, '/uploads/properties/123_plan.webp');
  assert.ok(plans.render({title:'<script>unsafe</script>',floor_plans:[{...plan,rooms:[{name:'<img src=x onerror=alert(1)>',dimensions:'12 × 10'}]}]}).includes('&lt;img'));
});

test('calculated pricing uses INR per square foot, exact metric conversion and validates ranges', () => {
  const input = {...plan, area_sqft:990, rate_per_sqft:4500, price:'tampered', area:'tampered'};
  const [two] = plans.normalize([input]);
  const [three] = plans.normalize([{...input,configuration:'3 BHK',area_sqft:1280,area_max_sqft:1320}]);
  assert.equal(two.price, '₹44.55 L');
  assert.equal(two.area, '990 sq.ft.');
  assert.equal(three.price, '₹57.6 L – ₹59.4 L');
  assert.equal(plans.areaLabel(990,990,'sqm'), '91.97 sq.m');
  assert.equal(plans.areaLabel(1280,1320,'sqm'), '118.92 – 122.63 sq.m');
  const totals = plans.summary([two,three]);
  assert.equal(totals.price,44.55);
  assert.equal(totals.label,'₹44.55 L – ₹59.4 L');
  assert.equal(totals.rate,'₹4,500 / sq.ft.');
  assert.deepEqual(plans.normalize([two,three]),[two,three], 'Save/reload does not drift');
  assert.equal(plans.summary([two,plan]),null,'Do not invent a combined price for manual plans');
  for (const change of [{area_sqft:0},{area_sqft:-1},{rate_per_sqft:0},{rate_per_sqft:Infinity},{area_max_sqft:989},{area_sqft:true},{area_type:'Unknown'},{area_sqft:10000001}]) {
    assert.throws(()=>plans.normalize([{...input,...change}]),e=>e.code==='INVALID_FLOOR_PLANS');
  }
  const html = plans.render({title:'Example',floor_plans:[two,three]});
  for (const text of ['fp-option-card','Area unit','sq.m','₹44.55 L','₹59.4 L','Contact','View floor plan']) assert.ok(html.includes(text));
});
