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
